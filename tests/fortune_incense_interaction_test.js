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
const realtimeWebSocketUrl = require('../public/realtime_websocket_url');
const WORKLET_PATH = path.join(
  PROJECT_DIR,
  'public/pcm_capture_processor.js'
);
const ENTRY_CSS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/entry.css'
);
const DAOTONG_ASSET_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/assets/fortune/daotong-guide-v1.png'
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

class FakeStyle {
  constructor() {
    this.properties = new Map();
  }

  getPropertyValue(name) {
    return this.properties.get(name) || '';
  }

  removeProperty(name) {
    const previousValue = this.getPropertyValue(name);
    this.properties.delete(name);
    return previousValue;
  }

  setProperty(name, value) {
    this.properties.set(name, String(value));
  }
}

class FakeElement {
  constructor(options = {}) {
    this.classList = new FakeClassList(options.classes);
    this.disabled = options.disabled === true;
    this.hidden = options.hidden === true;
    this.textContent = options.textContent || '';
    this.dataset = { ...(options.dataset || {}) };
    this.attributes = new Map(
      Object.entries(options.attributes || {})
    );
    this.focusCallCount = 0;
    this.getBoundingClientRectCallCount = 0;
    this.listeners = new Map();
    this.rect = {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      ...(options.rect || {}),
    };
    this.style = new FakeStyle();
  }

  addEventListener(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
  }

  removeEventListener(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    this.listeners.set(
      eventName,
      handlers.filter((candidate) => candidate !== handler)
    );
  }

  trigger(eventName, event = { target: this }) {
    for (const handler of this.listeners.get(eventName) || []) {
      handler(event);
    }
  }

  dispatchEvent(event) {
    this.trigger(event.type, event);
    return true;
  }

  getAttribute(name) {
    return this.attributes.has(name)
      ? this.attributes.get(name)
      : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {
    this.focusCallCount += 1;
  }

  getBoundingClientRect() {
    this.getBoundingClientRectCallCount += 1;
    return { ...this.rect };
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

function clickSpeakControl(runtime) {
  runtime.speakControlButton.trigger('click');
}

function swipeFortuneScene(runtime, pointerId, startX, endX) {
  const baseEvent = {
    button: 0,
    clientY: 300,
    isPrimary: true,
    pointerId,
    target: runtime.page,
  };
  runtime.page.trigger('pointerdown', {
    ...baseEvent,
    clientX: startX,
  });
  runtime.page.trigger('pointerup', {
    ...baseEvent,
    clientX: endX,
    preventDefault() {},
  });
}

function loadFortuneRuntime(options = {}) {
  const page = new FakeElement({
    classes: ['fortune-page'],
    dataset: { fortuneCharacterKey: 'yuhuang' },
  });
  const fortuneCharacterImage = new FakeElement({
    attributes: {
      alt: '当前所选神仙角色主视觉',
      src: './assets/characters/yuhuang/yuhuang-home-hero-v1.png',
    },
    dataset: { fortuneCharacterImage: '' },
  });
  const fortuneCharacterUnavailable = new FakeElement({ hidden: true });
  const fortuneCharacterName = new FakeElement({
    textContent: '观音菩萨',
  });
  const offerButton = new FakeElement({ hidden: true });
  const incenseState = new FakeElement({
    textContent: '三柱清香已燃',
  });
  const acolyteGuidance = new FakeElement({
    textContent: '点击下方“开始说话”，说完后再点击“结束说话”。',
  });
  const waitingState = new FakeElement();
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
    textContent: '开始说话',
  });
  const transcriptStatus = new FakeElement({
    textContent: '正在聆听',
  });
  const transcriptText = new FakeElement({
    textContent: '',
  });
  const wishPaper = new FakeElement({
    hidden: true,
    attributes: { 'aria-busy': 'false' },
    rect: {
      bottom: 590,
      height: 180,
      left: 24,
      right: 406,
      top: 410,
      width: 382,
    },
  });
  const wishOfferingStage = new FakeElement({
    hidden: true,
  });
  const wishFurnaceMouth = new FakeElement({
    rect: {
      bottom: 699,
      height: 34,
      left: 173,
      right: 257,
      top: 665,
      width: 84,
    },
  });
  const flyingWishPaper = new FakeElement();
  const flyingWishPaperText = new FakeElement();
  const wishOfferingComplete = new FakeElement({ hidden: true });
  const fortuneDrawAnimation = new FakeElement({ hidden: true });
  const fortuneError = new FakeElement({ hidden: true });
  const retryFortuneButton = new FakeElement({
    disabled: true,
    textContent: '重新求签',
  });
  const fortuneResult = new FakeElement({ hidden: true });
  const lotNumber = new FakeElement();
  const lotLevel = new FakeElement();
  const lotTitle = new FakeElement();
  const lotVerses = new FakeElement();
  const interpretFortuneButton = new FakeElement({
    disabled: true,
    hidden: true,
    textContent: '请道童解签',
  });
  const interpretationError = new FakeElement({ hidden: true });
  const retryInterpretationButton = new FakeElement({
    disabled: true,
    textContent: '重新请道童解签',
  });
  const interpretationResult = new FakeElement({ hidden: true });
  const interpretationText = new FakeElement();
  const interpretationAudio = new FakeElement({ hidden: true });
  const interpretationAudioStatus = new FakeElement({
    textContent: '需要时，可请道童为您读出这份解签。',
  });
  const interpretationAudioControl = new FakeElement({
    textContent: '听道童解签',
  });
  const fortuneReturnLink = new FakeElement();
  const resetFortuneButton = new FakeElement({ hidden: true });
  const fortunePrice = options.paidUi ? new FakeElement() : null;
  const fortuneBalance = options.paidUi ? new FakeElement() : null;
  const fortuneErrorTitle = options.paidUi ? new FakeElement() : null;
  const fortuneErrorMessage = options.paidUi ? new FakeElement() : null;
  const fortuneRechargeButton = options.paidUi
    ? new FakeElement({ hidden: true })
    : null;
  const fortuneChargeSuccess = options.paidUi
    ? new FakeElement({ hidden: true })
    : null;
  const fortuneLoginOverlay = options.paidUi
    ? new FakeElement({ hidden: true })
    : null;
  const loginForFortuneButton = options.paidUi ? new FakeElement() : null;
  const closeFortuneLoginButton = options.paidUi ? new FakeElement() : null;
  const rechargeEntry = options.paidUi ? new FakeElement() : null;
  const elements = new Map([
    ['.fortune-page', page],
    ['[data-fortune-character-image]', fortuneCharacterImage],
    ['[data-fortune-character-name]', fortuneCharacterName],
    [
      '[data-fortune-character-unavailable]',
      fortuneCharacterUnavailable,
    ],
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
    ['[data-wish-paper]', wishPaper],
    ['[data-wish-offering-stage]', wishOfferingStage],
    ['[data-wish-furnace-mouth]', wishFurnaceMouth],
    ['[data-flying-wish-paper]', flyingWishPaper],
    ['[data-flying-wish-paper-text]', flyingWishPaperText],
    ['[data-wish-offering-complete]', wishOfferingComplete],
    ['[data-fortune-draw-animation]', fortuneDrawAnimation],
    ['[data-fortune-error]', fortuneError],
    ['[data-retry-fortune]', retryFortuneButton],
    ['[data-fortune-result]', fortuneResult],
    ['[data-lot-number]', lotNumber],
    ['[data-lot-level]', lotLevel],
    ['[data-lot-title]', lotTitle],
    ['[data-lot-verses]', lotVerses],
    ['[data-interpret-fortune]', interpretFortuneButton],
    ['[data-interpretation-error]', interpretationError],
    ['[data-retry-interpretation]', retryInterpretationButton],
    ['[data-interpretation-result]', interpretationResult],
    ['[data-interpretation-text]', interpretationText],
    ['[data-interpretation-audio]', interpretationAudio],
    ['[data-interpretation-audio-status]', interpretationAudioStatus],
    ['[data-interpretation-audio-control]', interpretationAudioControl],
    ['[data-fortune-return]', fortuneReturnLink],
    ['[data-reset-fortune]', resetFortuneButton],
  ]);
  if (options.paidUi) {
    elements.set('[data-fortune-price]', fortunePrice);
    elements.set('[data-fortune-balance]', fortuneBalance);
    elements.set('[data-fortune-error-title]', fortuneErrorTitle);
    elements.set('[data-fortune-error-message]', fortuneErrorMessage);
    elements.set('[data-fortune-recharge]', fortuneRechargeButton);
    elements.set('[data-fortune-charge-success]', fortuneChargeSuccess);
    elements.set('#fortune-login-overlay', fortuneLoginOverlay);
    elements.set('[data-login-for-fortune]', loginForFortuneButton);
    elements.set('[data-close-fortune-login]', closeFortuneLoginButton);
    elements.set('.time-recharge-entry', rechargeEntry);
  }
  const timers = [];
  const windowListeners = new Map();
  const microphoneRequests = [];
  const defaultStream = createMicrophoneStream();
  const microphoneHandler = options.getUserMedia
    || (() => Promise.resolve(defaultStream));
  let context;
  const asrSessions = [];
  const fetchRequests = [];
  const abortControllers = [];
  const audioElements = [];
  const createdObjectUrls = [];
  const revokedObjectUrls = [];

  class FakeAudio {
    constructor() {
      this.currentTime = 0;
      this.loadCallCount = 0;
      this.listeners = new Map();
      this.pauseCallCount = 0;
      this.paused = true;
      this.playCallCount = 0;
      this.preload = '';
      this.src = '';
      audioElements.push(this);
    }

    addEventListener(eventName, handler) {
      if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, []);
      }
      this.listeners.get(eventName).push(handler);
    }

    trigger(eventName) {
      for (const handler of this.listeners.get(eventName) || []) {
        handler({ target: this });
      }
    }

    play() {
      this.playCallCount += 1;
      this.paused = false;
      if (typeof options.audioPlayImpl === 'function') {
        return options.audioPlayImpl(this, this.playCallCount);
      }
      return Promise.resolve();
    }

    pause() {
      this.pauseCallCount += 1;
      const wasPaused = this.paused;
      this.paused = true;
      if (!wasPaused) {
        this.trigger('pause');
      }
    }

    removeAttribute(name) {
      if (name === 'src') {
        this.src = '';
      }
    }

    load() {
      this.loadCallCount += 1;
    }
  }

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
    Image: class FakeImage {},
    URL,
    URLSearchParams,
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
      innerHeight: 932,
      innerWidth: 430,
      location: {
        href: `http://127.0.0.1/fortune.html${options.locationSearch || ''}`,
        search: options.locationSearch || '',
        assign() {},
      },
      history: {
        replaceState(_state, _title, href) {
          const parsed = new URL(href);
          context.window.location.href = parsed.href;
          context.window.location.search = parsed.search;
        },
      },
      crypto: {
        randomUUID() {
          return options.clientRequestId
            || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        },
      },
      Event: class FakeEvent {
        constructor(type, init = {}) {
          this.type = type;
          this.bubbles = init.bubbles === true;
        }
      },
      CustomEvent: class FakeCustomEvent {
        constructor(type, init = {}) {
          this.type = type;
          this.detail = init.detail;
        }
      },
      addEventListener(eventName, handler) {
        if (!windowListeners.has(eventName)) {
          windowListeners.set(eventName, []);
        }
        windowListeners.get(eventName).push(handler);
      },
      dispatchEvent(event) {
        for (const handler of windowListeners.get(event.type) || []) {
          handler(event);
        }
        return true;
      },
      matchMedia(query) {
        assert.equal(
          query,
          '(prefers-reduced-motion: reduce)'
        );
        return { matches: options.reducedMotion === true };
      },
      setTimeout(callback, delay) {
        timers.push({ active: true, callback, delay });
        return timers.length;
      },
      clearTimeout(timerId) {
        const timer = timers[timerId - 1];
        if (timer) {
          timer.active = false;
        }
      },
      fetch(pathname, requestOptions) {
        fetchRequests.push({ pathname, ...requestOptions });
        if (typeof options.fetchImpl === 'function') {
          return options.fetchImpl(pathname, requestOptions);
        }
        if (pathname.endsWith('/interpretation-audio')) {
          return Promise.resolve(createAudioResponse());
        }
        if (pathname.endsWith('/interpretation')) {
          return Promise.resolve(createInterpretationResponse());
        }
        return Promise.resolve(createFortuneResponse());
      },
      Audio: options.unsupportedAudio === true
        ? undefined
        : FakeAudio,
      URL: {
        createObjectURL(blob) {
          createdObjectUrls.push(blob);
          return `blob:fortune-audio-${createdObjectUrls.length}`;
        },
        revokeObjectURL(objectUrl) {
          revokedObjectUrls.push(objectUrl);
        },
      },
      AbortController: class FakeAbortController {
        constructor() {
          this.signal = { aborted: false };
          this.abortCallCount = 0;
          abortControllers.push(this);
        }

        abort() {
          this.abortCallCount += 1;
          this.signal.aborted = true;
        }
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
    fetchRequests,
    fortuneError,
    fortuneErrorMessage,
    fortuneErrorTitle,
    fortuneDrawAnimation,
    fortuneResult,
    fortuneReturnLink,
    fortunePrice,
    fortuneBalance,
    fortuneRechargeButton,
    fortuneChargeSuccess,
    fortuneLoginOverlay,
    fortuneCharacterImage,
    fortuneCharacterName,
    fortuneCharacterUnavailable,
    flyingWishPaper,
    flyingWishPaperText,
    interpretFortuneButton,
    interpretationAudio,
    interpretationAudioControl,
    interpretationAudioStatus,
    interpretationError,
    interpretationResult,
    interpretationText,
    incenseState,
    microphoneRequests,
    lotLevel,
    lotNumber,
    lotTitle,
    lotVerses,
    offerButton,
    page,
    retryFortuneButton,
    retryInterpretationButton,
    resetFortuneButton,
    rechargeEntry,
    speakControlButton,
    speechDetail,
    speechMessage,
    speechTitle,
    timers,
    transcriptStatus,
    transcriptText,
    asrSessions,
    triggerWindow(eventName, event = {}) {
      for (const handler of windowListeners.get(eventName) || []) {
        handler(event);
      }
    },
    waitingState,
    wishFurnaceMouth,
    wishOfferingComplete,
    wishOfferingStage,
    wishPaper,
    windowListeners,
    windowLocation: context.window.location,
    abortControllers,
    audioElements,
    createdObjectUrls,
    revokedObjectUrls,
  };
}

function createAudioResponse(overrides = {}) {
  const audioBlob = overrides.audioBlob || {
    size: 8,
    type: 'audio/mpeg',
  };
  const contentType = Object.hasOwn(overrides, 'contentType')
    ? overrides.contentType
    : 'audio/mpeg';
  return {
    ok: Object.hasOwn(overrides, 'ok') ? overrides.ok : true,
    status: overrides.status || 200,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type'
          ? contentType
          : null;
      },
    },
    async blob() {
      return audioBlob;
    },
  };
}

function createInterpretationResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        sessionId: 'fortune-ui-test',
        interpretation: {
          text: '这支签提醒您先稳住心绪，再辨明方向。眼下的担忧值得被看见，可先把可控之事理清，今天写下一件最需要核实的小事，慢慢去做。',
          ...overrides,
        },
      };
    },
  };
}

function createFortuneResponse(overrides = {}) {
  const fortuneSession = {
    id: 'fortune-ui-test',
    status: 'drawn',
    deityKey: 'yuhuang',
    catalogVersion: 'prototype-v1',
    lot: {
      id: 'prototype-002',
      number: 2,
      level: '中吉',
      title: '守心待时',
      verseLines: [
        '眼前云淡风初定',
        '守得心安路自明',
      ],
    },
    createdAt: '2026-07-28T06:00:00.000Z',
    drawnAt: '2026-07-28T06:00:00.000Z',
    ...overrides,
  };
  return {
    ok: true,
    status: 201,
    async json() {
      return {
        fortuneSession,
        charge: {
          priceCents: 200,
          currency: 'CNY',
          balanceBeforeCents: 1250,
          balanceAfterCents: 1050,
          alreadyProcessed: false,
        },
      };
    },
  };
}

function verifyStaticSceneAndSafety() {
  const html = fs.readFileSync(FORTUNE_HTML_PATH, 'utf8');
  const css = fs.readFileSync(ENTRY_CSS_PATH, 'utf8');
  const js = fs.readFileSync(FORTUNE_JS_PATH, 'utf8');
  const asrJs = fs.readFileSync(FORTUNE_ASR_JS_PATH, 'utf8');
  const workletJs = fs.readFileSync(WORKLET_PATH, 'utf8');
  const daotongAsset = fs.readFileSync(DAOTONG_ASSET_PATH);

  assert.match(
    html,
    /class="shrine-scene-background"[\s\S]*?data-fortune-character-image/
  );
  assert.match(
    html,
    /class="temple-scene shrine-character-layer"[\s\S]*?class="acolyte-character"[\s\S]*?src="\.\/assets\/fortune\/daotong-guide-v1\.png"/
  );
  assert.match(
    html,
    /class="shrine-foreground"[\s\S]*?<section class="offering-stage"[\s\S]*?<section class="waiting-to-speak"/
  );
  assert.match(
    html,
    /class="fortune-result-layer"[\s\S]*?data-fortune-result/
  );
  assert.match(
    html,
    /class="page-footnotes"[\s\S]*?当前为项目原型签文，正式签谱后续校订。[\s\S]*?签文与解读仅作传统文化体验及情绪陪伴参考。/
  );
  assert.match(
    html,
    /<section class="offering-stage"[\s\S]*?香炉与一炷未点燃的香/
  );
  assert.match(
    html,
    /<section class="acolyte-guide"[\s\S]*?<h2 id="acolyte-guide-title">道童引导<\/h2>/
  );
  assert.doesNotMatch(
    html,
    /acolyte-silhouette|acolyte-head|acolyte-body/
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
    /<button class="speak-control-button" type="button" data-speak-control[^>]*>开始说话<\/button>/
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
    /<section class="wish-paper" data-wish-paper[\s\S]*?道童代您写下/
  );
  assert.match(
    html,
    /data-wish-paper[^>]*aria-busy="false"/
  );
  assert.match(
    html,
    /data-transcript-text>您的话会写在这里。<\/p>/
  );
  assert.match(
    html,
    /class="wish-offering-stage" data-wish-offering-stage aria-hidden="true" hidden/
  );
  assert.match(
    html,
    /class="wish-furnace" data-wish-furnace[\s\S]*?class="wish-furnace-mouth" data-wish-furnace-mouth[\s\S]*?class="wish-furnace-body"/
  );
  assert.match(
    html,
    /wish-furnace-handle-left[\s\S]*?wish-furnace-handle-right[\s\S]*?wish-furnace-leg-left[\s\S]*?wish-furnace-leg-center[\s\S]*?wish-furnace-leg-right/
  );
  assert.match(
    html,
    /class="wish-furnace-smoke"[\s\S]*?class="wish-furnace-fire"[\s\S]*?焚愿炉/
  );
  assert.match(
    html,
    /class="flying-wish-paper" data-flying-wish-paper[\s\S]*?data-flying-wish-paper-text/
  );
  assert.doesNotMatch(
    html,
    /data-(?:transcript-actions|confirm-transcript|retry-transcript|wish-next-step|offer-wish)|就是这个意思|重新说一遍|奉入香炉/
  );
  assert.match(
    html,
    /data-wish-offering-complete[^>]*aria-live="polite"[^>]*hidden/
  );
  assert.doesNotMatch(
    html,
    /data-draw-fortune|开始抽签|诚心求一签/
  );
  assert.match(
    html,
    /data-fortune-error[\s\S]*?暂时未能求得签文，请稍后再试。[\s\S]*?data-retry-fortune>重新求签<\/button>/
  );
  assert.match(
    html,
    /data-fortune-result[\s\S]*?data-lot-number[\s\S]*?data-lot-level[\s\S]*?data-lot-title[\s\S]*?data-lot-verses/
  );
  assert.match(
    html,
    /当前为项目原型签文，正式签谱后续校订。/
  );
  assert.match(
    html,
    /data-interpret-fortune>请道童解签<\/button>/
  );
  assert.match(
    html,
    /data-interpretation-result[\s\S]*?<h4>道童解签<\/h4>[\s\S]*?data-interpretation-text[\s\S]*?data-interpretation-audio/
  );
  assert.match(
    html,
    /data-interpretation-audio[\s\S]*?data-interpretation-audio-control[\s\S]*?>\s*听道童解签\s*<\/button>/
  );
  assert.equal(
    (
      html.match(
        /签文与解读仅作传统文化体验及情绪陪伴参考。/g
      ) || []
    ).length,
    1
  );
  assert.doesNotMatch(
    html,
    /签意概括|道童解读|眼下可做的小事|温馨提示|data-interpretation-(?:summary|reflection|action|safety)/
  );
  assert.match(css, /\.page-footnotes\s*\{/);
  assert.match(
    css,
    /\.shrine-deity-visual\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*50% 42%;[\s\S]*?scale\(1\.035\)/
  );
  assert.match(
    css,
    /\.acolyte-character\s*\{[\s\S]*?object-fit:\s*contain;/
  );
  assert.doesNotMatch(css, /\.acolyte-silhouette\s*\{/);
  assert.equal(
    daotongAsset.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a'
  );
  assert.equal(daotongAsset.readUInt32BE(16), 1024);
  assert.equal(daotongAsset.readUInt32BE(20), 1536);
  assert.equal((js.match(/assets\/characters/g) || []).length, 1);
  assert.doesNotMatch(js, /https?:\/\/[^'"]+\.(?:png|webp|jpe?g)/i);
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
    /\.wish-paper \.wish-paper-text\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/
  );
  assert.match(
    css,
    /\.draw-fortune-preview-button,[\s\S]*?min-height:\s*54px;/
  );
  assert.match(
    css,
    /\.fortune-interpretation-audio-button\s*\{[\s\S]*?min-height:\s*54px;/
  );
  assert.match(
    css,
    /\.wish-offering-stage\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?overflow:\s*hidden;[\s\S]*?pointer-events:\s*none;/
  );
  assert.match(
    css,
    /\.wish-furnace\s*\{[\s\S]*?bottom:\s*clamp\([\s\S]*?width:\s*clamp\([\s\S]*?height:\s*clamp\(/
  );
  assert.match(css, /@keyframes wish-offering-stage-sequence\s*\{/);
  assert.match(css, /@keyframes wish-paper-flight\s*\{/);
  assert.match(css, /@keyframes wish-furnace-fire-flare\s*\{/);
  assert.match(css, /@keyframes wish-furnace-smoke-rise-left\s*\{/);
  assert.match(css, /@keyframes wish-offering-stage-sequence-reduced\s*\{/);
  assert.match(
    js,
    /wishPaper\.getBoundingClientRect\(\)[\s\S]*?wishFurnaceMouth\.getBoundingClientRect\(\)/
  );
  assert.match(
    js,
    /flyingWishPaperText\.textContent = currentTranscript;/
  );
  assert.match(
    js,
    /flyingWishPaper\.style\.setProperty\([\s\S]*?formatPixelValue\(value\)/
  );

  assert.doesNotMatch(
    html,
    /<(?:input|textarea)\b|contenteditable=|签筒|录音波形/
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
    /localStorage|sessionStorage|document\.cookie|MediaRecorder|SpeechRecognition|enumerateDevices|innerHTML/
  );
  assert.match(
    js,
    /const FORTUNE_SESSION_API_URL = '\/api\/fortune-sessions';/
  );
  assert.match(
    js,
    /`\$\{FORTUNE_SESSION_API_URL\}\/\$\{encodeURIComponent\(sessionId\)\}`[\s\S]*?\+ '\/interpretation'/
  );
  assert.match(
    js,
    /`\$\{FORTUNE_SESSION_API_URL\}\/\$\{encodeURIComponent\(sessionId\)\}`[\s\S]*?\+ '\/interpretation-audio'/
  );
  assert.match(js, /window\.URL\.createObjectURL\(audioBlob\)/);
  assert.match(js, /window\.URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(
    js,
    /body:\s*JSON\.stringify\(\{\s*clientRequestId:\s*activeFortuneClientRequestId,\s*characterKey:\s*currentFortuneCharacterKey,\s*situationText:\s*currentTranscript\.trim\(\),\s*\}\)/
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
    /<(?:input|textarea)\b|contenteditable=|语音识别预览|partial|final|ASR|转写结果|调试预览/
  );
  assert.doesNotMatch(
    `${html}\n${js}`,
    /神仙为您解签|神仙正在听您说话|已经保存您的心愿|神明已经收到|心愿已经永久保存|签文正在降下|解签结果|心愿已确认|确认后呈愿|重新确认/
  );
  assert.doesNotMatch(js, /\.click\(\)/);
  assert.doesNotMatch(
    js,
    /localStorage|sessionStorage|document\.cookie|indexedDB|innerHTML/
  );
}

function verifyCharacterVisualSelection() {
  const defaultRuntime = loadFortuneRuntime();
  assert.equal(
    defaultRuntime.fortuneCharacterImage.getAttribute('src'),
    './assets/fortune/scenes/fortune-scene-guanyin-v1.png'
  );
  assert.equal(defaultRuntime.page.dataset.fortuneCharacterKey, 'guanyin');
  assert.equal(defaultRuntime.fortuneCharacterName.textContent, '观音菩萨');
  assert.equal(defaultRuntime.fortuneCharacterImage.hidden, false);

  const sunwukongRuntime = loadFortuneRuntime({
    locationSearch: '?characterKey=sunwukong',
  });
  assert.equal(
    sunwukongRuntime.fortuneCharacterImage.getAttribute('src'),
    './assets/characters/sunwukong/sunwukong-home-hero-v2.png'
  );
  assert.equal(
    sunwukongRuntime.page.dataset.fortuneCharacterKey,
    'sunwukong'
  );

  const invalidRuntime = loadFortuneRuntime({
    locationSearch: '?characterKey=../../yuhuang',
  });
  assert.equal(invalidRuntime.fortuneCharacterImage.hidden, true);
  assert.equal(
    invalidRuntime.fortuneCharacterImage.getAttribute('src'),
    null
  );
  assert.equal(
    invalidRuntime.page.dataset.fortuneCharacterKey,
    'unavailable'
  );

  sunwukongRuntime.fortuneCharacterImage.trigger('error');
  assert.equal(sunwukongRuntime.fortuneCharacterImage.hidden, true);
  assert.equal(
    sunwukongRuntime.page.dataset.fortuneCharacterKey,
    'sunwukong'
  );
}

async function verifyFortuneCharacterSwipeConsistency() {
  const runtime = loadFortuneRuntime();
  swipeFortuneScene(runtime, 11, 340, 190);
  assert.equal(runtime.page.dataset.fortuneCharacterKey, 'caishen');
  assert.equal(runtime.fortuneCharacterName.textContent, '财神爷');
  assert.match(runtime.windowLocation.search, /characterKey=caishen/);
  assert.equal(
    runtime.fortuneCharacterImage.getAttribute('src'),
    './assets/fortune/scenes/fortune-scene-caishen-v1.png'
  );

  swipeFortuneScene(runtime, 12, 340, 190);
  assert.equal(runtime.page.dataset.fortuneCharacterKey, 'rulai');
  assert.equal(runtime.fortuneCharacterName.textContent, '如来佛祖');
  swipeFortuneScene(runtime, 13, 340, 190);
  assert.equal(runtime.page.dataset.fortuneCharacterKey, 'guanyin');
  swipeFortuneScene(runtime, 14, 140, 310);
  assert.equal(runtime.page.dataset.fortuneCharacterKey, 'rulai');

  const businessRuntime = loadFortuneRuntime();
  swipeFortuneScene(businessRuntime, 15, 340, 190);
  clickSpeakControl(businessRuntime);
  await flushPromises();
  clickSpeakControl(businessRuntime);
  businessRuntime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: businessRuntime.wishOfferingStage,
  });
  await flushPromises();
  const sessionRequest = businessRuntime.fetchRequests.find(
    (request) => request.pathname === '/api/fortune-sessions'
  );
  assert.equal(JSON.parse(sessionRequest.body).characterKey, 'caishen');
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
  assert.equal(runtime.speakControlButton.textContent, '开始说话');
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
  assert.equal(runtime.speakControlButton.textContent, '结束说话');
  assert.equal(runtime.page.classList.contains('is-listening'), true);

  runtime.speakControlButton.trigger('click');
  assert.deepEqual(
    microphoneStream.tracks.map((track) => track.stopCallCount),
    [1, 1, 1]
  );
  assert.equal(runtime.speechTitle.textContent, '心愿已记下');
  assert.equal(
    runtime.speechMessage.textContent,
    '心愿已记下，正在投入焚愿炉……'
  );
  assert.equal(
    runtime.speechDetail.textContent,
    '心愿纸进入炉口后，将焚化为轻烟敬呈。'
  );
  assert.equal(runtime.speakControlButton.hidden, true);
  assert.equal(runtime.transcriptStatus.textContent, '正在呈愿');
  assert.equal(runtime.transcriptText.textContent, '测试识别结果');
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );

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
  assert.equal(runtime.speakControlButton.textContent, '开始说话');
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(
    runtime.page.classList.contains('is-listening'),
    false
  );

  runtime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(runtime.microphoneRequests.length, 2);
  assert.equal(runtime.speakControlButton.textContent, '结束说话');

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
    '开始说话'
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
  assert.equal(activeRuntime.speakControlButton.textContent, '开始说话');

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
      host: options.host || options.hostname || '192.168.10.24',
      hostname: options.hostname || '192.168.10.24',
      protocol: options.protocol || 'http:',
    },
    RealtimeWebSocketUrl: realtimeWebSocketUrl,
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
    'ws://192.168.10.24/fortune-asr'
  );

  const secureRuntime = loadFortuneAsrRuntime({
    hostname: 'temple.example.test',
    protocol: 'https:',
  });
  assert.equal(
    secureRuntime.api.buildFortuneAsrWebSocketUrl(),
    'wss://temple.example.test/fortune-asr'
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
  assert.equal(
    runtime.transcriptStatus.textContent,
    '心愿已记下'
  );

  runtime.speakControlButton.trigger('click');
  assert.equal(createdSessions[0].finishCallCount, 1);
  assert.equal(runtime.speechMessage.textContent, '正在整理您的话……');
  createdSessions[0].callbacks.onTranscriptReady();
  createdSessions[0].callbacks.onTranscriptReady();
  assert.equal(
    runtime.speechMessage.textContent,
    '心愿已记下，正在投入焚愿炉……'
  );

  createdSessions[0].callbacks.onError({
    kind: 'asr',
    message: '语音识别暂时不可用，请重新诉说。',
  });
  assert.equal(
    runtime.speechMessage.textContent,
    '心愿已记下，正在投入焚愿炉……'
  );

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
  assert.equal(retryRuntime.speakControlButton.textContent, '开始说话');
  retryRuntime.speakControlButton.trigger('click');
  await flushPromises();
  assert.notEqual(createdSessions.at(-1), failedSession);
  failedSession.callbacks.onPartial('迟到的旧识别');
  assert.notEqual(retryRuntime.transcriptText.textContent, '迟到的旧识别');
}

async function verifyWishPaperAutomaticAdoptionAndErrors() {
  const sessions = [];
  const runtime = loadFortuneRuntime({
    createSession(callbacks) {
      const session = {
        callbacks,
        closeCallCount: 0,
        finishCallCount: 0,
        close() {
          this.closeCallCount += 1;
          callbacks.onClosed();
          return this.closeCallCount === 1;
        },
        finish() {
          this.finishCallCount += 1;
          callbacks.onFinishing();
          return this.finishCallCount === 1;
        },
        start() {
          callbacks.onConnecting();
          return Promise.resolve(true);
        },
      };
      sessions.push(session);
      return session;
    },
  });

  assert.equal(runtime.transcriptText.textContent, '您的话会写在这里。');
  assert.equal(runtime.wishOfferingComplete.hidden, true);
  assert.equal(runtime.wishPaper.getAttribute('aria-busy'), 'false');

  completeIncenseOffering(runtime);
  runtime.speakControlButton.trigger('click');
  await flushPromises();
  sessions[0].callbacks.onStarted({ inputSampleRate: 48000 });
  assert.equal(runtime.wishPaper.getAttribute('aria-busy'), 'true');

  sessions[0].callbacks.onPartial('我最近');
  sessions[0].callbacks.onPartial('我最近总担心');
  sessions[0].callbacks.onPartial('我最近总担心');
  sessions[0].callbacks.onPartial('');
  assert.equal(runtime.transcriptText.textContent, '我最近总担心');
  assert.equal(
    runtime.transcriptStatus.textContent,
    '道童正在代您记下……'
  );
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    false
  );
  assert.equal(runtime.fetchRequests.length, 0);

  runtime.speakControlButton.trigger('click');
  runtime.speakControlButton.trigger('click');
  assert.equal(sessions[0].finishCallCount, 1);
  sessions[0].callbacks.onFinal('', true);
  assert.equal(runtime.speechMessage.textContent, '正在整理您的话……');
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    false
  );
  sessions[0].callbacks.onFinal('   ', true);
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    false
  );

  sessions[0].callbacks.onFinal(
    '  希望家人平安，自己也能安心一些。  ',
    true
  );
  assert.equal(
    runtime.transcriptText.textContent,
    '希望家人平安，自己也能安心一些。'
  );
  assert.equal(runtime.transcriptStatus.textContent, '正在呈愿');
  assert.equal(runtime.speechTitle.textContent, '心愿已记下');
  assert.equal(
    runtime.speechMessage.textContent,
    '心愿已记下，正在投入焚愿炉……'
  );
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );
  assert.equal(runtime.wishPaper.getAttribute('aria-busy'), 'true');
  assert.equal(runtime.fetchRequests.length, 0);
  assert.equal(
    runtime.timers.filter((timer) => timer.delay === 3400).length,
    1
  );
  assert.equal(
    runtime.wishOfferingStage.listeners.get('animationend').length,
    1
  );
  assert.equal(runtime.wishOfferingStage.hidden, false);
  assert.equal(
    runtime.wishOfferingStage.classList.contains('is-active'),
    true
  );
  assert.equal(
    runtime.flyingWishPaperText.textContent,
    '希望家人平安，自己也能安心一些。'
  );
  assert.equal(runtime.wishPaper.getBoundingClientRectCallCount, 1);
  assert.equal(runtime.wishFurnaceMouth.getBoundingClientRectCallCount, 1);
  assert.notEqual(
    runtime.flyingWishPaper.style.getPropertyValue('--wish-flight-y'),
    ''
  );

  sessions[0].callbacks.onFinal('重复 final', true);
  assert.equal(
    runtime.timers.filter((timer) => timer.delay === 3400).length,
    1
  );
  assert.equal(
    runtime.wishOfferingStage.listeners.get('animationend').length,
    1
  );
  assert.equal(runtime.wishPaper.getBoundingClientRectCallCount, 1);
  assert.equal(runtime.wishFurnaceMouth.getBoundingClientRectCallCount, 1);
  assert.equal(
    runtime.transcriptText.textContent,
    '希望家人平安，自己也能安心一些。'
  );
  await flushPromises();
  assert.equal(sessions[0].closeCallCount, 1);
  sessions[0].callbacks.onPartial('迟到的旧 partial');
  sessions[0].callbacks.onFinal('迟到的旧 final', true);
  assert.equal(
    runtime.transcriptText.textContent,
    '希望家人平安，自己也能安心一些。'
  );

  const errorSessions = [];
  const errorRuntime = loadFortuneRuntime({
    createSession(callbacks) {
      const session = {
        callbacks,
        closeCallCount: 0,
        close() {
          this.closeCallCount += 1;
          callbacks.onClosed();
          return this.closeCallCount === 1;
        },
        finish() {
          callbacks.onFinishing();
          return true;
        },
        start() {
          callbacks.onConnecting();
          return Promise.resolve(true);
        },
      };
      errorSessions.push(session);
      return session;
    },
  });
  completeIncenseOffering(errorRuntime);
  errorRuntime.speakControlButton.trigger('click');
  await flushPromises();
  errorSessions[0].callbacks.onStarted({ inputSampleRate: 48000 });
  errorSessions[0].callbacks.onPartial('旧心愿');
  errorRuntime.speakControlButton.trigger('click');
  errorSessions[0].callbacks.onError({
    kind: 'asr',
    message: '语音识别暂时不可用，请重新诉说。',
  });
  assert.equal(
    errorRuntime.page.classList.contains('is-wish-offering'),
    false
  );
  assert.equal(errorRuntime.fetchRequests.length, 0);
  assert.equal(errorRuntime.speakControlButton.textContent, '开始说话');
  errorRuntime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(errorSessions.length, 2);
  errorSessions[0].callbacks.onFinal('旧会话迟到 final', true);
  assert.equal(errorRuntime.transcriptText.textContent, '您的话会写在这里。');
  errorSessions[1].callbacks.onStarted({ inputSampleRate: 44100 });
  errorSessions[1].callbacks.onPartial('新的心愿');
  assert.equal(errorRuntime.transcriptText.textContent, '新的心愿');
}

async function reachAutomaticWishOffering(runtime) {
  completeIncenseOffering(runtime);
  runtime.speakControlButton.trigger('click');
  await flushPromises();
  runtime.speakControlButton.trigger('click');
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );
  assert.equal(runtime.fetchRequests.length, 0);
}

async function verifyWishOfferingAnimationAndCleanup() {
  const runtime = loadFortuneRuntime();
  await reachAutomaticWishOffering(runtime);
  const lockedText = runtime.transcriptText.textContent;
  const microphoneRequestCount = runtime.microphoneRequests.length;
  const asrSessionCount = runtime.asrSessions.length;

  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );
  assert.equal(runtime.wishPaper.getAttribute('aria-busy'), 'true');
  assert.equal(runtime.wishPaper.getAttribute('aria-hidden'), 'true');
  assert.equal(runtime.wishOfferingComplete.hidden, true);
  assert.equal(runtime.wishOfferingStage.hidden, false);
  assert.equal(
    runtime.wishOfferingStage.classList.contains('is-active'),
    true
  );
  assert.equal(runtime.flyingWishPaperText.textContent, lockedText);
  assert.equal(
    runtime.flyingWishPaper.style.getPropertyValue(
      '--wish-paper-start-x'
    ),
    '35px'
  );
  assert.notEqual(
    runtime.flyingWishPaper.style.getPropertyValue('--wish-flight-y'),
    ''
  );
  assert.equal(runtime.microphoneRequests.length, microphoneRequestCount);
  assert.equal(runtime.asrSessions.length, asrSessionCount);
  const animationTimer = runtime.timers.find(
    (timer) => timer.delay === 3400
  );
  assert.ok(animationTimer);
  assert.equal(
    runtime.wishOfferingStage.listeners.get('animationend').length,
    1
  );

  runtime.asrSessions[0].callbacks.onPartial('迟到 partial');
  runtime.asrSessions[0].callbacks.onFinal('迟到 final', true);
  assert.equal(runtime.transcriptText.textContent, lockedText);

  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-furnace-smoke-show',
    target: runtime.wishFurnaceMouth,
  });
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );

  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-paper-flight',
    target: runtime.flyingWishPaper,
  });
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );

  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-furnace-fire-flare',
    target: runtime.wishOfferingStage,
  });
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    true
  );

  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  assert.equal(
    runtime.page.classList.contains('is-wish-offering'),
    false
  );
  assert.equal(
    runtime.page.classList.contains('has-offered-wish'),
    true
  );
  assert.equal(animationTimer.active, false);
  assert.equal(runtime.wishPaper.hidden, true);
  assert.equal(runtime.wishOfferingComplete.hidden, false);
  assert.equal(runtime.wishOfferingStage.hidden, true);
  assert.equal(
    runtime.wishOfferingStage.classList.contains('is-active'),
    false
  );
  assert.equal(runtime.flyingWishPaperText.textContent, '');
  assert.equal(
    runtime.flyingWishPaper.style.getPropertyValue('--wish-flight-y'),
    ''
  );
  assert.equal(runtime.wishOfferingComplete.focusCallCount, 1);
  assert.equal(runtime.page.dataset.fortuneState, 'draw-ready');
  assert.equal(runtime.fetchRequests.length, 0);
  animationTimer.callback();
  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  assert.equal(runtime.wishOfferingComplete.focusCallCount, 1);
  assert.equal(runtime.wishPaper.hidden, true);
  assert.equal(runtime.fetchRequests.length, 0);
  await flushPromises();
  assert.equal(runtime.fetchRequests.length, 1);
  assert.equal(runtime.page.dataset.fortuneState, 'drawing-lot');

  const fallbackRuntime = loadFortuneRuntime();
  await reachAutomaticWishOffering(fallbackRuntime);
  const fallbackTimer = fallbackRuntime.timers.find(
    (timer) => timer.delay === 3400
  );
  assert.ok(fallbackTimer);
  fallbackTimer.callback();
  assert.equal(fallbackRuntime.wishPaper.hidden, true);
  assert.equal(fallbackRuntime.wishOfferingComplete.hidden, false);
  assert.equal(fallbackRuntime.wishOfferingStage.hidden, true);
  assert.equal(fallbackRuntime.wishOfferingComplete.focusCallCount, 1);
  assert.equal(fallbackRuntime.fetchRequests.length, 0);
  fallbackRuntime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: fallbackRuntime.wishOfferingStage,
  });
  await flushPromises();
  assert.equal(fallbackRuntime.wishOfferingComplete.focusCallCount, 1);
  assert.equal(fallbackRuntime.fetchRequests.length, 1);

  const reducedRuntime = loadFortuneRuntime({
    reducedMotion: true,
  });
  await reachAutomaticWishOffering(reducedRuntime);
  const reducedTimer = reducedRuntime.timers.find(
    (timer) => timer.delay === 180
  );
  assert.ok(reducedTimer);
  reducedRuntime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence-reduced',
    target: reducedRuntime.wishOfferingStage,
  });
  assert.equal(reducedTimer.active, false);
  assert.equal(reducedRuntime.wishPaper.hidden, true);
  assert.equal(reducedRuntime.wishOfferingComplete.hidden, false);
  assert.equal(reducedRuntime.fetchRequests.length, 0);
  await flushPromises();
  assert.equal(reducedRuntime.fetchRequests.length, 1);

  for (const exitEvent of ['pagehide', 'beforeunload']) {
    const exitRuntime = loadFortuneRuntime();
    await reachAutomaticWishOffering(exitRuntime);
    const exitTimer = exitRuntime.timers.find(
      (timer) => timer.delay === 3400
    );
    assert.ok(exitTimer);
    exitRuntime.triggerWindow(exitEvent);
    assert.equal(exitTimer.active, false);
    assert.equal(
      exitRuntime.page.classList.contains('is-wish-offering'),
      false
    );
    assert.equal(
      exitRuntime.wishOfferingStage.listeners.get('animationend').length,
      0
    );
    assert.equal(exitRuntime.wishOfferingStage.hidden, true);
    assert.equal(exitRuntime.flyingWishPaperText.textContent, '');
    exitTimer.callback();
    assert.equal(exitRuntime.wishOfferingComplete.hidden, true);
    exitRuntime.triggerWindow('pageshow');
    assert.equal(exitRuntime.wishPaper.hidden, false);
    assert.equal(
      exitRuntime.transcriptText.textContent,
      '您的话会写在这里。'
    );
  }

  const staleAnimationRuntime = loadFortuneRuntime();
  await reachAutomaticWishOffering(staleAnimationRuntime);
  const staleHandler = staleAnimationRuntime.wishOfferingStage.listeners
    .get('animationend')[0];
  staleAnimationRuntime.triggerWindow('pagehide');
  staleAnimationRuntime.triggerWindow('pageshow');
  await reachAutomaticWishOffering(staleAnimationRuntime);
  staleHandler({
    animationName: 'wish-offering-stage-sequence',
    target: staleAnimationRuntime.wishOfferingStage,
  });
  assert.equal(
    staleAnimationRuntime.page.classList.contains('is-wish-offering'),
    true
  );
  staleAnimationRuntime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: staleAnimationRuntime.wishOfferingStage,
  });
  assert.equal(staleAnimationRuntime.wishOfferingComplete.hidden, false);
  assert.equal(staleAnimationRuntime.fetchRequests.length, 0);
  await flushPromises();
  assert.equal(staleAnimationRuntime.fetchRequests.length, 1);
}

async function reachOfferedWish(runtime) {
  await reachAutomaticWishOffering(runtime);
  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  assert.equal(runtime.wishOfferingComplete.hidden, false);
  assert.equal(runtime.page.dataset.fortuneState, 'draw-ready');
  assert.equal(runtime.fetchRequests.length, 0);
  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  await flushPromises();
  assert.equal(runtime.fetchRequests.length, 1);
}

async function verifyFortuneDrawFlowAndRetry() {
  const pendingResponse = createDeferred();
  const runtime = loadFortuneRuntime({
    fetchImpl: () => pendingResponse.promise,
  });

  assert.equal(runtime.fetchRequests.length, 0);
  await reachOfferedWish(runtime);
  const confirmedText = runtime.transcriptText.textContent;
  assert.equal(runtime.fetchRequests.length, 1);
  assert.equal(runtime.fetchRequests[0].pathname, '/api/fortune-sessions');
  assert.equal(runtime.fetchRequests[0].method, 'POST');
  assert.equal(runtime.page.dataset.fortuneState, 'drawing-lot');
  const requestBody = JSON.parse(runtime.fetchRequests[0].body);
  assert.deepEqual(
    JSON.parse(JSON.stringify(requestBody)),
    {
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      characterKey: 'guanyin',
      situationText: confirmedText.trim(),
    }
  );
  assert.equal('lotId' in requestBody, false);
  assert.equal('catalogVersion' in requestBody, false);
  assert.equal('asr' in requestBody, false);

  pendingResponse.resolve(createFortuneResponse({
    situationText: '不应显示的处境',
    ownerId: 'private-owner',
  }));
  await flushPromises();
  runtime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-cylinder-shake',
    target: runtime.fortuneDrawAnimation,
  });
  runtime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-slip-reveal',
    target: runtime.fortuneDrawAnimation,
  });
  assert.equal(runtime.fetchRequests.length, 1);
  assert.equal(runtime.wishOfferingComplete.hidden, true);
  assert.equal(runtime.fortuneError.hidden, true);
  assert.equal(runtime.fortuneResult.hidden, false);
  assert.equal(runtime.fortuneResult.focusCallCount, 1);
  assert.equal(runtime.lotNumber.textContent, '2');
  assert.equal(runtime.lotLevel.textContent, '中吉');
  assert.equal(runtime.lotTitle.textContent, '守心待时');
  assert.equal(
    runtime.lotVerses.textContent,
    '眼前云淡风初定\n守得心安路自明'
  );
  assert.equal(
    [
      runtime.lotNumber.textContent,
      runtime.lotLevel.textContent,
      runtime.lotTitle.textContent,
      runtime.lotVerses.textContent,
    ].join(' ').includes('不应显示的处境'),
    false
  );
  runtime.retryFortuneButton.trigger('click');
  assert.equal(runtime.fetchRequests.length, 1);
  runtime.asrSessions[0].callbacks.onPartial('迟到 partial');
  runtime.asrSessions[0].callbacks.onFinal('迟到 final', true);
  assert.equal(runtime.fortuneResult.hidden, false);
  assert.equal(runtime.lotTitle.textContent, '守心待时');

  let retryRequestCount = 0;
  const retryRuntime = loadFortuneRuntime({
    fetchImpl() {
      retryRequestCount += 1;
      if (retryRequestCount === 1) {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve(createFortuneResponse());
    },
  });
  await reachOfferedWish(retryRuntime);
  await flushPromises();
  assert.equal(retryRuntime.fortuneResult.hidden, true);
  assert.equal(retryRuntime.fortuneError.hidden, false);
  assert.equal(retryRuntime.fortuneError.focusCallCount, 1);
  assert.equal(retryRuntime.retryFortuneButton.disabled, false);
  retryRuntime.retryFortuneButton.trigger('click');
  retryRuntime.retryFortuneButton.trigger('click');
  assert.equal(retryRequestCount, 2);
  assert.equal(retryRuntime.retryFortuneButton.disabled, true);
  await flushPromises();
  await flushPromises();
  assert.equal(retryRuntime.fortuneResult.hidden, false);
  assert.equal(retryRuntime.fortuneError.hidden, true);

  const invalidRuntime = loadFortuneRuntime({
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      async json() {
        return {
          fortuneSession: {
            status: 'drawn',
            situationText: 'fake result',
          },
        };
      },
    }),
  });
  await reachOfferedWish(invalidRuntime);
  await flushPromises();
  assert.equal(invalidRuntime.fortuneResult.hidden, true);
  assert.equal(invalidRuntime.fortuneError.hidden, false);

  const exitResponse = createDeferred();
  const exitRuntime = loadFortuneRuntime({
    fetchImpl: () => exitResponse.promise,
  });
  await reachOfferedWish(exitRuntime);
  assert.equal(exitRuntime.abortControllers.length, 1);
  exitRuntime.triggerWindow('pagehide');
  assert.equal(exitRuntime.abortControllers[0].abortCallCount, 1);
  exitResponse.resolve(createFortuneResponse());
  await flushPromises();
  await flushPromises();
  assert.equal(exitRuntime.fortuneResult.hidden, true);
  exitRuntime.triggerWindow('pageshow');
  assert.equal(exitRuntime.wishPaper.hidden, false);
  assert.equal(exitRuntime.fetchRequests.length, 1);
}

async function reachDrawnLot(runtime) {
  await reachOfferedWish(runtime);
  await flushPromises();
  runtime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-cylinder-shake',
    target: runtime.fortuneDrawAnimation,
  });
  runtime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-slip-reveal',
    target: runtime.fortuneDrawAnimation,
  });
  assert.equal(runtime.fortuneResult.hidden, false);
  assert.equal(runtime.interpretFortuneButton.hidden, false);
  assert.equal(runtime.interpretFortuneButton.disabled, false);
}

async function verifyFortuneInterpretationFlowAndSafety() {
  const pendingInterpretation = createDeferred();
  const runtime = loadFortuneRuntime({
    fetchImpl(pathname) {
      if (pathname.endsWith('/interpretation')) {
        return pendingInterpretation.promise;
      }
      return Promise.resolve(createFortuneResponse());
    },
  });
  runtime.interpretFortuneButton.trigger('click');
  assert.equal(runtime.fetchRequests.length, 0);
  await reachDrawnLot(runtime);
  assert.equal(
    runtime.interpretFortuneButton.textContent,
    '请道童解签'
  );

  runtime.interpretFortuneButton.trigger('click');
  runtime.interpretFortuneButton.trigger('click');
  assert.equal(runtime.fetchRequests.length, 2);
  const interpretationRequest = runtime.fetchRequests[1];
  assert.equal(
    interpretationRequest.pathname,
    '/api/fortune-sessions/fortune-ui-test/interpretation'
  );
  assert.equal(interpretationRequest.method, 'POST');
  assert.equal('body' in interpretationRequest, false);
  assert.equal(
    JSON.stringify(interpretationRequest).includes(
      runtime.transcriptText.textContent
    ),
    false
  );
  assert.equal(
    runtime.interpretFortuneButton.textContent,
    '道童正在解签……'
  );
  assert.equal(runtime.interpretFortuneButton.disabled, true);

  const htmlText = '<img src=x onerror=alert(1)>';
  pendingInterpretation.resolve(createInterpretationResponse({
    text: htmlText,
  }));
  await flushPromises();
  await flushPromises();
  assert.equal(runtime.interpretationResult.hidden, false);
  assert.equal(runtime.interpretationResult.focusCallCount, 1);
  assert.equal(runtime.interpretationText.textContent, htmlText);
  assert.equal(runtime.interpretFortuneButton.hidden, true);
  assert.equal(runtime.retryInterpretationButton.disabled, true);
  runtime.interpretFortuneButton.trigger('click');
  runtime.retryInterpretationButton.trigger('click');
  assert.equal(runtime.fetchRequests.length, 2);

  let interpretationCallCount = 0;
  const retryRuntime = loadFortuneRuntime({
    fetchImpl(pathname) {
      if (!pathname.endsWith('/interpretation')) {
        return Promise.resolve(createFortuneResponse());
      }
      interpretationCallCount += 1;
      if (interpretationCallCount === 1) {
        return Promise.reject(new Error('model unavailable'));
      }
      return Promise.resolve(createInterpretationResponse());
    },
  });
  await reachDrawnLot(retryRuntime);
  retryRuntime.interpretFortuneButton.trigger('click');
  await flushPromises();
  assert.equal(retryRuntime.interpretationResult.hidden, true);
  assert.equal(retryRuntime.interpretationError.hidden, false);
  assert.equal(retryRuntime.interpretationError.focusCallCount, 1);
  assert.equal(
    retryRuntime.retryInterpretationButton.disabled,
    false
  );
  retryRuntime.retryInterpretationButton.trigger('click');
  retryRuntime.retryInterpretationButton.trigger('click');
  assert.equal(interpretationCallCount, 2);
  const retryRequest = retryRuntime.fetchRequests.at(-1);
  assert.equal(
    retryRequest.pathname,
    '/api/fortune-sessions/fortune-ui-test/interpretation'
  );
  assert.equal('body' in retryRequest, false);
  await flushPromises();
  await flushPromises();
  assert.equal(retryRuntime.interpretationResult.hidden, false);
  assert.equal(retryRuntime.interpretationError.hidden, true);

  const exitDeferred = createDeferred();
  const exitRuntime = loadFortuneRuntime({
    fetchImpl(pathname) {
      if (pathname.endsWith('/interpretation')) {
        return exitDeferred.promise;
      }
      return Promise.resolve(createFortuneResponse());
    },
  });
  await reachDrawnLot(exitRuntime);
  exitRuntime.interpretFortuneButton.trigger('click');
  const interpretationController =
    exitRuntime.abortControllers.at(-1);
  exitRuntime.triggerWindow('beforeunload');
  assert.equal(interpretationController.abortCallCount, 1);
  exitDeferred.resolve(createInterpretationResponse());
  await flushPromises();
  await flushPromises();
  assert.equal(exitRuntime.interpretationResult.hidden, true);
}

async function reachInterpretedLot(runtime) {
  await reachDrawnLot(runtime);
  runtime.interpretFortuneButton.trigger('click');
  await flushPromises();
  await flushPromises();
  assert.equal(runtime.interpretationResult.hidden, false);
  assert.equal(runtime.interpretationAudio.hidden, false);
}

async function verifyInterpretationAudioLifecycle() {
  const runtime = loadFortuneRuntime();
  runtime.interpretationAudioControl.trigger('click');
  assert.equal(runtime.fetchRequests.length, 0);
  await reachInterpretedLot(runtime);
  assert.equal(
    runtime.interpretationAudioControl.textContent,
    '听道童解签'
  );
  assert.equal(
    runtime.interpretationAudioStatus.textContent,
    '需要时，可请道童为您读出这份解签。'
  );

  runtime.interpretationAudioControl.trigger('click');
  runtime.interpretationAudioControl.trigger('click');
  assert.equal(runtime.fetchRequests.length, 3);
  const audioRequest = runtime.fetchRequests[2];
  assert.equal(
    audioRequest.pathname,
    '/api/fortune-sessions/fortune-ui-test/interpretation-audio'
  );
  assert.equal(audioRequest.method, 'POST');
  assert.equal('body' in audioRequest, false);
  assert.equal(runtime.interpretationAudioControl.disabled, true);
  assert.equal(
    runtime.interpretationAudioControl.textContent,
    '正在准备语音……'
  );
  await flushPromises();
  await flushPromises();
  assert.equal(runtime.createdObjectUrls.length, 1);
  assert.equal(runtime.audioElements.length, 1);
  assert.equal(runtime.audioElements[0].src, 'blob:fortune-audio-1');
  assert.equal(runtime.audioElements[0].preload, 'metadata');
  assert.equal(runtime.audioElements[0].playCallCount, 0);
  assert.equal(
    runtime.interpretationAudioControl.textContent,
    '播放解签语音'
  );

  runtime.interpretationAudioControl.trigger('click');
  await flushPromises();
  assert.equal(runtime.audioElements[0].playCallCount, 1);
  assert.equal(
    runtime.interpretationAudioControl.textContent,
    '暂停解签语音'
  );
  runtime.interpretationAudioControl.trigger('click');
  assert.equal(runtime.audioElements[0].pauseCallCount, 1);
  assert.equal(
    runtime.interpretationAudioControl.textContent,
    '继续播放'
  );
  runtime.interpretationAudioControl.trigger('click');
  await flushPromises();
  assert.equal(runtime.audioElements[0].playCallCount, 2);
  runtime.audioElements[0].currentTime = 42;
  runtime.audioElements[0].trigger('ended');
  assert.equal(
    runtime.interpretationAudioControl.textContent,
    '重新播放'
  );
  runtime.interpretationAudioControl.trigger('click');
  await flushPromises();
  assert.equal(runtime.audioElements[0].currentTime, 0);
  assert.equal(runtime.audioElements[0].playCallCount, 3);
  assert.equal(runtime.fetchRequests.length, 3);

  runtime.triggerWindow('pagehide');
  assert.deepEqual(runtime.revokedObjectUrls, ['blob:fortune-audio-1']);
  assert.equal(runtime.audioElements[0].src, '');
  assert.equal(runtime.audioElements[0].loadCallCount, 1);

  const pendingAudio = createDeferred();
  const exitRuntime = loadFortuneRuntime({
    fetchImpl(pathname) {
      if (pathname.endsWith('/interpretation-audio')) {
        return pendingAudio.promise;
      }
      if (pathname.endsWith('/interpretation')) {
        return Promise.resolve(createInterpretationResponse());
      }
      return Promise.resolve(createFortuneResponse());
    },
  });
  await reachInterpretedLot(exitRuntime);
  exitRuntime.interpretationAudioControl.trigger('click');
  const audioController = exitRuntime.abortControllers.at(-1);
  exitRuntime.triggerWindow('beforeunload');
  assert.equal(audioController.abortCallCount, 1);
  pendingAudio.resolve(createAudioResponse());
  await flushPromises();
  await flushPromises();
  assert.equal(exitRuntime.createdObjectUrls.length, 0);
  assert.equal(exitRuntime.audioElements.length, 0);

  let audioCallCount = 0;
  const retryRuntime = loadFortuneRuntime({
    fetchImpl(pathname) {
      if (pathname.endsWith('/interpretation-audio')) {
        audioCallCount += 1;
        return Promise.resolve(createAudioResponse(
          audioCallCount === 1
            ? { contentType: 'application/json' }
            : {}
        ));
      }
      if (pathname.endsWith('/interpretation')) {
        return Promise.resolve(createInterpretationResponse());
      }
      return Promise.resolve(createFortuneResponse());
    },
  });
  await reachInterpretedLot(retryRuntime);
  retryRuntime.interpretationAudioControl.trigger('click');
  await flushPromises();
  await flushPromises();
  assert.equal(
    retryRuntime.interpretationAudioControl.textContent,
    '重新获取解签语音'
  );
  assert.equal(retryRuntime.createdObjectUrls.length, 0);
  retryRuntime.interpretationAudioControl.trigger('click');
  await flushPromises();
  await flushPromises();
  assert.equal(audioCallCount, 2);
  assert.equal(retryRuntime.createdObjectUrls.length, 1);

  const playRuntime = loadFortuneRuntime({
    audioPlayImpl(audioElement, playCallCount) {
      if (playCallCount === 1) {
        return Promise.reject(new Error('play blocked'));
      }
      return Promise.resolve();
    },
  });
  await reachInterpretedLot(playRuntime);
  playRuntime.interpretationAudioControl.trigger('click');
  await flushPromises();
  await flushPromises();
  playRuntime.interpretationAudioControl.trigger('click');
  await flushPromises();
  assert.equal(
    playRuntime.interpretationAudioControl.textContent,
    '再次播放'
  );
  playRuntime.interpretationAudioControl.trigger('click');
  await flushPromises();
  assert.equal(playRuntime.audioElements[0].playCallCount, 2);
  assert.equal(playRuntime.fetchRequests.length, 3);

  const unsupportedRuntime = loadFortuneRuntime({
    unsupportedAudio: true,
  });
  await reachInterpretedLot(unsupportedRuntime);
  unsupportedRuntime.interpretationAudioControl.trigger('click');
  assert.equal(unsupportedRuntime.fetchRequests.length, 2);
  assert.equal(
    unsupportedRuntime.interpretationAudioControl.textContent,
    '重新获取解签语音'
  );
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

function verifyStagedRitualStaticContract() {
  const html = fs.readFileSync(FORTUNE_HTML_PATH, 'utf8');
  const mainHtml = html.slice(
    html.indexOf('<main'),
    html.indexOf('</main>') + '</main>'.length
  );
  const css = fs.readFileSync(ENTRY_CSS_PATH, 'utf8');
  const js = fs.readFileSync(FORTUNE_JS_PATH, 'utf8');
  const incenseSticks = html.match(
    /class="incense-stick incense-stick-(?:left|center|right)"/g
  ) || [];

  assert.equal(incenseSticks.length, 3);
  assert.equal(
    (html.match(/class="incense-ember"/g) || []).length,
    3
  );
  assert.match(html, /aria-label="香炉与三柱已经点燃的香"/);
  assert.match(html, /data-incense-state aria-live="polite">三柱清香已燃/);
  assert.doesNotMatch(html, /data-offer-incense|香火已敬|敬上一炷香/);
  assert.equal(
    (
      html.match(
        /data-speak-control[^>]*aria-pressed="false"[^>]*>开始说话<\/button>/
      ) || []
    ).length,
    1
  );
  assert.match(html, /data-wish-paper[^>]*hidden/);
  assert.match(
    html,
    /data-wish-offering-complete[^>]*hidden[\s\S]*?心愿已呈，正在为您请签……/
  );
  assert.doesNotMatch(html, /data-draw-fortune|>开始抽签<\/button>/);
  assert.match(
    html,
    /data-fortune-draw-animation[^>]*hidden[\s\S]*?lot-cylinder[\s\S]*?lot-draw-stick[\s\S]*?lot-draw-slip/
  );
  assert.match(html, /data-fortune-result[^>]*hidden/);
  assert.match(html, /data-interpret-fortune>请道童解签/);
  assert.match(
    html,
    /data-interpretation-audio-control[\s\S]*?hidden[\s\S]*?>\s*点击朗读/
  );
  assert.equal(
    (
      html.match(
        /src="\.\/assets\/fortune\/daotong-guide-v1\.png"/g
      ) || []
    ).length,
    1
  );
  assert.doesNotMatch(
    mainHtml,
    /<(?:input|textarea)\b|contenteditable=|听道童解签|下载语音/
  );
  assert.match(
    css,
    /\.fortune-page\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    css,
    /\.offering-stage\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*none;/
  );
  assert.match(css, /@keyframes lot-cylinder-shake\s*\{/);
  assert.match(css, /@keyframes lot-cylinder-wait\s*\{/);
  assert.match(css, /@keyframes lot-stick-rise\s*\{/);
  assert.match(css, /@keyframes lot-slip-reveal\s*\{/);
  assert.match(
    js,
    /wishPaper\.getBoundingClientRect\(\)[\s\S]*?wishFurnaceMouth\.getBoundingClientRect\(\)/
  );
  for (const eventName of [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'lostpointercapture',
  ]) {
    assert.match(
      js,
      new RegExp(
        `page\\.addEventListener\\(\\s*'${eventName}'`
      )
    );
  }
  assert.match(
    js,
    /speakControlButton\.addEventListener\(\s*'click'[\s\S]*?handleSpeakControlClick/
  );
  assert.doesNotMatch(
    js,
    /speakControlButton\.addEventListener\(\s*'(?:pointerdown|pointerup|pointercancel|lostpointercapture)'/
  );
  for (const removedSymbol of [
    'activePointerId',
    'keyboardPressActive',
    'handleSpeakPointerDown',
    'handleSpeakPointerEnd',
    'handleSpeakKeyDown',
    'handleSpeakKeyUp',
    'handleSpeakBlur',
    'requestFinishAfterRelease',
  ]) {
    assert.doesNotMatch(js, new RegExp(`\\b${removedSymbol}\\b`));
  }
  assert.doesNotMatch(js, /touchstart|touchend|pointermove/);
  assert.match(
    js,
    /startFortuneDrawAnimation\(requestGeneration\)[\s\S]*?window\.fetch\(FORTUNE_SESSION_API_URL/
  );
  assert.match(
    js,
    /drawShakeComplete[\s\S]*?startFortuneReveal\(requestGeneration\)/
  );
  assert.match(js, /await requestInterpretationAudio\(true\)/);
  assert.match(
    js,
    /interpretationAudioAutoPlayAttemptCount \+= 1/
  );
  assert.doesNotMatch(
    js,
    /localStorage|sessionStorage|document\.cookie|innerHTML/
  );
}

function verifyInitialReadyState() {
  const runtime = loadFortuneRuntime();
  assert.equal(runtime.page.dataset.fortuneState, 'ready-to-speak');
  assert.equal(runtime.waitingState.hidden, false);
  assert.equal(runtime.speakControlButton.hidden, false);
  assert.equal(runtime.speakControlButton.textContent, '开始说话');
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(runtime.wishPaper.hidden, true);
  assert.equal(runtime.wishOfferingComplete.hidden, true);
  assert.equal(runtime.fortuneDrawAnimation.hidden, true);
  assert.equal(runtime.fortuneResult.hidden, true);
  assert.equal(runtime.interpretationAudio.hidden, true);
  assert.equal(runtime.fetchRequests.length, 0);
  assert.equal(runtime.audioElements.length, 0);
  assert.equal(runtime.speakControlButton.listeners.has('pointerdown'), false);
  assert.equal(runtime.speakControlButton.listeners.has('pointerup'), false);
  assert.equal(runtime.speakControlButton.listeners.has('pointercancel'), false);
  assert.equal(
    runtime.speakControlButton.listeners.has('lostpointercapture'),
    false
  );
  assert.equal(
    runtime.speakControlButton.listeners.get('click').length,
    1
  );
}

async function reachStagedDrawnLot(runtime) {
  clickSpeakControl(runtime);
  assert.equal(runtime.asrSessions.length, 1);
  await flushPromises();
  assert.equal(runtime.page.dataset.fortuneState, 'listening');
  assert.equal(runtime.speakControlButton.textContent, '结束说话');
  assert.equal(runtime.wishPaper.hidden, false);
  runtime.asrSessions[0].callbacks.onPartial('愿家人平安');
  runtime.asrSessions[0].callbacks.onPartial('愿家人平安');
  assert.equal(runtime.transcriptText.textContent, '愿家人平安');

  clickSpeakControl(runtime);
  assert.equal(runtime.asrSessions[0].finishCallCount, 1);
  assert.equal(runtime.page.dataset.fortuneState, 'offering-wish');
  assert.equal(runtime.transcriptText.textContent, '测试识别结果');
  assert.equal(runtime.fetchRequests.length, 0);
  assert.equal(runtime.wishPaper.getBoundingClientRectCallCount, 1);
  assert.equal(runtime.wishFurnaceMouth.getBoundingClientRectCallCount, 1);
  const wishOfferingTimer = runtime.timers.find(
    (timer) => timer.delay === 3400
  );
  assert.ok(wishOfferingTimer);

  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  assert.equal(runtime.page.dataset.fortuneState, 'draw-ready');
  assert.equal(runtime.wishOfferingComplete.hidden, false);
  assert.equal(runtime.fetchRequests.length, 0);
  assert.equal(wishOfferingTimer.active, false);
  wishOfferingTimer.callback();
  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  assert.equal(runtime.fetchRequests.length, 0);
  await flushPromises();
  assert.equal(runtime.fetchRequests.length, 1);
  assert.equal(runtime.page.dataset.fortuneState, 'drawing-lot');
  assert.equal(runtime.fortuneDrawAnimation.hidden, false);
  assert.equal(
    runtime.fortuneDrawAnimation.classList.contains('is-shaking'),
    true
  );
  assert.equal(runtime.fortuneResult.hidden, true);
  runtime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-cylinder-shake',
    target: runtime.fortuneDrawAnimation,
  });
  assert.equal(
    runtime.fortuneDrawAnimation.classList.contains('is-revealing'),
    true
  );
  assert.equal(runtime.fortuneResult.hidden, true);
  runtime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-slip-reveal',
    target: runtime.fortuneDrawAnimation,
  });
  assert.equal(runtime.page.dataset.fortuneState, 'lot-drawn');
  assert.equal(runtime.fortuneResult.hidden, false);
  assert.equal(runtime.interpretFortuneButton.hidden, false);
  assert.equal(runtime.interpretFortuneButton.textContent, '请道童解签');
  assert.equal(runtime.audioElements.length, 0);
  return runtime;
}

async function verifyClickAndStagedFlow() {
  const runtime = await reachStagedDrawnLot(loadFortuneRuntime());
  runtime.interpretFortuneButton.trigger('click');
  runtime.interpretFortuneButton.trigger('click');
  await flushPromises();
  await flushPromises();
  assert.equal(runtime.fetchRequests.length, 3);
  assert.equal(
    runtime.fetchRequests[1].pathname,
    '/api/fortune-sessions/fortune-ui-test/interpretation'
  );
  assert.equal(
    runtime.fetchRequests[2].pathname,
    '/api/fortune-sessions/fortune-ui-test/interpretation-audio'
  );
  assert.equal(Object.hasOwn(runtime.fetchRequests[2], 'body'), false);
  assert.equal(runtime.page.dataset.fortuneState, 'lot-interpreted');
  assert.equal(runtime.interpretationResult.hidden, false);
  assert.match(runtime.interpretationText.textContent, /先稳住心绪/);
  assert.equal(runtime.audioElements.length, 1);
  assert.equal(runtime.audioElements[0].playCallCount, 1);
  assert.equal(runtime.interpretationAudioControl.hidden, true);
  assert.equal(runtime.resetFortuneButton.hidden, false);

  const requestCountBeforeReset = runtime.fetchRequests.length;
  let returnPrevented = false;
  runtime.fortuneReturnLink.trigger('click', {
    preventDefault() {
      returnPrevented = true;
    },
    target: runtime.fortuneReturnLink,
  });
  assert.equal(returnPrevented, true);
  assert.equal(runtime.page.dataset.fortuneState, 'ready-to-speak');
  assert.equal(runtime.page.dataset.fortuneCharacterKey, 'guanyin');
  assert.equal(runtime.fortuneResult.hidden, true);
  assert.equal(runtime.interpretationResult.hidden, true);
  assert.equal(runtime.resetFortuneButton.hidden, true);
  assert.equal(runtime.lotNumber.textContent, '');
  assert.equal(runtime.lotLevel.textContent, '');
  assert.equal(runtime.lotTitle.textContent, '');
  assert.equal(runtime.lotVerses.textContent, '');
  assert.equal(runtime.interpretationText.textContent, '');
  assert.equal(runtime.transcriptText.textContent, '');
  assert.equal(runtime.audioElements[0].pauseCallCount, 1);
  assert.deepEqual(runtime.revokedObjectUrls, ['blob:fortune-audio-1']);
  assert.equal(runtime.fetchRequests.length, requestCountBeforeReset);
  assert.equal(runtime.speakControlButton.focusCallCount, 1);

  runtime.triggerWindow('pagehide');
  assert.equal(runtime.audioElements[0].pauseCallCount, 1);
  assert.deepEqual(runtime.revokedObjectUrls, ['blob:fortune-audio-1']);

}

async function verifyAutoplayRejectionFallback() {
  const runtime = await reachStagedDrawnLot(loadFortuneRuntime({
    audioPlayImpl() {
      const error = new Error('play() failed because autoplay is blocked');
      error.name = 'NotAllowedError';
      return Promise.reject(error);
    },
  }));
  runtime.interpretFortuneButton.trigger('click');
  await flushPromises();
  await flushPromises();
  assert.match(runtime.interpretationText.textContent, /先稳住心绪/);
  assert.equal(runtime.audioElements[0].playCallCount, 1);
  assert.equal(runtime.interpretationAudioControl.hidden, false);
  assert.equal(runtime.interpretationAudioControl.textContent, '点击朗读');
  assert.match(
    runtime.interpretationAudioStatus.textContent,
    /浏览器未能自动播放/
  );
}

async function reachAutomaticDraw(runtime) {
  clickSpeakControl(runtime);
  await flushPromises();
  clickSpeakControl(runtime);
  runtime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: runtime.wishOfferingStage,
  });
  assert.equal(runtime.page.dataset.fortuneState, 'draw-ready');
  assert.equal(runtime.fetchRequests.length, 0);
  await flushPromises();
  assert.equal(runtime.fetchRequests.length, 1);
  return runtime;
}

async function verifyDrawWaitingFailureAndInvalidFinal() {
  const responseDeferred = createDeferred();
  const waitingRuntime = await reachAutomaticDraw(loadFortuneRuntime({
    fetchImpl() {
      return responseDeferred.promise;
    },
  }));
  assert.equal(waitingRuntime.fetchRequests.length, 1);
  waitingRuntime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-cylinder-shake',
    target: waitingRuntime.fortuneDrawAnimation,
  });
  assert.equal(
    waitingRuntime.fortuneDrawAnimation.classList.contains('is-waiting'),
    true
  );
  assert.equal(
    waitingRuntime.fortuneDrawAnimation.classList.contains('is-shaking'),
    false
  );
  responseDeferred.resolve(createFortuneResponse());
  await flushPromises();
  assert.equal(
    waitingRuntime.fortuneDrawAnimation.classList.contains('is-revealing'),
    true
  );

  const failureResponse = createDeferred();
  let failureRequestCount = 0;
  const failureRuntime = await reachAutomaticDraw(loadFortuneRuntime({
    fetchImpl() {
      failureRequestCount += 1;
      if (failureRequestCount === 1) {
        return failureResponse.promise;
      }
      return Promise.resolve(createFortuneResponse());
    },
  }));
  assert.equal(failureRequestCount, 1);
  failureResponse.resolve({
    ok: false,
    async json() {
      return {};
    },
  });
  await flushPromises();
  assert.equal(failureRuntime.page.dataset.fortuneState, 'lot-error');
  assert.equal(failureRuntime.fortuneDrawAnimation.hidden, true);
  assert.equal(failureRuntime.fortuneResult.hidden, true);
  assert.equal(failureRuntime.retryFortuneButton.disabled, false);
  await flushPromises();
  assert.equal(failureRequestCount, 1);
  failureRuntime.retryFortuneButton.trigger('click');
  failureRuntime.retryFortuneButton.trigger('click');
  assert.equal(failureRequestCount, 2);
  assert.equal(failureRuntime.retryFortuneButton.disabled, true);
  await flushPromises();
  failureRuntime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-cylinder-shake',
    target: failureRuntime.fortuneDrawAnimation,
  });
  failureRuntime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-slip-reveal',
    target: failureRuntime.fortuneDrawAnimation,
  });
  assert.equal(failureRuntime.page.dataset.fortuneState, 'lot-drawn');
  assert.equal(failureRuntime.fortuneResult.hidden, false);

  const invalidSessions = [];
  const invalidRuntime = loadFortuneRuntime({
    createSession(callbacks) {
      const session = {
        callbacks,
        closeCallCount: 0,
        finishCallCount: 0,
        async start() {
          callbacks.onConnecting();
          callbacks.onStarted();
          return true;
        },
        finish() {
          this.finishCallCount += 1;
          callbacks.onFinishing();
          Promise.resolve().then(() => callbacks.onFinal('   ', true));
          return true;
        },
        close() {
          this.closeCallCount += 1;
          callbacks.onClosed();
          return true;
        },
      };
      invalidSessions.push(session);
      return session;
    },
  });
  clickSpeakControl(invalidRuntime);
  await flushPromises();
  clickSpeakControl(invalidRuntime);
  await flushPromises();
  assert.equal(invalidSessions[0].finishCallCount, 1);
  assert.equal(invalidRuntime.page.dataset.fortuneState, 'ready-to-speak');
  assert.equal(invalidRuntime.wishOfferingStage.hidden, true);
  assert.equal(invalidRuntime.wishPaper.hidden, true);
  assert.match(invalidRuntime.speechMessage.textContent, /没有听清/);
  assert.equal(invalidRuntime.fetchRequests.length, 0);
}

async function verifyTtsFailureAndPendingRequestCleanup() {
  const ttsFailureRuntime = await reachStagedDrawnLot(loadFortuneRuntime({
    fetchImpl(pathname) {
      if (pathname.endsWith('/interpretation-audio')) {
        return Promise.resolve(createAudioResponse({ ok: false }));
      }
      if (pathname.endsWith('/interpretation')) {
        return Promise.resolve(createInterpretationResponse());
      }
      return Promise.resolve(createFortuneResponse());
    },
  }));
  ttsFailureRuntime.interpretFortuneButton.trigger('click');
  await flushPromises();
  await flushPromises();
  assert.match(ttsFailureRuntime.interpretationText.textContent, /先稳住心绪/);
  assert.equal(ttsFailureRuntime.audioElements.length, 0);
  assert.match(
    ttsFailureRuntime.interpretationAudioStatus.textContent,
    /朗读暂时不可用/
  );

  const interpretationDeferred = createDeferred();
  const pendingInterpretationRuntime = await reachStagedDrawnLot(
    loadFortuneRuntime({
      fetchImpl(pathname) {
        if (pathname.endsWith('/interpretation')) {
          return interpretationDeferred.promise;
        }
        return Promise.resolve(createFortuneResponse());
      },
    })
  );
  pendingInterpretationRuntime.interpretFortuneButton.trigger('click');
  const interpretationController =
    pendingInterpretationRuntime.abortControllers.at(-1);
  pendingInterpretationRuntime.triggerWindow('pagehide');
  assert.equal(interpretationController.abortCallCount, 1);
  interpretationDeferred.resolve(createInterpretationResponse());
  await flushPromises();
  assert.equal(pendingInterpretationRuntime.interpretationResult.hidden, true);

  const audioDeferred = createDeferred();
  const pendingAudioRuntime = await reachStagedDrawnLot(loadFortuneRuntime({
    fetchImpl(pathname) {
      if (pathname.endsWith('/interpretation-audio')) {
        return audioDeferred.promise;
      }
      if (pathname.endsWith('/interpretation')) {
        return Promise.resolve(createInterpretationResponse());
      }
      return Promise.resolve(createFortuneResponse());
    },
  }));
  pendingAudioRuntime.interpretFortuneButton.trigger('click');
  await flushPromises();
  assert.match(pendingAudioRuntime.interpretationText.textContent, /先稳住心绪/);
  const audioController = pendingAudioRuntime.abortControllers.at(-1);
  pendingAudioRuntime.triggerWindow('pagehide');
  assert.equal(audioController.abortCallCount, 1);
  audioDeferred.resolve(createAudioResponse());
  await flushPromises();
  assert.equal(pendingAudioRuntime.audioElements.length, 0);
}

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createAccountApiResponse(balanceCents, {
  alipay = true,
  canRecharge = true,
  wechat = true,
} = {}) {
  return createJsonResponse(200, {
    principal: { type: 'user', id: 'paid-ui-user' },
    profile: { phoneMasked: '138****8000' },
    account: {
      currency: 'CNY',
      balanceCents,
      remainingSeconds: 0,
    },
    permissions: {
      canRecharge,
      paymentMode: 'mock',
      paymentProviders: { alipay, wechat },
      publicPaymentEntryEnabled: true,
    },
  });
}

function createPricingApiResponse() {
  return createJsonResponse(200, {
    drawPriceCents: 200,
    currency: 'CNY',
    chargeTiming: 'fortune_session_created',
  });
}

async function verifyPaidFortuneUiFlow() {
  let guestSessionRequests = 0;
  const guestRuntime = loadFortuneRuntime({
    paidUi: true,
    fetchImpl(pathname) {
      if (pathname === '/api/fortune-config') {
        return Promise.resolve(createPricingApiResponse());
      }
      if (pathname === '/api/me') {
        return Promise.resolve(createJsonResponse(200, {
          principal: { type: 'guest', id: 'guest-ui' },
          account: null,
          permissions: {
            canRecharge: false,
            paymentMode: 'disabled',
            paymentProviders: { alipay: false, wechat: false },
            publicPaymentEntryEnabled: false,
          },
        }));
      }
      guestSessionRequests += 1;
      throw new Error('guest must not create a Fortune Session');
    },
  });
  await flushPromises();
  await flushPromises();
  assert.equal(guestRuntime.fortunePrice.textContent, '¥2.00');
  assert.equal(guestRuntime.fortuneBalance.textContent, '--');
  clickSpeakControl(guestRuntime);
  await flushPromises();
  assert.equal(guestRuntime.asrSessions.length, 0);
  assert.equal(guestSessionRequests, 0);
  assert.equal(guestRuntime.fortuneLoginOverlay.hidden, false);
  assert.match(guestRuntime.speechMessage.textContent, /请先登录后求签/);

  const disabledRuntime = loadFortuneRuntime({
    paidUi: true,
    fetchImpl(pathname) {
      if (pathname === '/api/fortune-config') {
        return Promise.resolve(createPricingApiResponse());
      }
      if (pathname === '/api/me') {
        return Promise.resolve(createAccountApiResponse(199, {
          alipay: false,
          canRecharge: false,
          wechat: false,
        }));
      }
      throw new Error(`disabled recharge requested ${pathname}`);
    },
  });
  await flushPromises();
  await flushPromises();
  assert.equal(disabledRuntime.fortuneBalance.textContent, '¥1.99');
  assert.equal(disabledRuntime.rechargeEntry.hidden, true);
  clickSpeakControl(disabledRuntime);
  await flushPromises();
  assert.equal(disabledRuntime.asrSessions.length, 0);
  assert.equal(
    disabledRuntime.page.dataset.fortuneState,
    'insufficient-balance'
  );
  assert.equal(disabledRuntime.fortuneError.hidden, false);
  assert.equal(disabledRuntime.fortuneRechargeButton.hidden, true);
  assert.equal(disabledRuntime.retryFortuneButton.disabled, true);
  assert.match(
    disabledRuntime.fortuneErrorMessage.textContent,
    /当前暂未开放话费充值/
  );
  assert.equal(
    disabledRuntime.fetchRequests.some(
      (request) => request.pathname === '/api/fortune-sessions'
        || request.pathname === '/api/payment-orders'
    ),
    false
  );

  let sufficientBalance = 1250;
  const sufficientRuntime = loadFortuneRuntime({
    paidUi: true,
    fetchImpl(pathname) {
      if (pathname === '/api/fortune-config') {
        return Promise.resolve(createPricingApiResponse());
      }
      if (pathname === '/api/me') {
        return Promise.resolve(createAccountApiResponse(sufficientBalance));
      }
      if (pathname === '/api/fortune-sessions') {
        sufficientBalance = 1050;
        return Promise.resolve(createFortuneResponse());
      }
      throw new Error(`unexpected request ${pathname}`);
    },
  });
  await flushPromises();
  await flushPromises();
  assert.equal(sufficientRuntime.fortuneBalance.textContent, '¥12.50');
  clickSpeakControl(sufficientRuntime);
  await flushPromises();
  assert.equal(sufficientRuntime.asrSessions.length, 1);
  clickSpeakControl(sufficientRuntime);
  sufficientRuntime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: sufficientRuntime.wishOfferingStage,
  });
  await flushPromises();
  await flushPromises();
  const sufficientDraws = sufficientRuntime.fetchRequests.filter(
    (request) => request.pathname === '/api/fortune-sessions'
  );
  assert.equal(sufficientDraws.length, 1);
  const sufficientBody = JSON.parse(sufficientDraws[0].body);
  assert.deepEqual(sufficientBody, {
    clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    characterKey: 'guanyin',
    situationText: '测试识别结果',
  });
  assert.equal(sufficientRuntime.fortuneBalance.textContent, '¥10.50');
  sufficientRuntime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-cylinder-shake',
    target: sufficientRuntime.fortuneDrawAnimation,
  });
  sufficientRuntime.fortuneDrawAnimation.trigger('animationend', {
    animationName: 'lot-slip-reveal',
    target: sufficientRuntime.fortuneDrawAnimation,
  });
  assert.equal(sufficientRuntime.page.dataset.fortuneState, 'lot-drawn');
  assert.match(sufficientRuntime.fortuneChargeSuccess.textContent, /本次已扣 ¥2.00/);

  let insufficientAttempt = 0;
  let insufficientBalance = 1250;
  const insufficientRuntime = loadFortuneRuntime({
    paidUi: true,
    clientRequestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    fetchImpl(pathname) {
      if (pathname === '/api/fortune-config') {
        return Promise.resolve(createPricingApiResponse());
      }
      if (pathname === '/api/me') {
        return Promise.resolve(createAccountApiResponse(insufficientBalance));
      }
      if (pathname === '/api/fortune-sessions') {
        insufficientAttempt += 1;
        if (insufficientAttempt === 1) {
          insufficientBalance = 199;
          return Promise.resolve(createJsonResponse(409, {
            error: {
              code: 'INSUFFICIENT_ACCOUNT_BALANCE',
              message: 'insufficient',
              priceCents: 200,
              balanceCents: 199,
              shortfallCents: 1,
            },
          }));
        }
        insufficientBalance = 999;
        return Promise.resolve(createJsonResponse(201, {
          fortuneSession: {
            id: 'fortune-ui-test',
            status: 'drawn',
            deityKey: 'yuhuang',
            catalogVersion: 'prototype-v1',
            lot: {
              id: 'prototype-002',
              number: 2,
              level: '中吉',
              title: '守心待时',
              verseLines: ['眼前云淡风初定', '守得心安路自明'],
            },
            createdAt: '2026-07-28T06:00:00.000Z',
            drawnAt: '2026-07-28T06:00:00.000Z',
          },
          charge: {
            priceCents: 200,
            currency: 'CNY',
            balanceBeforeCents: 1199,
            balanceAfterCents: 999,
            alreadyProcessed: false,
          },
        }));
      }
      throw new Error(`unexpected request ${pathname}`);
    },
  });
  await flushPromises();
  await flushPromises();
  clickSpeakControl(insufficientRuntime);
  await flushPromises();
  clickSpeakControl(insufficientRuntime);
  insufficientRuntime.wishOfferingStage.trigger('animationend', {
    animationName: 'wish-offering-stage-sequence',
    target: insufficientRuntime.wishOfferingStage,
  });
  await flushPromises();
  await flushPromises();
  assert.equal(
    insufficientRuntime.page.dataset.fortuneState,
    'insufficient-balance'
  );
  assert.match(insufficientRuntime.fortuneErrorMessage.textContent, /还差 ¥0.01/);
  assert.equal(insufficientRuntime.fortuneRechargeButton.hidden, false);
  insufficientRuntime.triggerWindow('companion:account-balance-updated', {
    detail: { currency: 'CNY', balanceCents: 1199 },
  });
  await flushPromises();
  await flushPromises();
  const insufficientDraws = insufficientRuntime.fetchRequests.filter(
    (request) => request.pathname === '/api/fortune-sessions'
  );
  assert.equal(insufficientDraws.length, 2);
  assert.equal(
    JSON.parse(insufficientDraws[0].body).clientRequestId,
    JSON.parse(insufficientDraws[1].body).clientRequestId
  );
  assert.equal(insufficientRuntime.asrSessions.length, 1);
  assert.equal(insufficientRuntime.fortuneBalance.textContent, '¥9.99');
}

async function main() {
  verifyStagedRitualStaticContract();
  verifyInitialReadyState();
  verifyCharacterVisualSelection();
  await verifyFortuneCharacterSwipeConsistency();
  await verifyClickAndStagedFlow();
  await verifyAutoplayRejectionFallback();
  await verifyDrawWaitingFailureAndInvalidFinal();
  await verifyTtsFailureAndPendingRequestCleanup();
  verifyRelayUrlAndInitialPrivacy();
  await verifyStartProtocolAndRealSampleRate();
  await verifyTailFinishFinalAndCleanup();
  await verifyAsrErrorsTimeoutAndIdempotentClose();
  await verifyModulePageExitAndFailureBoundaries();
  await verifyPaidFortuneUiFlow();

  process.stdout.write('fortune_incense_interaction_test: PASS\n');
  process.stdout.write(
    'verified=single-shrine-scene,three-incense-sticks,click-to-speak,'
      + 'page-swipe-pointer-events,'
      + 'microphone-user-gesture,single-request,start-stop,'
      + 'all-tracks-stopped,pagehide-beforeunload,no-recording-upload,'
      + 'relay-url,start-started,real-sample-rate,resample-pcm16-le,'
      + 'binary-chunks,tail-before-finish,partial-final-wish-paper,'
      + 'wish-paper-auto-adoption,wish-offering-animation,'
      + 'automatic-fortune-draw,single-fortune-request,manual-draw-retry,'
      + 'finite-draw-shake,low-frequency-wait,response-gated-reveal,'
      + 'fortune-interpretation,interpretation-safe-render,'
      + 'interpretation-audio,automatic-audio-attempt,autoplay-fallback,'
      + 'blob-url-cleanup,'
      + 'final-timeout,asr-error,'
      + 'abnormal-close,stale-session,paid-login-gate,paid-balance-gate,'
      + 'paid-idempotent-recharge-resume\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
