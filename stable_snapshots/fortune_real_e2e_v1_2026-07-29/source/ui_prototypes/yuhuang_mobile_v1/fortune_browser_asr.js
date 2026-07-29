'use strict';

(() => {
  const TARGET_SAMPLE_RATE = 16000;
  const PCM_SAMPLES_PER_CHUNK = 3200;
  const MAX_PCM_CHUNK_BYTES = 64000;
  const FINAL_TIMEOUT_MS = 18000;
  const WORKLET_URL = '/realtime-assets/pcm_capture_processor.js';
  const WORKLET_NAME = 'pcm-capture-processor';
  const WEBSOCKET_CONNECTING = 0;
  const WEBSOCKET_OPEN = 1;

  const SESSION_STATES = Object.freeze({
    IDLE: 'idle',
    REQUESTING_MICROPHONE: 'requesting-microphone',
    CONNECTING_ASR: 'connecting-asr',
    STARTING_AUDIO: 'starting-audio',
    SPEAKING: 'speaking',
    FINISHING_ASR: 'finishing-asr',
    TRANSCRIPT_READY: 'transcript-ready',
    FAILED: 'failed',
    CLOSED: 'closed',
  });

  function buildFortuneAsrWebSocketUrl(location = window.location) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = String(location.hostname || '');
    if (!hostname) {
      throw new Error('当前页面主机名无效');
    }
    const formattedHostname = hostname.includes(':')
      ? `[${hostname}]`
      : hostname;
    return `${protocol}//${formattedHostname}:3001/fortune-asr`;
  }

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') {
      return;
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Continue releasing the remaining tracks.
      }
    }
  }

  function isFloat32Array(value) {
    return value
      && Object.prototype.toString.call(value) === '[object Float32Array]';
  }

  function resampleTo16k(session, inputSamples) {
    if (!isFloat32Array(inputSamples) || inputSamples.length === 0) {
      return new Float32Array(0);
    }

    if (!session.resampleState) {
      session.resampleState = {
        ratio: session.inputSampleRate / TARGET_SAMPLE_RATE,
        position: 0,
        tail: new Float32Array(0),
      };
    }

    const state = session.resampleState;
    const combined = new Float32Array(
      state.tail.length + inputSamples.length
    );
    combined.set(state.tail, 0);
    combined.set(inputSamples, state.tail.length);

    const outputSamples = [];
    while (state.position < combined.length - 1) {
      const leftIndex = Math.floor(state.position);
      const rightIndex = leftIndex + 1;
      const fraction = state.position - leftIndex;
      outputSamples.push(
        combined[leftIndex] * (1 - fraction)
        + combined[rightIndex] * fraction
      );
      state.position += state.ratio;
    }

    const consumedSamples = Math.min(
      Math.floor(state.position),
      combined.length - 1
    );
    state.tail = combined.slice(consumedSamples);
    state.position -= consumedSamples;
    return Float32Array.from(outputSamples);
  }

  function float32ToPcm16(floatSamples) {
    const pcmSamples = new Int16Array(floatSamples.length);
    for (let index = 0; index < floatSamples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, floatSamples[index]));
      pcmSamples[index] = sample < 0
        ? Math.round(sample * 32768)
        : Math.round(sample * 32767);
    }
    return pcmSamples;
  }

  function pcm16ToLittleEndianBuffer(pcmSamples) {
    const buffer = new ArrayBuffer(pcmSamples.length * 2);
    const view = new DataView(buffer);
    for (let index = 0; index < pcmSamples.length; index += 1) {
      view.setInt16(index * 2, pcmSamples[index], true);
    }
    return buffer;
  }

  function createFortuneAsrSession(callbacks = {}) {
    let state = SESSION_STATES.IDLE;
    let stream = null;
    let socket = null;
    let audioContext = null;
    let mediaSourceNode = null;
    let workletNode = null;
    let silentGainNode = null;
    let inputSampleRate = 0;
    let resampleState = null;
    let pendingPcmSamples = new Int16Array(0);
    let startSent = false;
    let startedReceived = false;
    let finishSent = false;
    let finalReceived = false;
    let partialAfterFinal = false;
    let finalTimer = null;
    let socketCloseExpected = false;
    let releaseStarted = false;

    const session = {
      get state() {
        return state;
      },
      get inputSampleRate() {
        return inputSampleRate;
      },
      get resampleState() {
        return resampleState;
      },
      set resampleState(value) {
        resampleState = value;
      },
      start,
      finish,
      close,
    };

    function notify(name, ...args) {
      if (typeof callbacks[name] === 'function') {
        callbacks[name](...args);
      }
    }

    function isTerminal() {
      return state === SESSION_STATES.FAILED
        || state === SESSION_STATES.CLOSED;
    }

    function clearFinalTimer() {
      if (finalTimer === null) {
        return;
      }
      window.clearTimeout(finalTimer);
      finalTimer = null;
    }

    function detachSocketListeners(targetSocket) {
      if (
        !targetSocket
        || typeof targetSocket.removeEventListener !== 'function'
      ) {
        return;
      }
      targetSocket.removeEventListener('message', handleSocketMessage);
      targetSocket.removeEventListener('error', handleSocketError);
      targetSocket.removeEventListener('close', handleSocketClose);
    }

    function closeSocket(reason) {
      const socketToClose = socket;
      socket = null;
      if (!socketToClose) {
        return;
      }
      socketCloseExpected = true;
      detachSocketListeners(socketToClose);
      if (
        socketToClose.readyState === WEBSOCKET_CONNECTING
        || socketToClose.readyState === WEBSOCKET_OPEN
      ) {
        try {
          socketToClose.close(1000, reason);
        } catch {
          // Socket cleanup is best effort.
        }
      }
    }

    function releaseAudioResources() {
      if (releaseStarted) {
        return;
      }
      releaseStarted = true;

      if (workletNode && workletNode.port) {
        workletNode.port.onmessage = null;
        workletNode.port.onmessageerror = null;
        workletNode.onprocessorerror = null;
        if (typeof workletNode.port.close === 'function') {
          try {
            workletNode.port.close();
          } catch {
            // Continue releasing the remaining audio resources.
          }
        }
      }

      for (const node of [
        mediaSourceNode,
        workletNode,
        silentGainNode,
      ]) {
        if (node && typeof node.disconnect === 'function') {
          try {
            node.disconnect();
          } catch {
            // Audio nodes may already be disconnected.
          }
        }
      }
      mediaSourceNode = null;
      workletNode = null;
      silentGainNode = null;

      const streamToStop = stream;
      stream = null;
      stopStream(streamToStop);

      const contextToClose = audioContext;
      audioContext = null;
      if (
        contextToClose
        && contextToClose.state !== 'closed'
        && typeof contextToClose.close === 'function'
      ) {
        Promise.resolve(contextToClose.close()).catch(() => {});
      }
    }

    function resetAudioBuffers() {
      pendingPcmSamples = new Int16Array(0);
      resampleState = null;
    }

    function fail(kind, message) {
      if (isTerminal() || state === SESSION_STATES.TRANSCRIPT_READY) {
        return;
      }
      state = SESSION_STATES.FAILED;
      clearFinalTimer();
      releaseAudioResources();
      resetAudioBuffers();
      closeSocket('fortune asr failed');
      notify('onError', Object.freeze({ kind, message }));
    }

    function sendJson(message) {
      if (!socket || socket.readyState !== WEBSOCKET_OPEN) {
        return false;
      }
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    }

    function sendPcmSamples(pcmSamples, allowFinishing = false) {
      if (
        !socket
        || socket.readyState !== WEBSOCKET_OPEN
        || !startedReceived
        || pcmSamples.length === 0
        || (
          state !== SESSION_STATES.SPEAKING
          && !(allowFinishing && state === SESSION_STATES.FINISHING_ASR)
        )
      ) {
        return false;
      }

      const buffer = pcm16ToLittleEndianBuffer(pcmSamples);
      if (
        buffer.byteLength === 0
        || buffer.byteLength % 2 !== 0
        || buffer.byteLength > MAX_PCM_CHUNK_BYTES
      ) {
        return false;
      }
      try {
        socket.send(buffer);
        return true;
      } catch {
        return false;
      }
    }

    function appendAndSendPcm(floatSamples) {
      const pcmSamples = float32ToPcm16(floatSamples);
      if (pcmSamples.length === 0) {
        return;
      }

      const combined = new Int16Array(
        pendingPcmSamples.length + pcmSamples.length
      );
      combined.set(pendingPcmSamples, 0);
      combined.set(pcmSamples, pendingPcmSamples.length);

      let offset = 0;
      while (combined.length - offset >= PCM_SAMPLES_PER_CHUNK) {
        const block = combined.subarray(
          offset,
          offset + PCM_SAMPLES_PER_CHUNK
        );
        if (!sendPcmSamples(block)) {
          fail('asr', '语音识别连接失败，请重新诉说。');
          return;
        }
        offset += PCM_SAMPLES_PER_CHUNK;
      }
      pendingPcmSamples = combined.slice(offset);
    }

    function handleCapturedFloat32(floatSamples) {
      if (state !== SESSION_STATES.SPEAKING) {
        return;
      }
      const resampledSamples = resampleTo16k(session, floatSamples);
      appendAndSendPcm(resampledSamples);
    }

    function flushPendingPcm() {
      if (pendingPcmSamples.length === 0) {
        return true;
      }
      const tail = pendingPcmSamples;
      pendingPcmSamples = new Int16Array(0);
      return sendPcmSamples(tail, true);
    }

    async function startAudioCapture() {
      if (state !== SESSION_STATES.CONNECTING_ASR) {
        return;
      }
      state = SESSION_STATES.STARTING_AUDIO;

      try {
        const AudioContextClass = window.AudioContext
          || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('AudioContext is not supported');
        }
        if (typeof window.AudioWorkletNode !== 'function') {
          throw new Error('AudioWorkletNode is not supported');
        }

        audioContext = new AudioContextClass({
          latencyHint: 'interactive',
        });
        if (
          !audioContext.audioWorklet
          || typeof audioContext.audioWorklet.addModule !== 'function'
        ) {
          throw new Error('AudioWorklet is not supported');
        }
        await audioContext.resume();
        if (state !== SESSION_STATES.STARTING_AUDIO) {
          return;
        }

        inputSampleRate = audioContext.sampleRate;
        if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
          throw new Error('invalid input sample rate');
        }
        try {
          await audioContext.audioWorklet.addModule(WORKLET_URL);
        } catch {
          fail(
            'worklet',
            '语音采集组件加载失败，请刷新页面后重试。'
          );
          return;
        }
        if (state !== SESSION_STATES.STARTING_AUDIO) {
          return;
        }

        mediaSourceNode = audioContext.createMediaStreamSource(stream);
        workletNode = new window.AudioWorkletNode(
          audioContext,
          WORKLET_NAME
        );
        silentGainNode = audioContext.createGain();
        silentGainNode.gain.value = 0;
        workletNode.port.onmessage = (event) => {
          handleCapturedFloat32(event.data);
        };
        workletNode.port.onmessageerror = () => {
          fail('audio', '音频采集暂时中断，请重新诉说。');
        };
        workletNode.onprocessorerror = () => {
          fail('audio', '音频采集暂时中断，请重新诉说。');
        };
        mediaSourceNode.connect(workletNode);
        workletNode.connect(silentGainNode);
        silentGainNode.connect(audioContext.destination);

        state = SESSION_STATES.SPEAKING;
        notify('onStarted', Object.freeze({ inputSampleRate }));
      } catch {
        fail(
          'audio',
          '当前浏览器暂时无法采集语音，请重新诉说。'
        );
      }
    }

    function handleReady() {
      if (state !== SESSION_STATES.CONNECTING_ASR || startSent) {
        return;
      }
      startSent = sendJson({
        type: 'fortune.asr.start',
        audio: {
          format: 'pcm_s16le',
          sampleRate: TARGET_SAMPLE_RATE,
          bitsPerSample: 16,
          channels: 1,
        },
      });
      if (!startSent) {
        fail('asr', '语音识别连接失败，请重新诉说。');
      }
    }

    function handleStarted() {
      if (
        state !== SESSION_STATES.CONNECTING_ASR
        || !startSent
        || startedReceived
      ) {
        return;
      }
      startedReceived = true;
      void startAudioCapture();
    }

    function handlePartial(message) {
      if (
        state !== SESSION_STATES.SPEAKING
        && state !== SESSION_STATES.FINISHING_ASR
      ) {
        return;
      }
      const text = typeof message.text === 'string' ? message.text : '';
      if (text.trim() !== '') {
        if (finalReceived) {
          partialAfterFinal = true;
        }
        notify('onPartial', text);
      }
    }

    function handleFinal(message) {
      if (
        state !== SESSION_STATES.SPEAKING
        && state !== SESSION_STATES.FINISHING_ASR
      ) {
        return;
      }
      const text = typeof message.text === 'string' ? message.text : '';
      if (text.trim() === '') {
        return;
      }

      const completesSession = state === SESSION_STATES.FINISHING_ASR;
      finalReceived = true;
      partialAfterFinal = false;
      notify('onFinal', text, completesSession);
      if (!completesSession) {
        return;
      }

      state = SESSION_STATES.TRANSCRIPT_READY;
      clearFinalTimer();
      resetAudioBuffers();
      closeSocket('fortune asr final received');
    }

    function handleClosedMessage() {
      if (state === SESSION_STATES.TRANSCRIPT_READY) {
        closeSocket('fortune asr closed');
        return;
      }
      if (state === SESSION_STATES.FINISHING_ASR && !finalReceived) {
        fail(
          'final',
          '语音识别暂时没有完成，请重新诉说。'
        );
        return;
      }
      if (!isTerminal()) {
        fail('asr', '语音识别连接已关闭，请重新诉说。');
      }
    }

    function handleSocketMessage(event) {
      if (isTerminal() || !socket || typeof event.data !== 'string') {
        return;
      }

      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        fail('asr', '语音识别返回了无效消息，请重新诉说。');
        return;
      }
      if (!message || Array.isArray(message) || typeof message !== 'object') {
        fail('asr', '语音识别返回了无效消息，请重新诉说。');
        return;
      }

      if (message.type === 'fortune.asr.ready') {
        handleReady();
        return;
      }
      if (message.type === 'fortune.asr.started') {
        handleStarted();
        return;
      }
      if (message.type === 'fortune.asr.partial') {
        handlePartial(message);
        return;
      }
      if (message.type === 'fortune.asr.final') {
        handleFinal(message);
        return;
      }
      if (message.type === 'fortune.asr.closed') {
        handleClosedMessage();
        return;
      }
      if (message.type === 'fortune.asr.error') {
        fail('asr', '语音识别暂时不可用，请重新诉说。');
      }
    }

    function handleSocketError() {
      if (!socketCloseExpected) {
        fail('asr', '语音识别连接失败，请重新诉说。');
      }
    }

    function handleSocketClose(event) {
      const closedSocket = socket;
      socket = null;
      detachSocketListeners(closedSocket);
      if (socketCloseExpected || state === SESSION_STATES.TRANSCRIPT_READY) {
        return;
      }
      if (state === SESSION_STATES.FINISHING_ASR && !finalReceived) {
        fail(
          'final',
          '语音识别暂时没有完成，请重新诉说。'
        );
        return;
      }
      if (!isTerminal()) {
        const abnormal = !event || event.code !== 1000;
        fail(
          'asr',
          abnormal
            ? '语音识别连接异常，请重新诉说。'
            : '语音识别连接已关闭，请重新诉说。'
        );
      }
    }

    function createSocket() {
      try {
        socket = new window.WebSocket(buildFortuneAsrWebSocketUrl());
        socket.binaryType = 'arraybuffer';
        socket.addEventListener('message', handleSocketMessage);
        socket.addEventListener('error', handleSocketError);
        socket.addEventListener('close', handleSocketClose);
      } catch {
        fail('asr', '语音识别连接失败，请重新诉说。');
      }
    }

    async function start() {
      if (state !== SESSION_STATES.IDLE) {
        return false;
      }
      state = SESSION_STATES.REQUESTING_MICROPHONE;

      if (
        !navigator.mediaDevices
        || typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        fail(
          'microphone',
          '暂时无法使用麦克风，请检查权限后再试。'
        );
        return false;
      }

      let requestedStream;
      try {
        requestedStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      } catch (error) {
        const permissionDenied = Boolean(
          error
          && (
            error.name === 'NotAllowedError'
            || error.name === 'SecurityError'
          )
        );
        fail(
          'microphone',
          permissionDenied
            ? '麦克风权限未开启，请允许使用麦克风后重试。'
            : '暂时无法使用麦克风，请检查权限后再试。'
        );
        return false;
      }

      if (state !== SESSION_STATES.REQUESTING_MICROPHONE) {
        stopStream(requestedStream);
        return false;
      }
      stream = requestedStream;
      state = SESSION_STATES.CONNECTING_ASR;
      notify('onConnecting');
      createSocket();
      return state === SESSION_STATES.CONNECTING_ASR;
    }

    function finish() {
      if (state !== SESSION_STATES.SPEAKING || finishSent) {
        return false;
      }

      state = SESSION_STATES.FINISHING_ASR;
      if (workletNode && workletNode.port) {
        workletNode.port.onmessage = null;
      }
      if (!flushPendingPcm()) {
        fail('asr', '语音识别连接失败，请重新诉说。');
        return false;
      }
      finishSent = sendJson({ type: 'fortune.asr.finish' });
      releaseAudioResources();
      resetAudioBuffers();
      if (!finishSent) {
        fail('asr', '语音识别连接失败，请重新诉说。');
        return false;
      }

      notify('onFinishing');
      if (finalReceived && !partialAfterFinal) {
        state = SESSION_STATES.TRANSCRIPT_READY;
        notify('onTranscriptReady');
        closeSocket('fortune asr final already received');
        return true;
      }
      finalTimer = window.setTimeout(() => {
        if (
          state === SESSION_STATES.FINISHING_ASR
          && !finalReceived
        ) {
          fail(
            'final',
            '语音识别暂时没有完成，请重新诉说。'
          );
        }
      }, FINAL_TIMEOUT_MS);
      return true;
    }

    function close() {
      if (state === SESSION_STATES.CLOSED) {
        return false;
      }
      state = SESSION_STATES.CLOSED;
      clearFinalTimer();
      releaseAudioResources();
      resetAudioBuffers();
      closeSocket('fortune page closed');
      notify('onClosed');
      return true;
    }

    return Object.freeze(session);
  }

  window.FortuneAsrBrowser = Object.freeze({
    FINAL_TIMEOUT_MS,
    SESSION_STATES,
    buildFortuneAsrWebSocketUrl,
    createSession: createFortuneAsrSession,
  });
})();
