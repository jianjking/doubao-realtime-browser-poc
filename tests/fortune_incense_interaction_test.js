'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_DIR = path.resolve(__dirname, '..');
const FORTUNE_HTML_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune.html'
);
const FORTUNE_JS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune.js'
);
const FORTUNE_ASR_JS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune_browser_asr.js'
);
const WORKLET_PATH = path.join(
  PROJECT_DIR,
  'public/pcm_capture_processor.js'
);
const ENTRY_CSS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/entry.css'
);

class FakeClassList {
  constructor(initialClasses = []) {
    this.classes = new Set(initialClasses);
  }

  add(...classNames) {
    classNames.forEach((className) => this.classes.add(className));
  }

  remove(...classNames) {
    classNames.forEach((className) => this.classes.delete(className));
  }

  contains(className) {
    return this.classes.has(className);
  }
}

class FakeElement {
  constructor(options = {}) {
    this.classList = new FakeClassList(options.classes);
    this.disabled = options.disabled === true;
    this.hidden = options.hidden === true;
    this.textContent = options.textContent || '';
    this.listeners = new Map();
  }

  addEventListener(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
  }

  trigger(eventName) {
    for (const handler of this.listeners.get(eventName) || []) {
      handler();
    }
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createMicrophoneStream(trackCount = 2) {
  const tracks = Array.from(
    { length: trackCount },
    () => ({
      stopCallCount: 0,
      stop() {
        this.stopCallCount += 1;
      },
    })
  );
  return {
    getTracks() {
      return tracks;
    },
    tracks,
  };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadFortuneRuntime(options = {}) {
  const page = new FakeElement({ classes: ['fortune-page'] });
  const offerButton = new FakeElement({
    textContent: '敬上一炷香',
  });
  const incenseState = new FakeElement({
    textContent: '香尚未点燃',
  });
  const acolyteGuidance = new FakeElement({
    textContent: '善信请静心，先敬上一炷香。',
  });
  const waitingState = new FakeElement({ hidden: true });
  const speechTitle = new FakeElement({
    textContent: '等待诉说',
  });
  const speechMessage = new FakeElement({
    textContent: '请慢慢说，道童会在殿前听您诉说。',
  });
  const speechDetail = new FakeElement({
    textContent: '语音只用于当前识别，不会录制为音频文件。',
  });
  const speakControlButton = new FakeElement({
    textContent: '开始诉说',
  });
  const transcriptStatus = new FakeElement({
    textContent: '等待开始',
  });
  const transcriptText = new FakeElement({
    textContent: '您的话会在这里显示。',
  });
  const elements = new Map([
    ['.fortune-page', page],
    ['[data-offer-incense]', offerButton],
    ['[data-incense-state]', incenseState],
    ['[data-acolyte-guidance]', acolyteGuidance],
    ['[data-waiting-state]', waitingState],
    ['[data-speech-title]', speechTitle],
    ['[data-speech-message]', speechMessage],
    ['[data-speech-detail]', speechDetail],
    ['[data-speak-control]', speakControlButton],
    ['[data-transcript-status]', transcriptStatus],
    ['[data-transcript-text]', transcriptText],
  ]);
  const timers = [];
  const windowListeners = new Map();
  const microphoneRequests = [];
  const defaultStream = createMicrophoneStream();
  const microphoneHandler = options.getUserMedia
    || (() => Promise.resolve(defaultStream));
  let context;
  const asrSessions = [];

  function createDefaultAsrSession(callbacks) {
    let closed = false;
    let stream = null;
    const session = {
      callbacks,
      closeCallCount: 0,
      finishCallCount: 0,
      async start() {
        try {
          const newStream = await context.navigator.mediaDevices
            .getUserMedia({ audio: true });
          if (closed) {
            newStream.getTracks().forEach((track) => track.stop());
            return false;
          }
          stream = newStream;
          callbacks.onConnecting();
          callbacks.onStarted({ inputSampleRate: 44100 });
          return true;
        } catch (error) {
          if (closed) {
            return false;
          }
          callbacks.onError({
            kind: 'microphone',
            message: error && (
              error.name === 'NotAllowedError'
              || error.name === 'SecurityError'
            )
              ? '麦克风权限未开启，请允许使用麦克风后重试。'
              : '暂时无法使用麦克风，请检查权限后再试。',
          });
          return false;
        }
      },
      finish() {
        if (closed || this.finishCallCount > 0) {
          return false;
        }
        this.finishCallCount += 1;
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        callbacks.onFinishing();
        callbacks.onFinal('测试识别结果', true);
        return true;
      },
      close() {
        if (closed) {
          return false;
        }
        closed = true;
        this.closeCallCount += 1;
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        callbacks.onClosed();
        return true;
      },
    };
    asrSessions.push(session);
    return session;
  }

  context = {
    document: {
      querySelector(selector) {
        return elements.get(selector) || null;
      },
    },
    navigator: options.unsupportedMicrophone === true
      ? {}
      : {
        mediaDevices: {
          getUserMedia(constraints) {
            microphoneRequests.push(constraints);
            return microphoneHandler(
              constraints,
              microphoneRequests.length
            );
          },
        },
      },
    window: {
      addEventListener(eventName, handler) {
        if (!windowListeners.has(eventName)) {
          windowListeners.set(eventName, []);
        }
        windowListeners.get(eventName).push(handler);
      },
      matchMedia(query) {
        assert.equal(
          query,
          '(prefers-reduced-motion: reduce)'
        );
        return { matches: options.reducedMotion === true };
      },
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    },
  };
  context.window.FortuneAsrBrowser = {
    createSession: options.createSession
      || createDefaultAsrSession,
  };

  vm.runInNewContext(
    fs.readFileSync(FORTUNE_JS_PATH, 'utf8'),
    context,
    { filename: FORTUNE_JS_PATH }
  );

  return {
    acolyteGuidance,
    defaultStream,
    incenseState,
    microphoneRequests,
    offerButton,
    page,
    speakControlButton,
    speechDetail,
    speechMessage,
    speechTitle,
    timers,
    transcriptStatus,
    transcriptText,
    asrSessions,
    triggerWindow(eventName) {
      for (const handler of windowListeners.get(eventName) || []) {
        handler();
      }
    },
    waitingState,
    windowListeners,
  };
}

function verifyStaticSceneAndSafety() {
  const html = fs.readFileSync(FORTUNE_HTML_PATH, 'utf8');
  const css = fs.readFileSync(ENTRY_CSS_PATH, 'utf8');
  const js = fs.readFileSync(FORTUNE_JS_PATH, 'utf8');
  const asrJs = fs.readFileSync(FORTUNE_ASR_JS_PATH, 'utf8');
  const workletJs = fs.readFileSync(WORKLET_PATH, 'utf8');

  assert.match(
    html,
    /<section class="temple-scene"[\s\S]*?神明高坐庙堂/
  );
  assert.match(
    html,
    /role="img" aria-label="神明高坐神龛，殿内供灯散发柔和金光"/
  );
  assert.match(
    html,
    /<section class="offering-stage"[\s\S]*?香炉与一炷未点燃的香/
  );
  assert.match(
    html,
    /<section class="acolyte-guide"[\s\S]*?<h2 id="acolyte-guide-title">道童引导<\/h2>/
  );
  assert.match(
    html,
    /data-acolyte-guidance[\s\S]*?>善信请静心，先敬上一炷香。<\/p>/
  );
  assert.match(
    html,
    /<button class="offer-incense-button" type="button" data-offer-incense>敬上一炷香<\/button>/
  );
  assert.match(
    html,
    /data-incense-state aria-live="polite">香尚未点燃<\/p>/
  );
  assert.match(
    html,
    /<section class="waiting-to-speak" data-waiting-state[\s\S]*?hidden>/
  );
  assert.match(
    html,
    /<button class="speak-control-button" type="button" data-speak-control>开始诉说<\/button>/
  );
  assert.match(
    html,
    /data-speech-message[\s\S]*?>请慢慢说，道童会在殿前听您诉说。<\/p>/
  );
  assert.match(
    html,
    /<a class="return-choice-button" href="\.\/choice\.html">返回功能选择<\/a>/
  );
  assert.match(
    html,
    /<section class="transcript-preview"[\s\S]*?语音识别预览/
  );
  assert.match(
    html,
    /data-transcript-text aria-live="polite" aria-atomic="true"/
  );
  assert.match(
    html,
    /<script src="\.\/fortune_browser_asr\.js"><\/script>\s*<script src="\.\/fortune\.js"><\/script>/
  );

  assert.match(css, /\.incense-ember\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(css, /\.incense-smoke\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(
    css,
    /\.has-offered-incense \.incense-smoke\s*\{[\s\S]*?animation-play-state:\s*running;/
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.incense-smoke\s*\{[\s\S]*?animation:\s*none !important;/
  );
  assert.match(
    css,
    /\.offer-incense-button\s*\{[\s\S]*?min-height:\s*62px;/
  );
  assert.match(
    css,
    /\.speak-control-button\s*\{[\s\S]*?min-height:\s*58px;/
  );
  assert.match(css, /\.is-listening \.waiting-to-speak\s*\{/);
  assert.match(
    css,
    /\.transcript-preview \.transcript-preview-text\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/
  );

  assert.doesNotMatch(
    html,
    /<(?:input|textarea)\b|contenteditable=|签筒|签文结果|录音波形|心愿纸/
  );
  assert.match(
    asrJs,
    /navigator\.mediaDevices\.getUserMedia\(\{\s*audio:\s*true,\s*\}\)/
  );
  assert.match(
    asrJs,
    /for \(const track of stream\.getTracks\(\)\)/
  );
  assert.match(js, /window\.addEventListener\('pagehide'/);
  assert.match(js, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(
    js,
    /localStorage|sessionStorage|document\.cookie|MediaRecorder|SpeechRecognition|fetch\(|enumerateDevices/
  );
  assert.doesNotMatch(
    asrJs,
    /127\.0\.0\.1|MediaRecorder|Blob|FileReader|base64|data:audio|WAV|wave/
  );
  assert.match(
    asrJs,
    /const WORKLET_URL = '\/realtime-assets\/pcm_capture_processor\.js';/
  );
  assert.doesNotMatch(
    asrJs,
    /const WORKLET_URL = '\/pcm_capture_processor\.js';/
  );
  assert.match(workletJs, /registerProcessor\s*\(/);
  assert.doesNotMatch(
    html,
    /<(?:input|textarea)\b|contenteditable=/
  );
  assert.doesNotMatch(
    `${html}\n${js}`,
    /神仙为您解签|神仙正在听您说话|已经保存您的心愿|已经写入心愿纸|正在为您抽签/
  );
}

function verifySingleOfferingFlow() {
  const runtime = loadFortuneRuntime();
  assert.equal(
    runtime.offerButton.listeners.get('click').length,
    1
  );
  assert.equal(runtime.offerButton.disabled, false);
  assert.equal(runtime.waitingState.hidden, true);
  assert.equal(runtime.microphoneRequests.length, 0);
  assert.equal(
    runtime.page.classList.contains('has-offered-incense'),
    false
  );

  runtime.offerButton.trigger('click');
  assert.equal(runtime.offerButton.disabled, true);
  assert.equal(runtime.offerButton.textContent, '正在敬香……');
  assert.equal(runtime.incenseState.textContent, '香火正在点亮');
  assert.equal(
    runtime.page.classList.contains('is-offering-incense'),
    true
  );
  assert.equal(runtime.timers.length, 1);
  assert.equal(runtime.timers[0].delay, 1800);

  runtime.offerButton.trigger('click');
  assert.equal(runtime.timers.length, 1);

  runtime.timers[0].callback();
  assert.equal(
    runtime.page.classList.contains('is-offering-incense'),
    false
  );
  assert.equal(
    runtime.page.classList.contains('has-offered-incense'),
    true
  );
  assert.equal(runtime.offerButton.disabled, true);
  assert.equal(runtime.offerButton.textContent, '香火已敬');
  assert.equal(runtime.incenseState.textContent, '香火已起');
  assert.equal(
    runtime.acolyteGuidance.textContent,
    '香火已起，请慢慢说说您的处境。'
  );
  assert.equal(runtime.waitingState.hidden, false);
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(runtime.speakControlButton.textContent, '开始诉说');
  assert.equal(
    runtime.speechMessage.textContent,
    '请慢慢说，道童会在殿前听您诉说。'
  );

  runtime.offerButton.trigger('click');
  assert.equal(runtime.timers.length, 1);
}

function verifyReducedMotionAndRefreshReset() {
  const reducedRuntime = loadFortuneRuntime({
    reducedMotion: true,
  });
  reducedRuntime.offerButton.trigger('click');
  assert.equal(reducedRuntime.timers.length, 0);
  assert.equal(
    reducedRuntime.page.classList.contains('has-offered-incense'),
    true
  );
  assert.equal(reducedRuntime.waitingState.hidden, false);

  const refreshedRuntime = loadFortuneRuntime();
  assert.equal(refreshedRuntime.offerButton.disabled, false);
  assert.equal(refreshedRuntime.offerButton.textContent, '敬上一炷香');
  assert.equal(refreshedRuntime.incenseState.textContent, '香尚未点燃');
  assert.equal(refreshedRuntime.waitingState.hidden, true);
  assert.equal(refreshedRuntime.microphoneRequests.length, 0);
}

function completeIncenseOffering(runtime) {
  runtime.offerButton.trigger('click');
  if (runtime.timers.length > 0) {
    runtime.timers[0].callback();
  }
}

async function verifyMicrophoneStartStopAndConcurrency() {
  const microphoneDeferred = createDeferred();
  const microphoneStream = createMicrophoneStream(3);
  const runtime = loadFortuneRuntime({
    getUserMedia() {
      return microphoneDeferred.promise;
    },
  });

  runtime.speakControlButton.trigger('click');
  assert.equal(runtime.microphoneRequests.length, 0);

  completeIncenseOffering(runtime);
  runtime.speakControlButton.trigger('click');
  assert.equal(runtime.microphoneRequests.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.microphoneRequests[0])),
    { audio: true }
  );
  assert.equal(runtime.speakControlButton.disabled, true);
  assert.equal(
    runtime.speakControlButton.textContent,
    '正在打开麦克风……'
  );
  assert.equal(runtime.speechMessage.textContent, '请允许使用麦克风。');

  runtime.speakControlButton.trigger('click');
  assert.equal(runtime.microphoneRequests.length, 1);

  microphoneDeferred.resolve(microphoneStream);
  await flushPromises();
  assert.equal(runtime.speechTitle.textContent, '道童正在聆听');
  assert.equal(
    runtime.speechMessage.textContent,
    '道童正在聆听，请慢慢说。'
  );
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(runtime.speakControlButton.textContent, '我说完了');
  assert.equal(runtime.page.classList.contains('is-listening'), true);

  runtime.speakControlButton.trigger('click');
  assert.deepEqual(
    microphoneStream.tracks.map((track) => track.stopCallCount),
    [1, 1, 1]
  );
  assert.equal(runtime.speechTitle.textContent, '识别完成');
  assert.equal(runtime.speechMessage.textContent, '识别完成');
  assert.equal(
    runtime.speechDetail.textContent,
    '识别文字仅保留在当前页面的预览区域。'
  );
  assert.equal(runtime.speakControlButton.hidden, true);
  assert.equal(runtime.transcriptStatus.textContent, '识别完成');
  assert.equal(runtime.transcriptText.textContent, '测试识别结果');

  runtime.triggerWindow('pagehide');
  assert.deepEqual(
    microphoneStream.tracks.map((track) => track.stopCallCount),
    [1, 1, 1]
  );
}

async function verifyMicrophoneErrorsAndRetry() {
  const retryStream = createMicrophoneStream();
  let attemptCount = 0;
  const runtime = loadFortuneRuntime({
    getUserMedia() {
      attemptCount += 1;
      if (attemptCount === 1) {
        return Promise.reject({ name: 'NotAllowedError' });
      }
      return Promise.resolve(retryStream);
    },
  });
  completeIncenseOffering(runtime);

  runtime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(runtime.microphoneRequests.length, 1);
  assert.equal(runtime.speechTitle.textContent, '暂时无法使用麦克风');
  assert.equal(
    runtime.speechMessage.textContent,
    '麦克风权限未开启，请允许使用麦克风后重试。'
  );
  assert.equal(runtime.speakControlButton.textContent, '重新诉说');
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(
    runtime.page.classList.contains('is-listening'),
    false
  );

  runtime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(runtime.microphoneRequests.length, 2);
  assert.equal(runtime.speakControlButton.textContent, '我说完了');

  const unsupportedRuntime = loadFortuneRuntime({
    unsupportedMicrophone: true,
  });
  completeIncenseOffering(unsupportedRuntime);
  unsupportedRuntime.speakControlButton.trigger('click');
  assert.equal(unsupportedRuntime.microphoneRequests.length, 0);
  assert.equal(
    unsupportedRuntime.speechMessage.textContent,
    '暂时无法使用麦克风，请检查权限后再试。'
  );
  assert.equal(
    unsupportedRuntime.speakControlButton.textContent,
    '重新诉说'
  );

  const systemErrorRuntime = loadFortuneRuntime({
    getUserMedia() {
      return Promise.reject({ name: 'NotReadableError' });
    },
  });
  completeIncenseOffering(systemErrorRuntime);
  systemErrorRuntime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(
    systemErrorRuntime.speechMessage.textContent,
    '暂时无法使用麦克风，请检查权限后再试。'
  );
}

async function verifyPageExitCleanup() {
  const activeStream = createMicrophoneStream(2);
  const activeRuntime = loadFortuneRuntime({
    getUserMedia() {
      return Promise.resolve(activeStream);
    },
  });
  completeIncenseOffering(activeRuntime);
  activeRuntime.speakControlButton.trigger('click');
  await flushPromises();
  activeRuntime.triggerWindow('pagehide');
  assert.equal(activeRuntime.asrSessions[0].closeCallCount, 1);
  assert.deepEqual(
    activeStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  activeRuntime.triggerWindow('beforeunload');
  assert.equal(activeRuntime.asrSessions[0].closeCallCount, 1);
  assert.deepEqual(
    activeStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  activeRuntime.triggerWindow('pageshow');
  assert.equal(activeRuntime.speakControlButton.textContent, '开始诉说');

  const pendingDeferred = createDeferred();
  const lateStream = createMicrophoneStream(2);
  const pendingRuntime = loadFortuneRuntime({
    getUserMedia() {
      return pendingDeferred.promise;
    },
  });
  completeIncenseOffering(pendingRuntime);
  pendingRuntime.speakControlButton.trigger('click');
  pendingRuntime.triggerWindow('pagehide');
  assert.equal(pendingRuntime.asrSessions[0].closeCallCount, 1);
  pendingDeferred.resolve(lateStream);
  await flushPromises();
  assert.deepEqual(
    lateStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  assert.equal(
    pendingRuntime.page.classList.contains('is-listening'),
    false
  );
}

function loadFortuneAsrRuntime(options = {}) {
  const sockets = [];
  const audioContexts = [];
  const workletNodes = [];
  const microphoneRequests = [];
  const timers = [];
  const defaultStream = createMicrophoneStream();
  const microphoneHandler = options.getUserMedia
    || (() => Promise.resolve(defaultStream));
  let nextTimerId = 1;

  class FakeAudioNode {
    constructor() {
      this.connectCalls = [];
      this.disconnectCallCount = 0;
      this.gain = { value: 1 };
    }

    connect(target) {
      this.connectCalls.push(target);
      return target;
    }

    disconnect() {
      this.disconnectCallCount += 1;
    }
  }

  class FakeAudioContext {
    constructor() {
      this.sampleRate = options.sampleRate || 44100;
      this.state = 'running';
      this.destination = new FakeAudioNode();
      this.closeCallCount = 0;
      this.resumeCallCount = 0;
      this.sourceNodes = [];
      this.gainNodes = [];
      this.audioWorklet = options.unsupportedWorklet === true
        ? null
        : {
          addModule: async (url) => {
            this.workletModuleUrl = url;
            if (options.workletLoadError) {
              throw options.workletLoadError;
            }
          },
        };
      audioContexts.push(this);
    }

    async resume() {
      this.resumeCallCount += 1;
      if (options.resumeError) {
        throw options.resumeError;
      }
    }

    createMediaStreamSource(stream) {
      this.sourceStream = stream;
      const node = new FakeAudioNode();
      this.sourceNodes.push(node);
      return node;
    }

    createGain() {
      const node = new FakeAudioNode();
      this.gainNodes.push(node);
      return node;
    }

    async close() {
      this.closeCallCount += 1;
      this.state = 'closed';
    }
  }

  class FakeAudioWorkletNode extends FakeAudioNode {
    constructor(context, name) {
      super();
      this.context = context;
      this.name = name;
      this.port = {
        closeCallCount: 0,
        onmessage: null,
        onmessageerror: null,
        close() {
          this.closeCallCount += 1;
        },
      };
      workletNodes.push(this);
    }

    emitFloat32(samples) {
      if (this.port.onmessage) {
        this.port.onmessage({ data: samples });
      }
    }
  }

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.binaryType = '';
      this.sent = [];
      this.closeCalls = [];
      this.failSend = false;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(eventName, handler) {
      if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, new Set());
      }
      this.listeners.get(eventName).add(handler);
    }

    removeEventListener(eventName, handler) {
      const listeners = this.listeners.get(eventName);
      if (listeners) {
        listeners.delete(handler);
      }
    }

    send(data) {
      if (this.readyState !== FakeWebSocket.OPEN) {
        throw new Error('socket is not open');
      }
      if (this.failSend) {
        throw new Error('fake send failure');
      }
      this.sent.push(data);
    }

    close(code, reason) {
      this.closeCalls.push({ code, reason: String(reason) });
      this.readyState = FakeWebSocket.CLOSED;
    }

    emit(eventName, event = {}) {
      for (const handler of this.listeners.get(eventName) || []) {
        handler(event);
      }
    }

    emitJson(message) {
      this.emit('message', { data: JSON.stringify(message) });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    }
  }

  const navigatorValue = options.unsupportedMicrophone === true
    ? {}
    : {
      mediaDevices: {
        getUserMedia(constraints) {
          microphoneRequests.push(constraints);
          return microphoneHandler(
            constraints,
            microphoneRequests.length
          );
        },
      },
    };
  const windowValue = {
    AudioContext: options.unsupportedAudioContext === true
      ? undefined
      : FakeAudioContext,
    AudioWorkletNode: options.unsupportedAudioWorkletNode === true
      ? undefined
      : FakeAudioWorkletNode,
    WebSocket: FakeWebSocket,
    clearTimeout(timerId) {
      const timer = timers.find((item) => item.id === timerId);
      if (timer) {
        timer.active = false;
      }
    },
    location: {
      hostname: options.hostname || '192.168.10.24',
      protocol: options.protocol || 'http:',
    },
    setTimeout(callback, delay) {
      const timer = {
        active: true,
        callback,
        delay,
        id: nextTimerId,
      };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
  };
  const context = vm.createContext({
    navigator: navigatorValue,
    window: windowValue,
  });
  vm.runInContext(
    fs.readFileSync(FORTUNE_ASR_JS_PATH, 'utf8'),
    context,
    { filename: FORTUNE_ASR_JS_PATH }
  );

  return {
    api: windowValue.FortuneAsrBrowser,
    audioContexts,
    defaultStream,
    microphoneRequests,
    sockets,
    timers,
    workletNodes,
  };
}

function isArrayBuffer(value) {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function parseSentJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : null;
}

async function startRealAsrSession(runtime, callbacks = {}) {
  const session = runtime.api.createSession(callbacks);
  assert.equal(await session.start(), true);
  assert.equal(runtime.microphoneRequests.length, 1);
  assert.equal(runtime.sockets.length, 1);
  const socket = runtime.sockets[0];
  socket.open();
  return { session, socket };
}

function verifyRelayUrlAndInitialPrivacy() {
  const runtime = loadFortuneAsrRuntime();
  assert.equal(runtime.microphoneRequests.length, 0);
  assert.equal(runtime.sockets.length, 0);
  assert.equal(runtime.audioContexts.length, 0);
  assert.equal(
    runtime.api.buildFortuneAsrWebSocketUrl(),
    'ws://192.168.10.24:3001/fortune-asr'
  );

  const secureRuntime = loadFortuneAsrRuntime({
    hostname: 'temple.example.test',
    protocol: 'https:',
  });
  assert.equal(
    secureRuntime.api.buildFortuneAsrWebSocketUrl(),
    'wss://temple.example.test:3001/fortune-asr'
  );
}

async function verifyStartProtocolAndRealSampleRate() {
  const startedEvents = [];
  const runtime = loadFortuneAsrRuntime({ sampleRate: 44100 });
  const session = runtime.api.createSession({
    onStarted(event) {
      startedEvents.push(event);
    },
  });
  const firstStart = session.start();
  assert.equal(await session.start(), false);
  assert.equal(await firstStart, true);
  assert.equal(runtime.microphoneRequests.length, 1);
  assert.equal(runtime.sockets.length, 1);
  assert.equal(runtime.audioContexts.length, 0);

  const socket = runtime.sockets[0];
  socket.open();
  socket.emitJson({ type: 'fortune.asr.ready' });
  assert.deepEqual(
    JSON.parse(socket.sent[0]),
    {
      type: 'fortune.asr.start',
      audio: {
        format: 'pcm_s16le',
        sampleRate: 16000,
        bitsPerSample: 16,
        channels: 1,
      },
    }
  );
  assert.equal(
    socket.sent.some((value) => isArrayBuffer(value)),
    false
  );

  socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  assert.equal(runtime.audioContexts.length, 1);
  assert.equal(runtime.audioContexts[0].sampleRate, 44100);
  assert.equal(
    runtime.audioContexts[0].workletModuleUrl,
    '/realtime-assets/pcm_capture_processor.js'
  );
  assert.equal(runtime.workletNodes.length, 1);
  assert.equal(runtime.workletNodes[0].name, 'pcm-capture-processor');
  assert.equal(startedEvents.length, 1);
  assert.equal(startedEvents[0].inputSampleRate, 44100);

  runtime.workletNodes[0].emitFloat32(
    new Float32Array(8821).fill(0.5)
  );
  const binaryFrames = socket.sent.filter(isArrayBuffer);
  assert.equal(binaryFrames.length, 1);
  assert.equal(binaryFrames[0].byteLength, 6400);
  const view = new DataView(binaryFrames[0]);
  assert.equal(view.getInt16(0, true), 16384);
  assert.equal(new Uint8Array(binaryFrames[0])[0], 0);
  assert.equal(new Uint8Array(binaryFrames[0])[1], 64);
}

async function verifyTailFinishFinalAndCleanup() {
  const finalEvents = [];
  const phaseEvents = [];
  const runtime = loadFortuneAsrRuntime({ sampleRate: 32000 });
  const { session, socket } = await startRealAsrSession(runtime, {
    onFinal(text, completesSession) {
      finalEvents.push({ completesSession, text });
    },
    onFinishing() {
      phaseEvents.push('finishing');
    },
  });
  socket.emitJson({ type: 'fortune.asr.ready' });
  socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  const worklet = runtime.workletNodes[0];
  worklet.emitFloat32(new Float32Array(3200).fill(-1));
  assert.equal(socket.sent.filter(isArrayBuffer).length, 0);
  const stalePortHandler = worklet.port.onmessage;

  assert.equal(session.finish(), true);
  assert.equal(session.finish(), false);
  const tailIndex = socket.sent.findIndex(isArrayBuffer);
  const finishIndex = socket.sent.findIndex((value) => {
    const message = parseSentJson(value);
    return message && message.type === 'fortune.asr.finish';
  });
  assert.ok(tailIndex >= 0);
  assert.ok(finishIndex > tailIndex);
  assert.equal(socket.sent[tailIndex].byteLength, 3200);
  assert.equal(
    new DataView(socket.sent[tailIndex]).getInt16(0, true),
    -32768
  );
  assert.equal(socket.closeCalls.length, 0);
  assert.equal(phaseEvents.length, 1);
  assert.deepEqual(
    runtime.defaultStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  assert.equal(runtime.audioContexts[0].closeCallCount, 1);
  assert.equal(worklet.port.onmessage, null);
  assert.equal(worklet.port.closeCallCount, 1);

  stalePortHandler({
    data: new Float32Array(6400).fill(1),
  });
  assert.equal(socket.sent.filter(isArrayBuffer).length, 1);

  socket.emitJson({
    type: 'fortune.asr.final',
    text: '我最近总担心孩子的工作。',
  });
  assert.deepEqual(finalEvents, [{
    completesSession: true,
    text: '我最近总担心孩子的工作。',
  }]);
  assert.equal(session.state, 'transcript-ready');
  assert.equal(socket.closeCalls.length, 1);
  assert.equal(
    runtime.timers.filter((timer) => timer.active).length,
    0
  );
}

async function verifyPartialFinalPreviewAndStaleRetry() {
  const createdSessions = [];
  const runtime = loadFortuneRuntime({
    createSession(callbacks) {
      const session = {
        callbacks,
        closeCallCount: 0,
        finishCallCount: 0,
        start() {
          callbacks.onConnecting();
          return Promise.resolve(true);
        },
        finish() {
          this.finishCallCount += 1;
          callbacks.onFinishing();
          return this.finishCallCount === 1;
        },
        close() {
          this.closeCallCount += 1;
          callbacks.onClosed();
          return this.closeCallCount === 1;
        },
      };
      createdSessions.push(session);
      return session;
    },
  });
  completeIncenseOffering(runtime);
  runtime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(createdSessions.length, 1);
  assert.equal(
    runtime.speechMessage.textContent,
    '正在准备聆听，请稍候……'
  );
  createdSessions[0].callbacks.onStarted({ inputSampleRate: 48000 });
  assert.equal(runtime.speechMessage.textContent, '道童正在聆听，请慢慢说。');

  createdSessions[0].callbacks.onPartial('我最近');
  assert.equal(runtime.transcriptText.textContent, '我最近');
  createdSessions[0].callbacks.onPartial('我最近总担心');
  assert.equal(runtime.transcriptText.textContent, '我最近总担心');
  createdSessions[0].callbacks.onPartial('');
  assert.equal(runtime.transcriptText.textContent, '我最近总担心');
  createdSessions[0].callbacks.onFinal('我最近总担心孩子的工作。', false);
  assert.equal(
    runtime.transcriptText.textContent,
    '我最近总担心孩子的工作。'
  );
  assert.equal(runtime.transcriptStatus.textContent, '识别完成');

  runtime.speakControlButton.trigger('click');
  assert.equal(createdSessions[0].finishCallCount, 1);
  assert.equal(runtime.speechMessage.textContent, '正在整理您的话……');
  createdSessions[0].callbacks.onFinal(
    '我最近总担心孩子的工作。',
    true
  );
  assert.equal(runtime.speechMessage.textContent, '识别完成');

  createdSessions[0].callbacks.onError({
    kind: 'asr',
    message: '语音识别暂时不可用，请重新诉说。',
  });
  assert.equal(runtime.speechMessage.textContent, '识别完成');

  const workletErrorRuntime = loadFortuneRuntime({
    createSession(callbacks) {
      return {
        close() {
          return true;
        },
        finish() {
          return false;
        },
        start() {
          callbacks.onConnecting();
          callbacks.onError({
            kind: 'worklet',
            message: '语音采集组件加载失败，请刷新页面后重试。',
          });
          return Promise.resolve(false);
        },
      };
    },
  });
  completeIncenseOffering(workletErrorRuntime);
  workletErrorRuntime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(
    workletErrorRuntime.speechMessage.textContent,
    '语音采集组件加载失败，请刷新页面后重试。'
  );
  assert.equal(
    workletErrorRuntime.speechDetail.textContent,
    '如果问题仍然存在，请重新打开求签页面。'
  );
  assert.equal(
    (
      workletErrorRuntime.speechMessage.textContent
      + workletErrorRuntime.speechDetail.textContent
    ).includes('Relay'),
    false
  );

  const retryRuntime = loadFortuneRuntime({
    createSession(callbacks) {
      const session = {
        callbacks,
        close() {
          return true;
        },
        finish() {
          return false;
        },
        start() {
          callbacks.onConnecting();
          callbacks.onError({
            kind: 'asr',
            message: '语音识别暂时不可用，请重新诉说。',
          });
          return Promise.resolve(false);
        },
      };
      createdSessions.push(session);
      return session;
    },
  });
  completeIncenseOffering(retryRuntime);
  retryRuntime.speakControlButton.trigger('click');
  await flushPromises();
  const failedSession = createdSessions.at(-1);
  assert.equal(
    retryRuntime.speechMessage.textContent,
    '暂时无法连接语音识别服务，请确认服务已启动后重试。'
  );
  assert.equal(
    retryRuntime.speechDetail.textContent,
    '请确认语音识别服务已启动后再试。'
  );
  assert.equal(
    retryRuntime.speechDetail.textContent.includes('Relay'),
    false
  );
  assert.equal(retryRuntime.speakControlButton.textContent, '重新诉说');
  retryRuntime.speakControlButton.trigger('click');
  await flushPromises();
  assert.notEqual(createdSessions.at(-1), failedSession);
  failedSession.callbacks.onPartial('迟到的旧识别');
  assert.notEqual(retryRuntime.transcriptText.textContent, '迟到的旧识别');
}

async function verifyAsrErrorsTimeoutAndIdempotentClose() {
  const errorEvents = [];
  const runtime = loadFortuneAsrRuntime();
  const { session, socket } = await startRealAsrSession(runtime, {
    onError(error) {
      errorEvents.push(error);
    },
  });
  socket.emitJson({
    type: 'fortune.asr.error',
    error: {
      code: 'SECRET_UPSTREAM_CODE',
      message: 'fake-api-key should not be shown',
    },
  });
  assert.equal(errorEvents.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(errorEvents[0])),
    {
      kind: 'asr',
      message: '语音识别暂时不可用，请重新诉说。',
    }
  );
  assert.equal(
    JSON.stringify(errorEvents).includes('fake-api-key'),
    false
  );
  assert.equal(session.close(), true);
  assert.equal(session.close(), false);

  const timeoutErrors = [];
  const timeoutRuntime = loadFortuneAsrRuntime();
  const timeoutConnection = await startRealAsrSession(
    timeoutRuntime,
    {
      onError(error) {
        timeoutErrors.push(error);
      },
    }
  );
  timeoutConnection.socket.emitJson({ type: 'fortune.asr.ready' });
  timeoutConnection.socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  assert.equal(timeoutConnection.session.finish(), true);
  const finalTimer = timeoutRuntime.timers.find(
    (timer) => timer.active && timer.delay === 18000
  );
  assert.ok(finalTimer);
  finalTimer.callback();
  assert.equal(timeoutErrors.length, 1);
  assert.equal(timeoutErrors[0].kind, 'final');
  assert.equal(
    timeoutErrors[0].message,
    '语音识别暂时没有完成，请重新诉说。'
  );
  assert.equal(timeoutConnection.socket.closeCalls.length, 1);

  const sendErrors = [];
  const sendRuntime = loadFortuneAsrRuntime();
  const sendConnection = await startRealAsrSession(sendRuntime, {
    onError(error) {
      sendErrors.push(error);
    },
  });
  sendConnection.socket.emitJson({ type: 'fortune.asr.ready' });
  sendConnection.socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  sendConnection.socket.failSend = true;
  sendRuntime.workletNodes[0].emitFloat32(
    new Float32Array(9601).fill(0.25)
  );
  assert.equal(sendErrors.length, 1);
  assert.equal(sendErrors[0].kind, 'asr');
  assert.equal(sendConnection.session.state, 'failed');
}

async function verifyModulePageExitAndFailureBoundaries() {
  const activeRuntime = loadFortuneAsrRuntime();
  const activeConnection = await startRealAsrSession(activeRuntime);
  activeConnection.socket.emitJson({ type: 'fortune.asr.ready' });
  activeConnection.socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  assert.equal(activeConnection.session.close(), true);
  assert.equal(activeConnection.session.close(), false);
  assert.deepEqual(
    activeRuntime.defaultStream.tracks.map(
      (track) => track.stopCallCount
    ),
    [1, 1]
  );
  assert.equal(activeRuntime.audioContexts[0].closeCallCount, 1);
  assert.equal(activeRuntime.workletNodes[0].port.onmessage, null);
  assert.equal(activeRuntime.workletNodes[0].port.closeCallCount, 1);
  assert.equal(activeConnection.socket.closeCalls.length, 1);

  const pendingMicrophone = createDeferred();
  const lateStream = createMicrophoneStream();
  const pendingRuntime = loadFortuneAsrRuntime({
    getUserMedia() {
      return pendingMicrophone.promise;
    },
  });
  const pendingSession = pendingRuntime.api.createSession();
  const startPromise = pendingSession.start();
  assert.equal(pendingSession.close(), true);
  pendingMicrophone.resolve(lateStream);
  assert.equal(await startPromise, false);
  assert.deepEqual(
    lateStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  assert.equal(pendingRuntime.sockets.length, 0);

  const unsupportedErrors = [];
  const unsupportedRuntime = loadFortuneAsrRuntime({
    unsupportedAudioContext: true,
  });
  const unsupportedConnection = await startRealAsrSession(
    unsupportedRuntime,
    {
      onError(error) {
        unsupportedErrors.push(error);
      },
    }
  );
  unsupportedConnection.socket.emitJson({ type: 'fortune.asr.ready' });
  unsupportedConnection.socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  assert.equal(unsupportedErrors.length, 1);
  assert.equal(unsupportedErrors[0].kind, 'audio');

  const workletErrors = [];
  const workletRuntime = loadFortuneAsrRuntime({
    workletLoadError: new Error('fake worklet load failure'),
  });
  const workletConnection = await startRealAsrSession(
    workletRuntime,
    {
      onError(error) {
        workletErrors.push(error);
      },
    }
  );
  workletConnection.socket.emitJson({ type: 'fortune.asr.ready' });
  workletConnection.socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  assert.equal(workletErrors.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(workletErrors[0])),
    {
      kind: 'worklet',
      message: '语音采集组件加载失败，请刷新页面后重试。',
    }
  );
  assert.equal(workletRuntime.workletNodes.length, 0);
  assert.equal(workletRuntime.audioContexts[0].closeCallCount, 1);
  assert.deepEqual(
    workletRuntime.defaultStream.tracks.map(
      (track) => track.stopCallCount
    ),
    [1, 1]
  );
  assert.equal(workletConnection.socket.closeCalls.length, 1);

  const processorErrors = [];
  const processorRuntime = loadFortuneAsrRuntime();
  const processorConnection = await startRealAsrSession(
    processorRuntime,
    {
      onError(error) {
        processorErrors.push(error);
      },
    }
  );
  processorConnection.socket.emitJson({ type: 'fortune.asr.ready' });
  processorConnection.socket.emitJson({ type: 'fortune.asr.started' });
  await flushPromises();
  processorRuntime.workletNodes[0].onprocessorerror();
  assert.equal(processorErrors.length, 1);
  assert.equal(processorErrors[0].kind, 'audio');
  assert.equal(
    processorErrors[0].message,
    '音频采集暂时中断，请重新诉说。'
  );

  const abnormalErrors = [];
  const abnormalRuntime = loadFortuneAsrRuntime();
  const abnormalConnection = await startRealAsrSession(
    abnormalRuntime,
    {
      onError(error) {
        abnormalErrors.push(error);
      },
    }
  );
  abnormalConnection.socket.emit('close', { code: 1006 });
  assert.equal(abnormalErrors.length, 1);
  assert.equal(
    abnormalErrors[0].message,
    '语音识别连接异常，请重新诉说。'
  );
}

async function main() {
  verifyStaticSceneAndSafety();
  verifySingleOfferingFlow();
  verifyReducedMotionAndRefreshReset();
  await verifyMicrophoneStartStopAndConcurrency();
  await verifyMicrophoneErrorsAndRetry();
  await verifyPageExitCleanup();
  verifyRelayUrlAndInitialPrivacy();
  await verifyStartProtocolAndRealSampleRate();
  await verifyTailFinishFinalAndCleanup();
  await verifyPartialFinalPreviewAndStaleRetry();
  await verifyAsrErrorsTimeoutAndIdempotentClose();
  await verifyModulePageExitAndFailureBoundaries();

  process.stdout.write('fortune_incense_interaction_test: PASS\n');
  process.stdout.write(
    'verified=temple-scene,incense-offering,reduced-motion,'
      + 'microphone-user-gesture,single-request,start-stop,'
      + 'all-tracks-stopped,permission-error,retry,unsupported-api,'
      + 'pagehide-beforeunload,late-stream-cleanup,no-recording-upload,'
      + 'relay-url,start-started,real-sample-rate,resample-pcm16-le,'
      + 'binary-chunks,tail-before-finish,partial-final-preview,'
      + 'final-timeout,asr-error,abnormal-close,stale-session\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
