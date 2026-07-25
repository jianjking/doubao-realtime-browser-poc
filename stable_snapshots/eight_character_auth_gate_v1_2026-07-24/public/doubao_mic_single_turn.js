'use strict';

const RELAY_URL = 'ws://127.0.0.1:3001/realtime';
const DEFAULT_CHARACTER_KEY = 'yuhuang';
const TARGET_SAMPLE_RATE = 16000;
const PCM_SAMPLES_PER_CHUNK = 320;
const PCM_BYTES_PER_CHUNK = 640;
const TTS_SAMPLE_RATE = 24000;

function resolveRequestedCharacterKey() {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.has('characterKey')
    ? searchParams.get('characterKey')
    : DEFAULT_CHARACTER_KEY;
}

const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const startMicrophoneButton = document.getElementById(
  'startMicrophoneButton'
);
const stopMicrophoneButton = document.getElementById(
  'stopMicrophoneButton'
);
const connectionState = document.getElementById('connectionState');
const microphoneStateElement = document.getElementById('microphoneState');
const playbackStateElement = document.getElementById('playbackState');
const turnStateElement = document.getElementById('turnState');
const logOutput = document.getElementById('logOutput');

let relaySocket = null;
let relayConnectionState = 'disconnected';
let cloudSessionReady = false;
let conversationActive = false;
let conversationAudioActive = false;
let currentTurnIndex = 0;
let lastDisplayedAsrText = '';

let microphoneState = 'stopped';
let mediaStream = null;
let audioContext = null;
let mediaSourceNode = null;
let workletNode = null;
let silentGainNode = null;
let microphoneStarted = false;
let inputSampleRate = 0;
let resampleState = null;
let pendingPcmSamples = new Int16Array(0);
let audioChunksSent = 0;
let audioBytesSent = 0;
let microphoneOperationId = 0;
let microphoneStopPromise = null;

let playbackState = 'idle';
let playbackAudioContext = null;
let playbackNextStartTime = 0;
const activePlaybackSources = new Set();
let ttsAudioStarted = false;
let ttsStreamEnded = false;
let ttsBinaryFramesReceived = 0;
let ttsBinaryBytesReceived = 0;
let expectedTtsFrames = 0;
let expectedTtsBytes = 0;
let playbackCompleted = false;
let playbackOperationId = 0;
let playbackCompletionSent = false;
let currentPlaybackGeneration = undefined;
let currentPlaybackTurnIndex = undefined;
const interruptedPlaybackGenerations = new Set();

const realtimeCallSubscribers = new Set();
let realtimeCallSnapshot = Object.freeze({
  state: 'idle',
  callId: null,
  detail: Object.freeze({}),
  timestamp: Date.now(),
});
let productConnectPromise = null;
let productConnectCallId = null;
let productAudioStartPromise = null;
let productAudioStartCallId = null;
let productDisconnectPromise = null;
let productDisconnectContext = null;
let productPlaybackWarmupPromise = null;
let pendingSessionReady = null;
let pendingAudioActive = null;
let pendingSocketClose = null;
let productDisconnectRequested = false;
let productCallSequence = 0;
let activeProductCallId = null;
const socketProductContexts = new WeakMap();

function createProductWaiter(label, timeoutMilliseconds) {
  let settled = false;
  let timeoutId = null;
  let resolvePromise;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function resolve(value) {
    if (settled) {
      return;
    }
    settled = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    resolvePromise(value);
  }

  function reject(error) {
    if (settled) {
      return;
    }
    settled = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    rejectPromise(error);
  }

  timeoutId = window.setTimeout(() => {
    reject(new Error(`${label}等待超时`));
  }, timeoutMilliseconds);

  return {
    promise,
    resolve,
    reject,
  };
}

function createProductAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createProductBusyError(message, code) {
  const error = new Error(message);
  error.name = 'BusyError';
  error.code = code;
  return error;
}

function isProductCallId(callId) {
  return Number.isSafeInteger(callId) && callId > 0;
}

function isSocketContextCurrent(socketContext) {
  if (!socketContext || relaySocket !== socketContext.socket) {
    return false;
  }
  return !isProductCallId(socketContext.callId)
    || socketContext.callId === activeProductCallId;
}

function productWaiterMatches(record, callId, socket) {
  return Boolean(record)
    && record.callId === callId
    && record.socket === socket;
}

function publishRealtimeCallState(
  state,
  detail = {},
  callId = null,
  options = {}
) {
  const hasCallId = isProductCallId(callId);
  if (hasCallId
    && callId !== activeProductCallId
    && options.allowInactive !== true) {
    return false;
  }
  if (!hasCallId
    && activeProductCallId !== null
    && options.allowDuringActive !== true) {
    return false;
  }

  realtimeCallSnapshot = Object.freeze({
    state,
    callId: hasCallId ? callId : null,
    detail: Object.freeze({ ...detail }),
    timestamp: Date.now(),
  });

  for (const listener of realtimeCallSubscribers) {
    try {
      listener(realtimeCallSnapshot);
    } catch (error) {
      console.error('DoubaoRealtimeCall subscriber failed', error);
    }
  }
  return true;
}

function rejectPendingProductStartup(callId, socket, error) {
  if (productWaiterMatches(pendingSessionReady, callId, socket)) {
    pendingSessionReady.reject(error);
  }
  if (productWaiterMatches(pendingAudioActive, callId, socket)) {
    pendingAudioActive.reject(error);
  }
}

function finalizeProductCall(callId, finalState, detail = {}) {
  if (callId !== activeProductCallId) {
    return false;
  }

  activeProductCallId = null;
  productDisconnectRequested = false;
  productDisconnectContext = null;
  if (productConnectCallId === callId) {
    productConnectCallId = null;
  }
  if (productAudioStartCallId === callId) {
    productAudioStartCallId = null;
  }

  return publishRealtimeCallState(
    finalState,
    {
      ...detail,
      cleanupComplete: true,
    },
    callId,
    { allowInactive: true }
  );
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logOutput.textContent += `[${timestamp}] ${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function playbackBlocksReconnect() {
  return playbackState === 'preparing'
    || playbackState === 'buffering'
    || playbackState === 'playing';
}

function updateConnectionButtons() {
  const socketBusy = relaySocket
    && relaySocket.readyState !== WebSocket.CLOSED;
  const playbackCanBeStopped = playbackBlocksReconnect()
    || activePlaybackSources.size > 0
    || playbackAudioContext !== null;

  connectButton.disabled = relayConnectionState !== 'disconnected'
    || socketBusy
    || playbackBlocksReconnect();
  disconnectButton.disabled = relayConnectionState === 'disconnected'
    && !socketBusy
    && !playbackCanBeStopped;
}

function updateMicrophoneButtons() {
  startMicrophoneButton.disabled = !(
    relayConnectionState === 'connected'
    && cloudSessionReady
    && conversationActive
    && !conversationAudioActive
    && microphoneState === 'stopped'
  );
  stopMicrophoneButton.disabled = !(
    microphoneState === 'starting'
    || microphoneState === 'recording'
  );
}

function setConnectionState(state) {
  const stateLabels = {
    disconnected: '未连接',
    connecting: '连接中',
    connected: '已连接',
  };

  if (!Object.prototype.hasOwnProperty.call(stateLabels, state)) {
    throw new Error(`不支持的连接状态：${state}`);
  }

  relayConnectionState = state;
  connectionState.textContent = `状态：${stateLabels[state]}`;
  updateConnectionButtons();
  updateMicrophoneButtons();
}

function setPlaybackState(state) {
  const stateLabels = {
    idle: '未开始',
    preparing: '准备中',
    buffering: '缓冲中',
    playing: '播放中',
    completed: '已完成',
    interrupted: '已被插话打断',
    stopped: '已停止',
    error: '错误',
  };

  if (!Object.prototype.hasOwnProperty.call(stateLabels, state)) {
    throw new Error(`不支持的播放状态：${state}`);
  }

  playbackState = state;
  playbackStateElement.textContent = `播放：${stateLabels[state]}`;
  updateConnectionButtons();
  updateMicrophoneButtons();
}

function setTurnStateText(text) {
  turnStateElement.textContent = `当前对话：${text}`;
}

function setMicrophoneState(state) {
  const stateLabels = {
    stopped: '未启动',
    starting: '启动中',
    recording: '持续监听',
    stopping: '停止中',
  };

  if (!Object.prototype.hasOwnProperty.call(stateLabels, state)) {
    throw new Error(`不支持的麦克风状态：${state}`);
  }

  microphoneState = state;
  microphoneStateElement.textContent = `麦克风：${stateLabels[state]}`;
  updateMicrophoneButtons();
}

function sendBrowserJson(message) {
  if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  relaySocket.send(JSON.stringify(message));
  return true;
}

function resetAudioCounters() {
  audioChunksSent = 0;
  audioBytesSent = 0;
  pendingPcmSamples = new Int16Array(0);
  resampleState = null;
}

function resampleTo16k(inputSamples, sourceSampleRate) {
  if (!(inputSamples instanceof Float32Array)) {
    throw new TypeError('重采样输入必须是 Float32Array');
  }
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new RangeError('输入采样率必须是有限正数');
  }
  if (inputSamples.length === 0) {
    return new Float32Array(0);
  }

  if (!resampleState
    || resampleState.inputSampleRate !== sourceSampleRate) {
    resampleState = {
      inputSampleRate: sourceSampleRate,
      ratio: sourceSampleRate / TARGET_SAMPLE_RATE,
      position: 0,
      tail: new Float32Array(0),
    };
  }

  const combined = new Float32Array(
    resampleState.tail.length + inputSamples.length
  );
  combined.set(resampleState.tail, 0);
  combined.set(inputSamples, resampleState.tail.length);

  const outputSamples = [];
  while (resampleState.position < combined.length - 1) {
    const leftIndex = Math.floor(resampleState.position);
    const rightIndex = leftIndex + 1;
    const fraction = resampleState.position - leftIndex;
    const sample = combined[leftIndex] * (1 - fraction)
      + combined[rightIndex] * fraction;
    outputSamples.push(sample);
    resampleState.position += resampleState.ratio;
  }

  const consumedSamples = Math.min(
    Math.floor(resampleState.position),
    combined.length - 1
  );
  resampleState.tail = combined.slice(consumedSamples);
  resampleState.position -= consumedSamples;

  return Float32Array.from(outputSamples);
}

function float32ToPcm16(floatSamples) {
  if (!(floatSamples instanceof Float32Array)) {
    throw new TypeError('PCM16 输入必须是 Float32Array');
  }

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

function appendAndFlushPcm(floatSamples) {
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
    if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
      break;
    }

    const block = combined.subarray(
      offset,
      offset + PCM_SAMPLES_PER_CHUNK
    );
    const sendBuffer = pcm16ToLittleEndianBuffer(block);
    relaySocket.send(sendBuffer);
    audioChunksSent += 1;
    audioBytesSent += sendBuffer.byteLength;
    offset += PCM_SAMPLES_PER_CHUNK;
  }

  pendingPcmSamples = combined.slice(offset);
}

function handleCapturedFloat32(floatSamples) {
  if (microphoneState !== 'recording'
    || !relaySocket
    || relaySocket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (!(floatSamples instanceof Float32Array)) {
    return;
  }

  const resampledSamples = resampleTo16k(
    floatSamples,
    inputSampleRate
  );
  appendAndFlushPcm(resampledSamples);
}

async function stopTtsPlayback(options = {}) {
  const operationId = playbackOperationId + 1;
  playbackOperationId = operationId;

  for (const source of activePlaybackSources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // source 可能已经自然播放完毕。
    }
    try {
      source.disconnect();
    } catch {
      // source 可能已经断开。
    }
  }
  activePlaybackSources.clear();

  const contextToClose = playbackAudioContext;
  playbackAudioContext = null;
  playbackNextStartTime = 0;
  ttsAudioStarted = false;
  ttsStreamEnded = false;
  ttsBinaryFramesReceived = 0;
  ttsBinaryBytesReceived = 0;
  expectedTtsFrames = 0;
  expectedTtsBytes = 0;
  playbackCompleted = false;
  playbackCompletionSent = false;
  currentPlaybackGeneration = undefined;
  currentPlaybackTurnIndex = undefined;
  setPlaybackState(options.error === true ? 'error' : 'stopped');

  if (contextToClose && contextToClose.state !== 'closed') {
    try {
      await contextToClose.close();
    } catch (error) {
      appendLog(`播放 AudioContext 关闭失败：${error.message}`);
    }
  }
}

async function resetTtsPlaybackState(options = {}) {
  const preserveAudioContext = options.preserveAudioContext === true
    && playbackAudioContext
    && playbackAudioContext.state !== 'closed'
    && activePlaybackSources.size === 0;

  if (!preserveAudioContext
    && (playbackAudioContext || activePlaybackSources.size > 0)) {
    await stopTtsPlayback({ reason: '新 Relay 会话' });
  } else if (options.preserveOperationId !== true) {
    playbackOperationId += 1;
  }

  playbackNextStartTime = preserveAudioContext
    ? playbackAudioContext.currentTime
    : 0;
  activePlaybackSources.clear();
  ttsAudioStarted = false;
  ttsStreamEnded = false;
  ttsBinaryFramesReceived = 0;
  ttsBinaryBytesReceived = 0;
  expectedTtsFrames = 0;
  expectedTtsBytes = 0;
  playbackCompleted = false;
  playbackCompletionSent = false;
  currentPlaybackGeneration = undefined;
  currentPlaybackTurnIndex = undefined;
  if (options.clearInterruptedGenerations === true) {
    interruptedPlaybackGenerations.clear();
  }
  setPlaybackState('idle');
}

async function resetPlaybackForUserStop() {
  playbackOperationId += 1;
  for (const source of activePlaybackSources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // source 可能已经自然播放完毕。
    }
    try {
      source.disconnect();
    } catch {
      // source 可能已经断开。
    }
  }
  activePlaybackSources.clear();

  if (Number.isSafeInteger(currentPlaybackGeneration)
    && currentPlaybackGeneration > 0) {
    interruptedPlaybackGenerations.add(currentPlaybackGeneration);
  }

  const contextToClose = playbackAudioContext;
  playbackAudioContext = null;
  playbackNextStartTime = contextToClose
    && contextToClose.state !== 'closed'
    ? contextToClose.currentTime
    : 0;
  currentPlaybackGeneration = undefined;
  currentPlaybackTurnIndex = undefined;
  ttsAudioStarted = false;
  ttsStreamEnded = false;
  ttsBinaryFramesReceived = 0;
  ttsBinaryBytesReceived = 0;
  expectedTtsFrames = 0;
  expectedTtsBytes = 0;
  playbackCompleted = false;
  playbackCompletionSent = false;

  if (contextToClose && contextToClose.state !== 'closed') {
    try {
      await contextToClose.close();
    } catch (error) {
      appendLog(`播放 AudioContext 关闭失败：${error.message}`);
    }
  }

  playbackNextStartTime = 0;
  setPlaybackState('idle');
  appendLog('用户停止实时对话，当前模型语音已停止。');
}

function stopTtsPlaybackForBargeIn(interruptedGeneration) {
  if (!Number.isSafeInteger(interruptedGeneration)
    || interruptedGeneration <= 0
    || currentPlaybackGeneration !== interruptedGeneration) {
    return false;
  }

  interruptedPlaybackGenerations.add(interruptedGeneration);
  playbackOperationId += 1;
  for (const source of activePlaybackSources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // source 可能已经自然播放完毕。
    }
    try {
      source.disconnect();
    } catch {
      // source 可能已经断开。
    }
  }
  activePlaybackSources.clear();

  if (playbackAudioContext
    && playbackAudioContext.state !== 'closed') {
    playbackNextStartTime = playbackAudioContext.currentTime;
  } else {
    playbackNextStartTime = 0;
  }
  ttsAudioStarted = false;
  ttsStreamEnded = false;
  ttsBinaryFramesReceived = 0;
  ttsBinaryBytesReceived = 0;
  expectedTtsFrames = 0;
  expectedTtsBytes = 0;
  playbackCompleted = false;
  playbackCompletionSent = false;
  currentPlaybackGeneration = undefined;
  currentPlaybackTurnIndex = undefined;
  setPlaybackState('interrupted');
  setTurnStateText('用户插话，旧播报已停止');
  appendLog('检测到插话，旧回复播放已停止。');
  return true;
}

async function preparePlaybackAudioContext() {
  setPlaybackState('preparing');

  if (playbackAudioContext
    && playbackAudioContext.state !== 'closed') {
    await playbackAudioContext.resume();
    return;
  }

  const AudioContextClass = window.AudioContext
    || window.webkitAudioContext;
  if (!AudioContextClass) {
    setPlaybackState('error');
    throw new Error('当前浏览器不支持播放 AudioContext');
  }

  const operationId = playbackOperationId;
  const context = new AudioContextClass({
    latencyHint: 'interactive',
  });
  playbackAudioContext = context;
  playbackNextStartTime = context.currentTime;

  try {
    await context.resume();
  } catch (error) {
    if (playbackAudioContext === context) {
      playbackAudioContext = null;
      playbackNextStartTime = 0;
    }
    try {
      await context.close();
    } catch {
      // 保留原始的 resume 错误。
    }
    setPlaybackState('error');
    throw new Error(`播放 AudioContext 解锁失败：${error.message}`);
  }

  if (operationId !== playbackOperationId
    || playbackAudioContext !== context) {
    try {
      await context.close();
    } catch {
      // 播放上下文已被其他清理流程接管。
    }
    throw new Error('播放 AudioContext 已被重置');
  }
}

function decodePcm16Le(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new TypeError('TTS PCM 必须是 ArrayBuffer');
  }
  if (arrayBuffer.byteLength === 0) {
    throw new RangeError('TTS PCM 不能为空');
  }
  if (arrayBuffer.byteLength % 2 !== 0) {
    throw new RangeError('TTS PCM 字节数必须为偶数');
  }

  const view = new DataView(arrayBuffer);
  const samples = new Float32Array(arrayBuffer.byteLength / 2);
  for (let offset = 0; offset < arrayBuffer.byteLength; offset += 2) {
    const value = view.getInt16(offset, true);
    samples[offset / 2] = value < 0
      ? value / 32768
      : value / 32767;
  }
  return samples;
}

function finishPlaybackIfReady() {
  if (!ttsStreamEnded
    || activePlaybackSources.size !== 0
    || ttsBinaryBytesReceived <= 0
    || playbackCompleted
    || !Number.isSafeInteger(currentPlaybackGeneration)
    || !Number.isSafeInteger(currentPlaybackTurnIndex)
    || interruptedPlaybackGenerations.has(currentPlaybackGeneration)) {
    return false;
  }

  playbackCompleted = true;
  if (playbackAudioContext
    && playbackAudioContext.state !== 'closed') {
    playbackNextStartTime = playbackAudioContext.currentTime;
  }
  setPlaybackState('completed');
  appendLog(
    `模型语音播放完成：${ttsBinaryFramesReceived} 帧，`
    + `${ttsBinaryBytesReceived} bytes`
  );

  if (!playbackCompletionSent) {
    const completionSent = sendBrowserJson({
      type: 'browser.playback_completed',
      turnIndex: currentPlaybackTurnIndex,
      generation: currentPlaybackGeneration,
      frames: ttsBinaryFramesReceived,
      bytes: ttsBinaryBytesReceived,
    });
    if (completionSent) {
      playbackCompletionSent = true;
    } else {
      appendLog('播放已结束，但 Relay 不可发送播放完成确认');
    }
  }

  return true;
}

function enqueueTtsPcm(floatSamples) {
  if (!(floatSamples instanceof Float32Array)
    || floatSamples.length === 0) {
    throw new TypeError('待播放 TTS PCM 必须是非空 Float32Array');
  }
  if (!playbackAudioContext
    || playbackAudioContext.state === 'closed') {
    throw new Error('播放 AudioContext 不可用');
  }

  const context = playbackAudioContext;
  const operationId = playbackOperationId;
  if (context.state === 'suspended') {
    try {
      const resumeResult = context.resume();
      if (resumeResult && typeof resumeResult.catch === 'function') {
        void resumeResult.catch((error) => {
          if (operationId === playbackOperationId) {
            void abortRelayForPlaybackError(
              `播放 AudioContext 恢复失败：${error.message}`
            );
          }
        });
      }
    } catch (error) {
      throw new Error(`播放 AudioContext 恢复失败：${error.message}`);
    }
  }

  const audioBuffer = context.createBuffer(
    1,
    floatSamples.length,
    TTS_SAMPLE_RATE
  );
  audioBuffer.copyToChannel(floatSamples, 0);

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  const startTime = Math.max(
    context.currentTime + 0.05,
    playbackNextStartTime
  );
  source.onended = () => {
    if (operationId !== playbackOperationId) {
      return;
    }
    activePlaybackSources.delete(source);
    try {
      source.disconnect();
    } catch {
      // source 可能已经断开。
    }
    finishPlaybackIfReady();
  };

  activePlaybackSources.add(source);
  try {
    source.start(startTime);
  } catch (error) {
    activePlaybackSources.delete(source);
    source.onended = null;
    try {
      source.disconnect();
    } catch {
      // 保留 source.start 的原始错误。
    }
    throw error;
  }

  playbackNextStartTime = startTime + audioBuffer.duration;
  setPlaybackState('playing');
}

async function abortRelayForPlaybackError(message) {
  appendLog(`播放错误：${message}`);
  await stopMicrophone({
    notifyRelay: false,
    reason: '播放错误',
  });
  await stopTtsPlayback({ error: true });
  cloudSessionReady = false;
  conversationActive = false;
  setTurnStateText('播放错误，对话已停止');
  setConnectionState('disconnected');
  if (relaySocket
    && (relaySocket.readyState === WebSocket.CONNECTING
      || relaySocket.readyState === WebSocket.OPEN)) {
    relaySocket.close(1011, 'playback error');
  }
}

function handleTtsBinaryMessage(arrayBuffer) {
  if (!ttsAudioStarted) {
    void abortRelayForPlaybackError('尚未收到 TTS 音频格式信息');
    return false;
  }
  if (!playbackAudioContext
    || playbackAudioContext.state === 'closed') {
    void abortRelayForPlaybackError('播放 AudioContext 不存在');
    return false;
  }
  if (ttsStreamEnded) {
    void abortRelayForPlaybackError('TTSEnded 后收到额外二进制音频');
    return false;
  }
  if (!Number.isSafeInteger(currentPlaybackGeneration)
    || interruptedPlaybackGenerations.has(currentPlaybackGeneration)) {
    return false;
  }

  try {
    const floatSamples = decodePcm16Le(arrayBuffer);
    ttsBinaryFramesReceived += 1;
    ttsBinaryBytesReceived += arrayBuffer.byteLength;
    enqueueTtsPcm(floatSamples);
  } catch (error) {
    void abortRelayForPlaybackError(error.message);
    return false;
  }
  return true;
}

function markTtsStreamEnded(message) {
  if (!Number.isSafeInteger(message.generation)
    || message.generation !== currentPlaybackGeneration
    || !Number.isSafeInteger(message.turnIndex)
    || message.turnIndex !== currentPlaybackTurnIndex
    || interruptedPlaybackGenerations.has(message.generation)) {
    return false;
  }
  expectedTtsFrames = Number.isSafeInteger(message.frames)
    && message.frames >= 0
    ? message.frames
    : -1;
  expectedTtsBytes = Number.isSafeInteger(message.bytes)
    && message.bytes >= 0
    ? message.bytes
    : -1;
  ttsStreamEnded = true;

  const countsMatch = ttsBinaryFramesReceived === expectedTtsFrames
    && ttsBinaryBytesReceived === expectedTtsBytes;
  if (!countsMatch) {
    appendLog(
      'TTS 音频统计不一致：'
      + `期望 ${expectedTtsFrames} 帧/${expectedTtsBytes} bytes，`
      + `实际 ${ttsBinaryFramesReceived} 帧/`
      + `${ttsBinaryBytesReceived} bytes`
    );
    void stopTtsPlayback({ error: true });
    return false;
  }

  finishPlaybackIfReady();
  return true;
}

async function startMicrophone() {
  if (microphoneState !== 'stopped') {
    appendLog('麦克风正在启动或运行，忽略重复启动');
    return false;
  }
  if (!cloudSessionReady
    || !conversationActive
    || conversationAudioActive
    || !relaySocket
    || relaySocket.readyState !== WebSocket.OPEN) {
    appendLog('云端 SessionStarted 尚未就绪，不能开始实时对话');
    return false;
  }

  const operationId = microphoneOperationId + 1;
  microphoneOperationId = operationId;
  resetAudioCounters();
  setMicrophoneState('starting');
  appendLog('正在准备实时对话音频并请求麦克风权限');

  try {
    await resetTtsPlaybackState({
      preserveAudioContext: true,
    });
    await preparePlaybackAudioContext();

    if (operationId !== microphoneOperationId
      || microphoneState !== 'starting') {
      return false;
    }

    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (operationId !== microphoneOperationId
      || microphoneState !== 'starting') {
      for (const track of newStream.getTracks()) {
        track.stop();
      }
      return false;
    }

    mediaStream = newStream;
    const AudioContextClass = window.AudioContext
      || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('当前浏览器不支持 AudioContext');
    }

    audioContext = new AudioContextClass({
      latencyHint: 'interactive',
    });
    await audioContext.resume();

    if (operationId !== microphoneOperationId) {
      return false;
    }

    inputSampleRate = audioContext.sampleRate;
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new Error('浏览器返回了无效的输入采样率');
    }

    await audioContext.audioWorklet.addModule(
      '/pcm_capture_processor.js'
    );

    if (operationId !== microphoneOperationId) {
      return false;
    }

    mediaSourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(
      audioContext,
      'pcm-capture-processor'
    );
    silentGainNode = audioContext.createGain();
    silentGainNode.gain.value = 0;

    workletNode.port.onmessage = (event) => {
      handleCapturedFloat32(event.data);
    };

    mediaSourceNode.connect(workletNode);
    workletNode.connect(silentGainNode);
    silentGainNode.connect(audioContext.destination);

    const audioStartSocket = relaySocket;
    const audioStartSocketContext = audioStartSocket
      ? socketProductContexts.get(audioStartSocket)
      : null;
    if (!audioStartSocket
      || audioStartSocket.readyState !== WebSocket.OPEN
      || relaySocket !== audioStartSocket
      || !audioStartSocketContext
      || audioStartSocketContext.socket !== audioStartSocket) {
      throw new Error('Relay WebSocket 已不可开始新的音频周期');
    }
    audioStartSocketContext.audioActivePublished = false;

    const startSent = sendBrowserJson({
      type: 'browser.audio_start',
      format: 'pcm_s16le',
      sampleRate: TARGET_SAMPLE_RATE,
      channels: 1,
      inputSampleRate,
    });
    if (!startSent) {
      throw new Error('Relay WebSocket 已不可发送 audio_start');
    }

    microphoneStarted = true;
    setMicrophoneState('recording');
    setTurnStateText('持续监听，等待用户说话');
    appendLog(`浏览器实际采样率：${inputSampleRate} Hz`);
    appendLog(
      `目标采样率：${TARGET_SAMPLE_RATE} Hz，`
      + `格式：pcm_s16le，每块：${PCM_BYTES_PER_CHUNK} bytes`
    );
    return true;
  } catch (error) {
    if (operationId !== microphoneOperationId) {
      return false;
    }
    appendLog(`麦克风启动失败：${error.message}`);
    await stopMicrophone({
      notifyRelay: false,
      reason: '启动失败',
    });
    await stopTtsPlayback({ error: true });
    return false;
  }
}

async function stopMicrophone(options = {}) {
  const notifyRelay = options.notifyRelay === true;
  const reason = typeof options.reason === 'string'
    ? options.reason
    : '停止';

  if (microphoneState === 'stopped') {
    return;
  }
  if (microphoneState === 'stopping') {
    if (microphoneStopPromise) {
      await microphoneStopPromise;
    }
    return;
  }

  setMicrophoneState('stopping');
  microphoneOperationId += 1;

  const shouldNotifyRelay = notifyRelay && microphoneStarted;
  const finalChunks = audioChunksSent;
  const finalBytes = audioBytesSent;

  if (workletNode) {
    workletNode.port.onmessage = null;
    try {
      workletNode.port.close();
    } catch {
      // 继续完成其余麦克风资源清理。
    }
  }

  for (const node of [mediaSourceNode, workletNode, silentGainNode]) {
    if (node) {
      try {
        node.disconnect();
      } catch {
        // 节点可能已经断开。
      }
    }
  }

  mediaSourceNode = null;
  workletNode = null;
  silentGainNode = null;

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }

  const contextToClose = audioContext;
  audioContext = null;

  microphoneStopPromise = (async () => {
    if (contextToClose && contextToClose.state !== 'closed') {
      try {
        await contextToClose.close();
      } catch (error) {
        appendLog(`AudioContext 关闭失败：${error.message}`);
      }
    }

    pendingPcmSamples = new Int16Array(0);
    resampleState = null;
    inputSampleRate = 0;
    microphoneStarted = false;

    if (shouldNotifyRelay) {
      sendBrowserJson({
        type: 'browser.audio_stop',
        chunks: finalChunks,
        bytes: finalBytes,
      });
    }

    setMicrophoneState('stopped');
    appendLog(
      `麦克风已停止（${reason}），已发送 ${finalChunks} 块、`
      + `${finalBytes} bytes；不足 320 个采样的尾块已丢弃`
    );
  })();

  try {
    await microphoneStopPromise;
  } finally {
    microphoneStopPromise = null;
  }
}

async function cleanupBeforeRelayClose(options = {}) {
  cloudSessionReady = false;
  updateMicrophoneButtons();
  await stopMicrophone({
    notifyRelay: options.notifyRelay === true,
    reason: options.reason || 'Relay 关闭',
  });
}

async function handleRelayMessage(event, socketContext) {
  if (socketContext && !isSocketContextCurrent(socketContext)) {
    return;
  }

  const messageSocket = socketContext
    ? socketContext.socket
    : relaySocket;
  const callId = socketContext
    ? socketContext.callId
    : null;
  let message;

  try {
    message = JSON.parse(event.data);
  } catch (error) {
    appendLog(`Relay 消息解析失败：${error.message}`);
    return;
  }

  if (message.type === 'relay.ready') {
    appendLog(`Relay 已就绪，版本：${message.version || 'unknown'}`);

    if (!messageSocket || messageSocket.readyState !== WebSocket.OPEN) {
      appendLog('Relay 已就绪，但连接当前不可发送');
      return;
    }

    messageSocket.send(JSON.stringify({
      type: 'browser.hello',
      client: 'doubao-browser-poc',
      characterKey: resolveRequestedCharacterKey(),
    }));
    appendLog('已发送 browser.hello');
    return;
  }

  if (message.type === 'relay.hello_ack') {
    appendLog(message.received === true
      ? '本地 Relay 双向握手成功'
      : 'Relay 未确认 browser.hello');
    return;
  }

  if (message.type === 'relay.start_connection_sent') {
    appendLog('已发送 StartConnection');
    return;
  }

  if (message.type === 'relay.connection_started') {
    appendLog('豆包 ConnectionStarted');
    return;
  }

  if (message.type === 'relay.start_session_sent') {
    appendLog('已发送 StartSession');
    return;
  }

  if (message.type === 'relay.session_started') {
    cloudSessionReady = true;
    conversationActive = true;
    conversationAudioActive = false;
    currentTurnIndex = 0;
    lastDisplayedAsrText = '';
    appendLog('豆包 SessionStarted，云端会话已就绪');
    setTurnStateText('等待开始实时对话');
    setConnectionState('connected');
    updateMicrophoneButtons();
    if (productWaiterMatches(
      pendingSessionReady,
      callId,
      messageSocket
    )) {
      pendingSessionReady.resolve({
        type: message.type,
        callId,
      });
    }
    publishRealtimeCallState('session-ready', {}, callId);
    return;
  }

  if (message.type === 'relay.audio_started') {
    if (message.mode !== 'continuous') {
      appendLog('Relay 未确认持续音频模式');
      return;
    }
    if (socketContext && socketContext.audioActivePublished === true) {
      appendLog(`已忽略 call ${callId || 'debug'} 的重复 audio_started`);
      return;
    }
    if (socketContext) {
      socketContext.audioActivePublished = true;
    }
    conversationAudioActive = true;
    setTurnStateText('持续监听，等待用户说话');
    appendLog('Relay 已开始持续接收本地 PCM');
    updateMicrophoneButtons();
    if (productWaiterMatches(
      pendingAudioActive,
      callId,
      messageSocket
    )) {
      pendingAudioActive.resolve({
        type: message.type,
        mode: message.mode,
        callId,
      });
    }
    publishRealtimeCallState('audio-active', {
      mode: message.mode,
    }, callId);
    publishRealtimeCallState('listening', {}, callId);
    return;
  }

  if (message.type === 'relay.audio_stats') {
    appendLog(
      `Relay PCM：${message.chunks} 块，${message.bytes} bytes，`
      + `约 ${message.estimatedMilliseconds} ms`
    );
    return;
  }

  if (message.type === 'relay.audio_stopped') {
    if (message.reason !== 'user_stop') {
      appendLog('Relay 返回了未知的音频停止原因');
      return;
    }
    conversationAudioActive = false;
    if (microphoneState !== 'stopped') {
      setMicrophoneState('stopped');
    } else {
      updateMicrophoneButtons();
    }
    setTurnStateText('已停止，可重新开始');
    appendLog('Relay 已确认停止实时对话，Session 保持连接');
    return;
  }

  if (message.type === 'relay.barge_in_detected') {
    stopTtsPlaybackForBargeIn(message.interruptedGeneration);
    return;
  }

  if (message.type === 'relay.asr_info') {
    if (!Number.isSafeInteger(message.turnIndex)
      || message.turnIndex <= 0) {
      appendLog('Relay 返回了无效的 ASR 轮次编号');
      return;
    }
    currentTurnIndex = message.turnIndex;
    lastDisplayedAsrText = '';
    setTurnStateText(`第 ${currentTurnIndex} 轮用户说话中`);
    appendLog(message.bargeIn === true
      ? `第 ${currentTurnIndex} 轮：用户插话已被服务端检测`
      : `第 ${currentTurnIndex} 轮：豆包检测到用户开始说话`);
    publishRealtimeCallState('listening', {
      turnIndex: currentTurnIndex,
      userSpeaking: true,
    }, callId);
    return;
  }

  if (message.type === 'relay.asr_response') {
    if (Number.isSafeInteger(message.turnIndex)
      && message.turnIndex !== currentTurnIndex) {
      return;
    }
    const text = typeof message.text === 'string'
      ? message.text
      : '';
    if (message.isInterim === true
      && text === lastDisplayedAsrText) {
      return;
    }
    lastDisplayedAsrText = text;
    appendLog(`用户转写：${text}`);
    return;
  }

  if (message.type === 'relay.asr_ended') {
    if (message.turnIndex !== currentTurnIndex) {
      appendLog('已忽略轮次不匹配的 ASREnded');
      return;
    }
    setTurnStateText(`第 ${currentTurnIndex} 轮等待回复`);
    appendLog(`第 ${currentTurnIndex} 轮：豆包 ASREnded，麦克风继续监听`);
    publishRealtimeCallState('waiting-response', {
      turnIndex: currentTurnIndex,
    }, callId);
    return;
  }

  if (message.type === 'relay.chat_response') {
    if (Number.isSafeInteger(message.turnIndex)
      && message.turnIndex !== currentTurnIndex) {
      return;
    }
    const content = typeof message.content === 'string'
      ? message.content
      : '';
    appendLog(`模型回复：${content}`);
    return;
  }

  if (message.type === 'relay.chat_ended') {
    appendLog('豆包 ChatEnded');
    return;
  }

  if (message.type === 'relay.tts_audio_started') {
    const validFormat = message.format === 'pcm_s16le'
      && message.sampleRate === TTS_SAMPLE_RATE
      && message.channels === 1;
    const validGeneration = Number.isSafeInteger(message.generation)
      && message.generation > 0;
    const validTurnIndex = Number.isSafeInteger(message.turnIndex)
      && message.turnIndex > 0;
    if (!validFormat || !validGeneration || !validTurnIndex) {
      await abortRelayForPlaybackError('TTS 音频格式信息无效');
      return;
    }
    if (interruptedPlaybackGenerations.has(message.generation)) {
      appendLog('已忽略被打断 generation 的 TTS 开始消息');
      return;
    }
    if (!playbackAudioContext
      || playbackAudioContext.state === 'closed') {
      await abortRelayForPlaybackError('播放 AudioContext 不存在');
      return;
    }
    if (activePlaybackSources.size > 0) {
      await abortRelayForPlaybackError('新 TTS generation 到达时旧音源仍在播放');
      return;
    }

    playbackOperationId += 1;
    playbackNextStartTime = playbackAudioContext.currentTime;
    currentTurnIndex = message.turnIndex;
    currentPlaybackGeneration = message.generation;
    currentPlaybackTurnIndex = message.turnIndex;
    ttsAudioStarted = true;
    ttsStreamEnded = false;
    ttsBinaryFramesReceived = 0;
    ttsBinaryBytesReceived = 0;
    expectedTtsFrames = 0;
    expectedTtsBytes = 0;
    playbackCompleted = false;
    playbackCompletionSent = false;
    setPlaybackState('buffering');
    setTurnStateText(`第 ${message.turnIndex} 轮模型播报中`);
    appendLog(
      `第 ${message.turnIndex} 轮 generation ${message.generation}：`
      + '开始接收豆包 24 kHz PCM 音频。'
    );
    publishRealtimeCallState('assistant-speaking', {
      turnIndex: message.turnIndex,
    }, callId);
    return;
  }

  if (message.type === 'relay.tts_ended') {
    if (interruptedPlaybackGenerations.has(message.generation)) {
      appendLog('已忽略被打断 generation 的 TTSEnded');
      return;
    }
    if (message.generation !== currentPlaybackGeneration
      || message.turnIndex !== currentPlaybackTurnIndex) {
      appendLog('已忽略与当前播放不匹配的 TTSEnded');
      return;
    }
    appendLog(
      `豆包 TTSEnded：generation ${message.generation}，`
      + `${message.frames} 帧，${message.bytes} bytes`
    );
    markTtsStreamEnded(message);
    return;
  }

  if (message.type === 'relay.playback_completed_ack') {
    if (message.generation !== currentPlaybackGeneration
      || message.turnIndex !== currentPlaybackTurnIndex
      || !playbackCompletionSent) {
      appendLog('已忽略与当前播放不匹配的播放完成确认');
      return;
    }
    const completedTurnIndex = currentPlaybackTurnIndex;
    const completedGeneration = currentPlaybackGeneration;
    ttsAudioStarted = false;
    ttsStreamEnded = false;
    ttsBinaryFramesReceived = 0;
    ttsBinaryBytesReceived = 0;
    expectedTtsFrames = 0;
    expectedTtsBytes = 0;
    playbackCompleted = false;
    playbackCompletionSent = false;
    currentPlaybackGeneration = undefined;
    currentPlaybackTurnIndex = undefined;
    lastDisplayedAsrText = '';
    setTurnStateText('持续监听，等待用户说话');
    appendLog(
      `第 ${completedTurnIndex} 轮 generation ${completedGeneration} `
      + '播放完成，麦克风继续监听'
    );
    publishRealtimeCallState('listening', {
      turnIndex: completedTurnIndex,
    }, callId);
    return;
  }

  if (message.type === 'relay.session_finished') {
    appendLog('豆包 SessionFinished');
    return;
  }

  if (message.type === 'relay.connection_finished') {
    appendLog('豆包 ConnectionFinished');
    return;
  }

  if (message.type === 'relay.cloud_error') {
    const cloudErrorMessage = message.message || '未知错误';
    const cloudError = new Error(`豆包云端错误：${cloudErrorMessage}`);
    appendLog(cloudError.message);
    conversationActive = false;
    conversationAudioActive = false;
    setTurnStateText('云端错误，对话已停止');
    rejectPendingProductStartup(callId, messageSocket, cloudError);
    if (isProductCallId(callId)) {
      publishRealtimeCallState('stopping', {
        recovering: true,
        message: cloudErrorMessage,
      }, callId);
    } else if (!productDisconnectRequested) {
      publishRealtimeCallState('failed', {
        message: cloudErrorMessage,
      });
    }
    await cleanupBeforeRelayClose({
      notifyRelay: false,
      reason: '云端错误',
    });
    await stopTtsPlayback({ error: true });
    if (socketContext && !isSocketContextCurrent(socketContext)) {
      return;
    }
    setConnectionState('disconnected');
    if (relaySocket
      && (relaySocket.readyState === WebSocket.CONNECTING
        || relaySocket.readyState === WebSocket.OPEN)) {
      relaySocket.close(1011, 'cloud error');
    }
    return;
  }

  if (message.type === 'relay.cloud_closed') {
    const wasConversationActive = conversationActive;
    const cloudClosedError = new Error(
      `豆包云端已关闭，code=${message.code}`
    );
    appendLog(
      `豆包云端已关闭，code=${message.code}，`
      + `reason=${message.reason || ''}`
    );
    conversationActive = false;
    conversationAudioActive = false;
    rejectPendingProductStartup(
      callId,
      messageSocket,
      cloudClosedError
    );
    if (isProductCallId(callId)) {
      publishRealtimeCallState('stopping', {
        recovering: true,
        code: message.code,
        message: message.reason || '云端连接已关闭',
      }, callId);
    } else if (!productDisconnectRequested) {
      publishRealtimeCallState('failed', {
        code: message.code,
        message: message.reason || '云端连接已关闭',
      });
    }
    setTurnStateText(wasConversationActive
      ? '云端意外关闭，对话已停止'
      : '对话已结束');
    await cleanupBeforeRelayClose({
      notifyRelay: false,
      reason: '云端关闭',
    });
    if (wasConversationActive
      && playbackState !== 'error'
      && playbackState !== 'stopped') {
      await stopTtsPlayback({ error: true });
    }
    if (socketContext && !isSocketContextCurrent(socketContext)) {
      return;
    }
    setConnectionState('disconnected');
    if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
      relaySocket.close(1000, 'cloud closed');
    }
    return;
  }

  if (message.type === 'relay.error') {
    const relayErrorMessage = message.message || '未知错误';
    appendLog(`Relay 错误：${relayErrorMessage}`);
    const startupIsPending = productWaiterMatches(
      pendingSessionReady,
      callId,
      messageSocket
    ) || productWaiterMatches(
      pendingAudioActive,
      callId,
      messageSocket
    );
    if (startupIsPending) {
      const startupError = new Error(`Relay 启动错误：${relayErrorMessage}`);
      conversationActive = false;
      conversationAudioActive = false;
      rejectPendingProductStartup(
        callId,
        messageSocket,
        startupError
      );
      if (isProductCallId(callId)) {
        publishRealtimeCallState('stopping', {
          recovering: true,
          message: relayErrorMessage,
        }, callId);
      }
      setTurnStateText('暂时未能接通，请稍后重试');
      if (messageSocket
        && (messageSocket.readyState === WebSocket.CONNECTING
          || messageSocket.readyState === WebSocket.OPEN)) {
        messageSocket.close(1011, 'relay startup error');
      }
    }
    return;
  }

  appendLog(`收到未知 Relay 消息类型：${message.type || 'undefined'}`);
}

async function connectRelay(options = {}) {
  const callId = isProductCallId(options.callId)
    ? options.callId
    : null;

  if (relaySocket) {
    const existingContext = socketProductContexts.get(relaySocket);
    if (relaySocket.readyState === WebSocket.CONNECTING
      || relaySocket.readyState === WebSocket.OPEN) {
      appendLog('Relay 正在连接或已经连接，忽略重复操作');
      return {
        status: 'already-active',
        socket: relaySocket,
        callId: existingContext ? existingContext.callId : null,
      };
    }
    if (relaySocket.readyState === WebSocket.CLOSING
      || relaySocket.readyState === WebSocket.CLOSED) {
      appendLog('Relay 旧连接尚未完成清理，暂不创建新连接');
      return {
        status: 'blocked-closing',
        socket: relaySocket,
        callId: existingContext ? existingContext.callId : null,
      };
    }
  }
  if (playbackState === 'buffering' || playbackState === 'playing') {
    appendLog('模型语音仍在播放，暂不允许新建 Relay 连接');
    return {
      status: 'blocked-playback',
      socket: null,
      callId: null,
    };
  }

  cloudSessionReady = false;
  conversationActive = false;
  conversationAudioActive = false;
  currentTurnIndex = 0;
  lastDisplayedAsrText = '';
  setTurnStateText('等待 SessionStarted');
  setConnectionState('connecting');
  appendLog('正在连接本地 Relay');

  await resetTtsPlaybackState({
    clearInterruptedGenerations: true,
    preserveAudioContext: options.preservePreparedPlayback === true,
    preserveOperationId: options.preservePreparedPlayback === true,
  });

  if (relaySocket) {
    const existingContext = socketProductContexts.get(relaySocket);
    const existingStatus = relaySocket.readyState === WebSocket.CONNECTING
      || relaySocket.readyState === WebSocket.OPEN
      ? 'already-active'
      : 'blocked-closing';
    appendLog('重置播放期间 Relay 状态已变化，未创建重复连接');
    return {
      status: existingStatus,
      socket: relaySocket,
      callId: existingContext ? existingContext.callId : null,
    };
  }

  const socket = new WebSocket(RELAY_URL);
  const socketContext = {
    callId,
    socket,
    audioActivePublished: false,
  };
  socketProductContexts.set(socket, socketContext);
  socket.binaryType = 'arraybuffer';
  relaySocket = socket;
  updateConnectionButtons();

  socket.addEventListener('open', () => {
    if (isSocketContextCurrent(socketContext)) {
      appendLog('本地 WebSocket 已打开，等待 Relay 就绪消息');
    }
  });

  socket.addEventListener('message', (event) => {
    if (!isSocketContextCurrent(socketContext)) {
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      handleTtsBinaryMessage(event.data);
      return;
    }
    void handleRelayMessage(event, socketContext);
  });

  socket.addEventListener('error', () => {
    if (isSocketContextCurrent(socketContext)) {
      appendLog('本地 WebSocket 发生错误');
    }
  });

  socket.addEventListener('close', (event) => {
    void (async () => {
      if (!isSocketContextCurrent(socketContext)) {
        return;
      }
      const wasConversationActive = conversationActive;
      cloudSessionReady = false;
      conversationActive = false;
      conversationAudioActive = false;
      await cleanupBeforeRelayClose({
        notifyRelay: false,
        reason: '本地 WebSocket 已关闭',
      });
      if (wasConversationActive
        && playbackState !== 'error'
        && playbackState !== 'stopped') {
        await stopTtsPlayback({ error: true });
        setTurnStateText('本地 WebSocket 意外关闭，对话已停止');
      }
      if (!isSocketContextCurrent(socketContext)) {
        return;
      }
      appendLog(`本地 WebSocket 已关闭，code=${event.code}`);
      relaySocket = null;
      setConnectionState('disconnected');

      const closeDetail = {
        code: event.code,
        reason: event.reason || '',
        wasClean: event.wasClean === true,
      };
      if (productWaiterMatches(
        pendingSocketClose,
        callId,
        socket
      )) {
        pendingSocketClose.resolve(closeDetail);
      }
      rejectPendingProductStartup(
        callId,
        socket,
        new Error(`本地 WebSocket 已关闭，code=${event.code}`)
      );

      if (isProductCallId(callId)) {
        const expectedDisconnect = productDisconnectContext
          && productDisconnectContext.callId === callId
          && productDisconnectContext.socket === socket;
        if (expectedDisconnect) {
          if (productDisconnectPromise === null) {
            finalizeProductCall(
              callId,
              productDisconnectContext.finalState,
              productDisconnectContext.finalState === 'failed'
                ? {
                  ...closeDetail,
                  message: productDisconnectContext.message,
                }
                : closeDetail
            );
          }
          return;
        }
        finalizeProductCall(callId, 'failed', {
          ...closeDetail,
          message: event.code === 1000
            ? '本地连接已关闭'
            : '本地连接异常关闭',
        });
      } else if (event.code === 1000) {
        publishRealtimeCallState('ended', closeDetail);
      } else {
        publishRealtimeCallState('failed', {
          ...closeDetail,
          message: '本地连接异常关闭',
        });
      }
    })();
  });

  return {
    status: 'created',
    socket,
    callId,
  };
}

async function disconnectRelay() {
  cloudSessionReady = false;
  conversationActive = false;
  conversationAudioActive = false;
  setTurnStateText('对话已结束');

  if (!relaySocket) {
    await stopTtsPlayback({ reason: '用户主动断开' });
    setConnectionState('disconnected');
    appendLog('当前没有可断开的 Relay 连接');
    return;
  }

  if (relaySocket.readyState === WebSocket.CLOSING
    || relaySocket.readyState === WebSocket.CLOSED) {
    await stopTtsPlayback({ reason: '用户主动断开' });
    appendLog('Relay 连接正在关闭或已经关闭');
    return;
  }

  appendLog('正在主动断开本地 Relay');
  await cleanupBeforeRelayClose({
    notifyRelay: true,
    reason: '主动断开 Relay',
  });
  await stopTtsPlayback({ reason: '用户主动断开' });

  if (relaySocket
    && (relaySocket.readyState === WebSocket.CONNECTING
      || relaySocket.readyState === WebSocket.OPEN)) {
    relaySocket.close(1000, 'browser disconnect');
  }
}

function warmupPlaybackForProduct() {
  if (productPlaybackWarmupPromise) {
    return productPlaybackWarmupPromise;
  }

  const warmupPromise = preparePlaybackAudioContext();
  let wrappedWarmupPromise;
  wrappedWarmupPromise = warmupPromise.finally(() => {
    if (productPlaybackWarmupPromise === wrappedWarmupPromise) {
      productPlaybackWarmupPromise = null;
    }
  });
  productPlaybackWarmupPromise = wrappedWarmupPromise;
  return wrappedWarmupPromise;
}

function connectForProduct() {
  if (productConnectPromise) {
    return productConnectPromise;
  }
  if (activeProductCallId !== null
    && cloudSessionReady
    && conversationActive
    && relaySocket
    && relaySocket.readyState === WebSocket.OPEN) {
    return Promise.resolve({
      type: 'relay.session_started',
      callId: activeProductCallId,
    });
  }

  const socketIsUnsettled = relaySocket
    && relaySocket.readyState !== WebSocket.CLOSED;
  if (productDisconnectRequested
    || productDisconnectPromise
    || activeProductCallId !== null
    || socketIsUnsettled) {
    return Promise.reject(createProductBusyError(
      '上一通叙话仍在清理，请稍后重试',
      'PRODUCT_CALL_CLEANUP_PENDING'
    ));
  }

  const connectPromise = (async () => {
    const callId = productCallSequence + 1;
    productCallSequence = callId;
    activeProductCallId = callId;
    productConnectCallId = callId;
    publishRealtimeCallState('connecting', {}, callId);

    const connectResult = await connectRelay({
      callId,
      preservePreparedPlayback: true,
    });
    if (connectResult.status !== 'created'
      || connectResult.callId !== callId
      || !connectResult.socket) {
      throw createProductBusyError(
        `Relay 暂不可创建新连接：${connectResult.status}`,
        'RELAY_CONNECT_BLOCKED'
      );
    }

    const socket = connectResult.socket;
    const sessionReadyWaiter = {
      callId,
      socket,
      ...createProductWaiter('relay.session_started', 25000),
    };
    pendingSessionReady = sessionReadyWaiter;

    try {
      if (cloudSessionReady && conversationActive) {
        sessionReadyWaiter.resolve({
          type: 'relay.session_started',
          callId,
        });
      } else if (relaySocket !== socket) {
        sessionReadyWaiter.reject(
          new Error('Relay WebSocket 所有权已变化')
        );
      }
    } catch (error) {
      sessionReadyWaiter.reject(error);
    }

    try {
      return await sessionReadyWaiter.promise;
    } finally {
      if (pendingSessionReady === sessionReadyWaiter) {
        pendingSessionReady = null;
      }
    }
  })();

  let wrappedConnectPromise;
  wrappedConnectPromise = connectPromise
    .catch((error) => {
      const callId = productConnectCallId;
      if (isProductCallId(callId)
        && error.name !== 'AbortError'
        && !productDisconnectRequested) {
        publishRealtimeCallState('stopping', {
          recovering: true,
          message: error.message,
        }, callId);
      }
      throw error;
    })
    .finally(() => {
      if (productConnectPromise === wrappedConnectPromise) {
        productConnectPromise = null;
      }
    });
  productConnectPromise = wrappedConnectPromise;
  return wrappedConnectPromise;
}

function startAudioForProduct() {
  if (productAudioStartPromise) {
    return productAudioStartPromise;
  }
  const callId = activeProductCallId;
  const socket = relaySocket;
  if (!isProductCallId(callId)
    || !socket
    || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(createProductBusyError(
      '当前没有可启动音频的叙话连接',
      'PRODUCT_CALL_NOT_READY'
    ));
  }
  if (conversationAudioActive) {
    return Promise.resolve({
      type: 'relay.audio_started',
      mode: 'continuous',
      callId,
    });
  }

  productAudioStartCallId = callId;
  const audioActiveWaiter = {
    callId,
    socket,
    ...createProductWaiter('relay.audio_started', 15000),
  };
  pendingAudioActive = audioActiveWaiter;

  const audioStartPromise = (async () => {
    const microphoneDidStart = await startMicrophone();
    if (callId !== activeProductCallId || socket !== relaySocket) {
      audioActiveWaiter.reject(
        createProductAbortError('启动音频期间叙话连接已变化')
      );
    } else if (!microphoneDidStart) {
      audioActiveWaiter.reject(new Error('麦克风未能启动'));
    } else if (conversationAudioActive) {
      audioActiveWaiter.resolve({
        type: 'relay.audio_started',
        mode: 'continuous',
        callId,
      });
    }
    return audioActiveWaiter.promise;
  })();

  let wrappedAudioStartPromise;
  wrappedAudioStartPromise = audioStartPromise
    .catch((error) => {
      if (callId === activeProductCallId
        && error.name !== 'AbortError'
        && !productDisconnectRequested) {
        publishRealtimeCallState('stopping', {
          recovering: true,
          message: error.message,
        }, callId);
      }
      throw error;
    })
    .finally(() => {
      if (pendingAudioActive === audioActiveWaiter) {
        pendingAudioActive = null;
      }
      if (productAudioStartPromise === wrappedAudioStartPromise) {
        productAudioStartPromise = null;
      }
    });
  productAudioStartPromise = wrappedAudioStartPromise;
  return wrappedAudioStartPromise;
}

function disconnectForProduct(options = {}) {
  const requestedFinalState = options.finalState === 'failed'
    ? 'failed'
    : 'ended';
  const requestedMessage = typeof options.message === 'string'
    && options.message
    ? options.message
    : '本次叙话未能开始';

  if (productDisconnectPromise) {
    if (productDisconnectContext && requestedFinalState === 'failed') {
      productDisconnectContext.finalState = 'failed';
      productDisconnectContext.message = requestedMessage;
    }
    return productDisconnectPromise;
  }

  const callId = activeProductCallId;
  const socketToClose = relaySocket;
  if (!isProductCallId(callId)) {
    if (socketToClose
      && socketToClose.readyState !== WebSocket.CLOSED) {
      return Promise.reject(createProductBusyError(
        '非产品连接仍在占用 Relay',
        'NON_PRODUCT_RELAY_ACTIVE'
      ));
    }
    return disconnectRelay().then(() => ({
      code: 1000,
      reason: 'no active product call',
      wasClean: true,
    }));
  }

  productDisconnectRequested = true;
  productDisconnectContext = {
    callId,
    socket: socketToClose,
    finalState: requestedFinalState,
    message: requestedMessage,
  };
  publishRealtimeCallState('stopping', {
    recovering: requestedFinalState === 'failed',
  }, callId);
  rejectPendingProductStartup(
    callId,
    socketToClose,
    createProductAbortError('本次产品操作已取消')
  );

  const closeWaiter = socketToClose
    ? {
      callId,
      socket: socketToClose,
      ...createProductWaiter('本地 WebSocket 正常关闭', 5000),
    }
    : null;
  if (closeWaiter) {
    pendingSocketClose = closeWaiter;
  }

  const disconnectPromise = (async () => {
    if (!socketToClose) {
      await disconnectRelay();
      const result = {
        code: 1000,
        reason: 'no active socket',
        wasClean: true,
      };
      return result;
    }

    try {
      await disconnectRelay();
    } catch (error) {
      closeWaiter.reject(error);
    }

    const closeResult = await closeWaiter.promise;
    if (closeResult.code !== 1000 && requestedFinalState !== 'failed') {
      throw new Error(
        `本地 WebSocket 未正常关闭，code=${closeResult.code}`
      );
    }
    return closeResult;
  })();

  let wrappedDisconnectPromise;
  wrappedDisconnectPromise = disconnectPromise
    .then((result) => {
      if (pendingSocketClose === closeWaiter) {
        pendingSocketClose = null;
      }
      if (productDisconnectPromise === wrappedDisconnectPromise) {
        productDisconnectPromise = null;
      }
      const disconnectContext = productDisconnectContext;
      const finalState = disconnectContext
        ? disconnectContext.finalState
        : requestedFinalState;
      const finalDetail = finalState === 'failed'
        ? {
          ...result,
          message: disconnectContext
            ? disconnectContext.message
            : requestedMessage,
        }
        : result;
      finalizeProductCall(callId, finalState, finalDetail);
      return result;
    })
    .catch((error) => {
      if (pendingSocketClose === closeWaiter) {
        pendingSocketClose = null;
      }
      if (productDisconnectPromise === wrappedDisconnectPromise) {
        productDisconnectPromise = null;
      }
      if (error.message.endsWith('等待超时')) {
        appendLog('本地 WebSocket 关闭等待超时，继续阻止新叙话');
        return {
          pending: true,
          timedOut: true,
          message: error.message,
        };
      }
      finalizeProductCall(callId, 'failed', {
        message: error.message,
      });
      throw error;
    });
  productDisconnectPromise = wrappedDisconnectPromise;
  return wrappedDisconnectPromise;
}

function subscribeToRealtimeCall(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribe 需要函数参数');
  }
  realtimeCallSubscribers.add(listener);
  listener(realtimeCallSnapshot);
  return () => {
    realtimeCallSubscribers.delete(listener);
  };
}

async function stopRealtimeConversationForUser() {
  await stopMicrophone({
    notifyRelay: false,
    reason: '用户停止实时对话',
  });
  await resetPlaybackForUserStop();

  let stopSent = false;
  try {
    stopSent = sendBrowserJson({
      type: 'browser.audio_stop',
    });
  } catch (error) {
    appendLog(`发送 audio_stop 失败：${error.message}`);
  }
  if (!stopSent) {
    conversationAudioActive = false;
    updateMicrophoneButtons();
    setTurnStateText('已停止；Relay 已不可发送');
    appendLog('本地音频已停止，但 Relay 不可发送 audio_stop');
  }
}

connectButton.addEventListener('click', () => {
  void connectRelay();
});
disconnectButton.addEventListener('click', () => {
  void disconnectRelay();
});
startMicrophoneButton.addEventListener('click', () => {
  void startMicrophone();
});
stopMicrophoneButton.addEventListener('click', () => {
  void stopRealtimeConversationForUser();
});

window.DoubaoRealtimeCall = Object.freeze({
  subscribe: subscribeToRealtimeCall,
  getSnapshot() {
    return realtimeCallSnapshot;
  },
  connect: connectForProduct,
  warmupPlayback: warmupPlaybackForProduct,
  startAudio: startAudioForProduct,
  disconnect: disconnectForProduct,
});

window.addEventListener('beforeunload', () => {
  cloudSessionReady = false;
  conversationActive = false;
  conversationAudioActive = false;
  void cleanupBeforeRelayClose({
    notifyRelay: false,
    reason: '页面卸载',
  });
  void stopTtsPlayback({ reason: '页面卸载' });
  if (relaySocket
    && (relaySocket.readyState === WebSocket.CONNECTING
      || relaySocket.readyState === WebSocket.OPEN)) {
    relaySocket.close(1000, 'page unload');
  }
});

setConnectionState('disconnected');
setMicrophoneState('stopped');
setPlaybackState('idle');
setTurnStateText('等待连接');
appendLog('页面已就绪');
publishRealtimeCallState('idle');
