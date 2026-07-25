'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_DIR = path.resolve(__dirname, '..');
const HOME_JS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/ui.js'
);
const AUTH_JS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/auth.js'
);
const AUTH_HTML_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/index.html'
);
const HOME_HTML_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/home.html'
);
const CALL_JS_PATH = path.join(PROJECT_DIR, 'public/realtime_call_ui.js');
const CALL_HTML_PATH = path.join(PROJECT_DIR, 'public/index.html');
const MIC_JS_PATH = path.join(
  PROJECT_DIR,
  'public/doubao_mic_single_turn.js'
);
const CALL_URL = 'http://127.0.0.1:3001/';
const HOME_PATH = '/ui_prototypes/yuhuang_mobile_v1/home.html';
const IDENTITY_ENTRY_PATH =
  '/ui_prototypes/yuhuang_mobile_v1/index.html';
const DEFAULT_HOME_URL = new URL(HOME_PATH, 'http://127.0.0.1:8765/').href;
const DEFAULT_IDENTITY_ENTRY_URL = new URL(
  IDENTITY_ENTRY_PATH,
  DEFAULT_HOME_URL
).href;

const UI_MATRIX = Object.freeze([
  {
    key: 'yuhuang',
    name: '玉皇大帝',
    homeImage: './assets/characters/yuhuang/yuhuang-home-hero-v1.png',
    callImage: './assets/characters/yuhuang/yuhuang-home-hero-v1.png',
    location: '凌霄宝殿 · 实时陪伴',
    motto: '端坐凌霄，听您慢慢说',
    idle: '玉帝已准备好，轻触下方即可通话',
    connected: '玉帝已接通，正在准备通话',
    listening: '玉帝正在听',
    userSpeaking: '玉帝正在听您说',
    thinking: '玉帝正在思考',
    speaking: '玉帝正在回应',
  },
  {
    key: 'sunwukong',
    name: '孙悟空',
    homeImage:
      './assets/characters/sunwukong/sunwukong-home-hero-v2.png',
    callImage:
      './assets/characters/sunwukong/sunwukong-call-hero-v2.png',
    location: '花果山 · 实时陪伴',
    motto: '火眼金睛，陪您轻松聊聊',
    idle: '孙悟空已准备好，轻触下方即可通话',
    connected: '孙悟空已接通，正在准备通话',
    listening: '孙悟空正在听',
    userSpeaking: '孙悟空正在听您说',
    thinking: '孙悟空正在思考',
    speaking: '孙悟空正在回应',
  },
  {
    key: 'guanyin',
    name: '观音菩萨',
    homeImage: './assets/characters/guanyin/guanyin-home-hero-v1.png',
    callImage: './assets/characters/guanyin/guanyin-call-hero-v1.png',
    location: '南海莲台 · 实时陪伴',
    motto: '慈心静听，陪您安心说',
    idle: '观音已准备好',
    connected: '观音已接通',
    listening: '观音正在听',
    userSpeaking: '观音正在听您说',
    thinking: '观音正在思考',
    speaking: '观音正在回应',
  },
  {
    key: 'caishen',
    name: '财神爷',
    homeImage: './assets/characters/caishen/caishen-home-hero-v1.png',
    callImage: './assets/characters/caishen/caishen-call-hero-v1.png',
    location: '迎祥宝殿 · 实时陪伴',
    motto: '笑迎福气，陪您聊聊家常',
    idle: '财神爷已准备好',
    connected: '财神爷已接通',
    listening: '财神爷正在听',
    userSpeaking: '财神爷正在听您说',
    thinking: '财神爷正在思考',
    speaking: '财神爷正在回应',
  },
  {
    key: 'rulai',
    name: '如来佛祖',
    homeImage: './assets/characters/rulai/rulai-home-hero-v1.png',
    callImage: './assets/characters/rulai/rulai-call-hero-v1.png',
    location: '灵山宝殿 · 实时陪伴',
    motto: '心平气和，听您慢慢说',
    idle: '如来佛祖已准备好',
    connected: '如来佛祖已接通',
    listening: '如来佛祖正在听',
    userSpeaking: '如来佛祖正在听您说',
    thinking: '如来佛祖正在思考',
    speaking: '如来佛祖正在回应',
  },
  {
    key: 'zhubajie',
    name: '猪八戒',
    homeImage:
      './assets/characters/zhubajie/zhubajie-home-hero-v1.png',
    callImage:
      './assets/characters/zhubajie/zhubajie-call-hero-v1.png',
    location: '高老庄 · 实时陪伴',
    motto: '乐呵相伴，陪您说说笑笑',
    idle: '猪八戒已准备好',
    connected: '猪八戒已接通',
    listening: '猪八戒正在听',
    userSpeaking: '猪八戒正在听您说',
    thinking: '猪八戒正在思考',
    speaking: '猪八戒正在回应',
  },
  {
    key: 'shawujing',
    name: '沙悟净',
    homeImage:
      './assets/characters/shawujing/shawujing-home-hero-v1.png',
    callImage:
      './assets/characters/shawujing/shawujing-call-hero-v1.png',
    location: '流沙河畔 · 实时陪伴',
    motto: '踏实守候，陪您慢慢聊',
    idle: '沙悟净已准备好',
    connected: '沙悟净已接通',
    listening: '沙悟净正在听',
    userSpeaking: '沙悟净正在听您说',
    thinking: '沙悟净正在思考',
    speaking: '沙悟净正在回应',
  },
  {
    key: 'tangseng',
    name: '唐僧',
    homeImage:
      './assets/characters/tangseng/tangseng-home-hero-v1.png',
    callImage:
      './assets/characters/tangseng/tangseng-call-hero-v1.png',
    location: '大唐禅院 · 实时陪伴',
    motto: '温和耐心，陪您安心说',
    idle: '唐僧已准备好',
    connected: '唐僧已接通',
    listening: '唐僧正在听',
    userSpeaking: '唐僧正在听您说',
    thinking: '唐僧正在思考',
    speaking: '唐僧正在回应',
  },
]);

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const shouldAdd = force === undefined
      ? !this.values.has(name)
      : Boolean(force);
    if (shouldAdd) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    return shouldAdd;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.handlers = new Map();
    this.hidden = false;
    this.style = {
      display: '',
      removeProperty: (name) => {
        if (name === 'display') {
          this.style.display = '';
        }
      },
    };
    this.textContent = '';
  }

  addEventListener(eventName, handler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName).push(handler);
  }

  click() {
    for (const handler of this.handlers.get('click') || []) {
      handler({
        currentTarget: this,
        preventDefault() {},
        target: this,
      });
    }
  }

  closest() {
    return null;
  }

  focus() {}

  getBoundingClientRect() {
    return {
      bottom: 500,
      left: 0,
      right: 500,
      top: 0,
    };
  }

  hasPointerCapture() {
    return true;
  }

  querySelector() {
    return null;
  }

  releasePointerCapture() {}

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'src') {
      this.src = '';
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'src') {
      this.src = String(value);
    }
    if (name === 'alt') {
      this.alt = String(value);
    }
  }

  setPointerCapture() {}
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createLocalStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function loadHomeRuntime(options = {}) {
  let source = fs.readFileSync(HOME_JS_PATH, 'utf8');
  source = source.replace(
    '  initializeUi();',
    `  globalThis.__homeTest = {
      REALTIME_URLS_BY_CHARACTER_KEY,
      buildRealtimeNavigationUrl,
      characters,
      closeOverlay,
      getActiveOverlay: () => activeOverlay,
      getCurrentCharacterKey: () => currentCharacterKey,
      getPrototypeCreditBalance: () => prototypeCreditBalance,
      getValidatedAuthState,
      handleCharacterPointerDown,
      handleCharacterPointerUp,
      handlePackageSelection,
      handlePaymentSelection,
      handleRechargeConfirmation,
      handleStartConversation,
      openOverlay,
      selectCharacter,
      warmAdjacentCharacterImages,
    };`
  );

  const imageRequests = [];
  const characterStage = new FakeElement();
  const rechargePanel = new FakeElement();
  const rechargeLoginOverlay = new FakeElement();
  const rechargeEntry = new FakeElement();
  const rechargeResult = new FakeElement();
  const rechargeSelectionSummary = new FakeElement();
  const customAmountField = new FakeElement();
  const customAmountInput = new FakeElement();
  const customAmountError = new FakeElement();
  const creditDisplay = new FakeElement();
  const packageButtons = [];
  const paymentButtons = [];
  const locationAssignments = [];
  const localStorage = createLocalStorage(options.storageEntries);
  const homePageUrl = new URL(
    options.homePageUrl || DEFAULT_HOME_URL
  );

  class FakeImage {
    set src(value) {
      this.value = value;
      imageRequests.push(value);
      const delay = options.imageDelays
        && Object.hasOwn(options.imageDelays, value)
        ? options.imageDelays[value]
        : 0;
      setTimeout(() => {
        if (options.failedImages
          && options.failedImages.has(value)) {
          if (this.onerror) {
            this.onerror(new Error('image failed'));
          }
          return;
        }
        if (this.onload) {
          this.onload();
        }
      }, delay);
    }
  }

  const document = {
    addEventListener() {},
    body: {
      classList: new FakeClassList(),
      dataset: {},
    },
    querySelector(selector) {
      const elements = {
        '.character-stage': characterStage,
        '.custom-amount-error': customAmountError,
        '.custom-amount-field': customAmountField,
        '.custom-amount-input': customAmountInput,
        '.recharge-login-overlay': rechargeLoginOverlay,
        '.recharge-panel': rechargePanel,
        '.recharge-result': rechargeResult,
        '.recharge-selection-summary': rechargeSelectionSummary,
        '.time-recharge-entry': rechargeEntry,
      };
      return elements[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-current-credit]') {
        return [creditDisplay];
      }
      if (selector === '.package-option') {
        return packageButtons;
      }
      if (selector === '.payment-option') {
        return paymentButtons;
      }
      return [];
    },
    title: '',
  };
  const window = {
    clearTimeout,
    localStorage,
    location: {
      assign(url) {
        locationAssignments.push(url);
      },
      href: homePageUrl.href,
      hostname: homePageUrl.hostname,
      origin: homePageUrl.origin,
      port: homePageUrl.port,
      protocol: homePageUrl.protocol,
    },
    setTimeout,
  };
  const context = {
    Element: FakeElement,
    Image: FakeImage,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    document,
    globalThis: null,
    setTimeout,
    window,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, {
    filename: HOME_JS_PATH,
  });
  return {
    characterStage,
    imageRequests,
    localStorage,
    locationAssignments,
    rechargeLoginOverlay,
    rechargePanel,
    customAmountInput,
    test: context.__homeTest,
  };
}

function pointerEvent(stage, pointerId, clientX, clientY) {
  return {
    button: 0,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: 'touch',
    target: stage,
  };
}

function createCallRuntime(characterKey, options = {}) {
  const selectors = {
    '.page-shell': new FakeElement(),
    '[data-call-character-image]': new FakeElement(),
    '[data-call-character-heading]': new FakeElement(),
    '[data-call-character-location]': new FakeElement(),
    '[data-call-character-name]': new FakeElement(),
    '[data-call-character-motto]': new FakeElement(),
    '[data-call-character-controls]': new FakeElement(),
  };
  const ids = {
    callDuration: new FakeElement(),
    callIdentityEntry: new FakeElement(),
    callPrimaryButton: new FakeElement(),
    callReturnButton: new FakeElement(),
    callStatusText: new FakeElement(),
    connectButton: new FakeElement(),
    debugPanel: new FakeElement(),
    startMicrophoneButton: new FakeElement(),
  };
  ids.callReturnButton.setAttribute('aria-disabled', 'true');
  ids.callReturnButton.setAttribute('tabindex', '-1');
  ids.callIdentityEntry.setAttribute('aria-disabled', 'true');
  ids.callIdentityEntry.setAttribute('tabindex', '-1');
  const subscriptions = [];
  const apiCounts = {
    connect: 0,
    disconnect: 0,
    startAudio: 0,
    warmupPlayback: 0,
  };
  const api = {
    async connect() {
      apiCounts.connect += 1;
    },
    async disconnect() {
      apiCounts.disconnect += 1;
      return {};
    },
    async startAudio() {
      apiCounts.startAudio += 1;
    },
    subscribe(handler) {
      subscriptions.push(handler);
    },
    async warmupPlayback() {
      apiCounts.warmupPlayback += 1;
    },
  };
  const document = {
    body: {
      classList: new FakeClassList(),
    },
    referrer: options.referrer || '',
    getElementById(id) {
      return ids[id] || null;
    },
    querySelector(selector) {
      return selectors[selector] || null;
    },
    title: '',
  };
  const locationAssignments = [];
  const callPageUrl = new URL(options.callPageUrl || CALL_URL);
  const searchParams = new URLSearchParams();
  if (characterKey !== null) {
    searchParams.set('characterKey', characterKey);
  }
  const returnUrl = Object.hasOwn(options, 'returnUrl')
    ? options.returnUrl
    : DEFAULT_HOME_URL;
  if (typeof returnUrl === 'string') {
    searchParams.set('returnUrl', returnUrl);
  }
  callPageUrl.search = searchParams.toString();
  const window = {
    addEventListener() {},
    clearInterval() {},
    clearTimeout,
    location: {
      assign(url) {
        locationAssignments.push(url);
      },
      href: callPageUrl.href,
      hostname: callPageUrl.hostname,
      origin: callPageUrl.origin,
      port: callPageUrl.port,
      protocol: callPageUrl.protocol,
      search: callPageUrl.search,
    },
    setInterval() {
      return 1;
    },
    setTimeout,
  };
  if (options.realtimeApiAvailable !== false) {
    window.DoubaoRealtimeCall = api;
  }
  vm.runInNewContext(fs.readFileSync(CALL_JS_PATH, 'utf8'), {
    URL,
    URLSearchParams,
    console,
    document,
    window,
  }, {
    filename: CALL_JS_PATH,
  });
  return {
    apiCounts,
    document,
    ids,
    locationAssignments,
    selectors,
    subscriptions,
  };
}

async function verifyMicReconnectCharacterKey() {
  const originalSource = fs.readFileSync(MIC_JS_PATH, 'utf8');
  const source = originalSource.replace(
    "publishRealtimeCallState('idle');",
    "publishRealtimeCallState('idle');\n"
      + 'globalThis.__micTest = { connectRelay };'
  );

  for (const expected of UI_MATRIX) {
    const sockets = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.binaryType = '';
        this.handlers = new Map();
        this.readyState = FakeWebSocket.CONNECTING;
        this.sent = [];
        this.url = url;
        sockets.push(this);
      }

      addEventListener(eventName, handler) {
        if (!this.handlers.has(eventName)) {
          this.handlers.set(eventName, []);
        }
        this.handlers.get(eventName).push(handler);
      }

      close(code = 1000, reason = '') {
        this.readyState = FakeWebSocket.CLOSED;
        this.emit('close', {
          code,
          reason,
        });
      }

      emit(eventName, event) {
        for (const handler of this.handlers.get(eventName) || []) {
          handler(event);
        }
      }

      send(data) {
        this.sent.push(JSON.parse(data));
      }
    }

    const elements = new Map([
      'connectButton',
      'disconnectButton',
      'startMicrophoneButton',
      'stopMicrophoneButton',
      'connectionState',
      'microphoneState',
      'playbackState',
      'turnState',
      'logOutput',
    ].map((id) => [id, new FakeElement()]));
    const document = {
      getElementById(id) {
        return elements.get(id) || null;
      },
    };
    const search = expected.key === 'yuhuang'
      ? ''
      : `?characterKey=${expected.key}`;
    const window = {
      addEventListener() {},
      clearTimeout,
      location: {
        search,
      },
      setTimeout,
    };
    const context = {
      AudioContext: class {},
      Blob,
      Element: FakeElement,
      Int16Array,
      URLSearchParams,
      WebSocket: FakeWebSocket,
      clearTimeout,
      console,
      document,
      globalThis: null,
      navigator: {},
      setTimeout,
      window,
    };
    context.globalThis = context;
    vm.runInNewContext(source, context, {
      filename: MIC_JS_PATH,
    });

    await context.__micTest.connectRelay();
    assert.equal(sockets.length, 1);
    const firstSocket = sockets[0];
    firstSocket.readyState = FakeWebSocket.OPEN;
    firstSocket.emit('message', {
      data: JSON.stringify({
        type: 'relay.ready',
        version: 'local-fake',
      }),
    });
    assert.deepEqual(firstSocket.sent[0], {
      type: 'browser.hello',
      client: 'doubao-browser-poc',
      characterKey: expected.key,
    });

    firstSocket.close(1000, 'local test complete');
    await wait();
    await context.__micTest.connectRelay();
    assert.equal(sockets.length, 2);
    const secondSocket = sockets[1];
    assert.notEqual(secondSocket, firstSocket);
    secondSocket.readyState = FakeWebSocket.OPEN;
    secondSocket.emit('message', {
      data: JSON.stringify({
        type: 'relay.ready',
        version: 'local-fake',
      }),
    });
    assert.deepEqual(secondSocket.sent[0], {
      type: 'browser.hello',
      client: 'doubao-browser-poc',
      characterKey: expected.key,
    });
  }
}

async function verifyHomeConfigurationAndPreloading() {
  const runtime = loadHomeRuntime();
  assert.deepEqual(
    Array.from(runtime.test.characters, (character) => character.key),
    UI_MATRIX.map((character) => character.key)
  );
  for (const expected of UI_MATRIX) {
    const actual = runtime.test.characters.find(
      (character) => character.key === expected.key
    );
    assert.equal(actual.name, expected.name);
    assert.equal(actual.imageSrc, expected.homeImage);
    assert.equal(actual.motto, expected.motto);
    assert.equal(actual.voiceReady, true);
    assert.equal(actual.realtimeCharacterKey, expected.key);
    assert.equal(
      runtime.test.REALTIME_URLS_BY_CHARACTER_KEY[expected.key],
      expected.key === 'yuhuang'
        ? CALL_URL
        : `${CALL_URL}?characterKey=${expected.key}`
    );
  }

  runtime.test.warmAdjacentCharacterImages('yuhuang');
  await wait();
  assert.deepEqual(
    new Set(runtime.imageRequests),
    new Set([
      UI_MATRIX[1].homeImage,
      UI_MATRIX[7].homeImage,
    ])
  );
  assert.equal(runtime.imageRequests.length, 2);

  const targetRuntime = loadHomeRuntime();
  assert.equal(
    await targetRuntime.test.selectCharacter('rulai', 'character-panel'),
    true
  );
  await wait();
  assert.equal(targetRuntime.test.getCurrentCharacterKey(), 'rulai');
  assert.deepEqual(
    new Set(targetRuntime.imageRequests),
    new Set([
      UI_MATRIX[3].homeImage,
      UI_MATRIX[4].homeImage,
      UI_MATRIX[5].homeImage,
    ])
  );
}

async function verifySwipeAndImageSafety() {
  const shortSwipe = loadHomeRuntime();
  shortSwipe.test.handleCharacterPointerDown(
    pointerEvent(shortSwipe.characterStage, 1, 100, 100)
  );
  shortSwipe.test.handleCharacterPointerUp(
    pointerEvent(shortSwipe.characterStage, 1, 61, 100)
  );
  await wait();
  assert.equal(shortSwipe.test.getCurrentCharacterKey(), 'yuhuang');

  const validSwipe = loadHomeRuntime();
  validSwipe.test.handleCharacterPointerDown(
    pointerEvent(validSwipe.characterStage, 2, 100, 100)
  );
  validSwipe.test.handleCharacterPointerUp(
    pointerEvent(validSwipe.characterStage, 2, 59, 100)
  );
  await wait(5);
  assert.equal(validSwipe.test.getCurrentCharacterKey(), 'sunwukong');

  const verticalSwipe = loadHomeRuntime();
  verticalSwipe.test.handleCharacterPointerDown(
    pointerEvent(verticalSwipe.characterStage, 3, 100, 100)
  );
  verticalSwipe.test.handleCharacterPointerUp(
    pointerEvent(verticalSwipe.characterStage, 3, 59, 180)
  );
  await wait();
  assert.equal(verticalSwipe.test.getCurrentCharacterKey(), 'yuhuang');

  const overlaySwipe = loadHomeRuntime();
  const overlay = new FakeElement();
  overlaySwipe.test.openOverlay(overlay);
  overlaySwipe.test.handleCharacterPointerDown(
    pointerEvent(overlaySwipe.characterStage, 4, 100, 100)
  );
  overlaySwipe.test.handleCharacterPointerUp(
    pointerEvent(overlaySwipe.characterStage, 4, 40, 100)
  );
  await wait();
  assert.equal(overlaySwipe.test.getCurrentCharacterKey(), 'yuhuang');

  const failedImage = loadHomeRuntime({
    failedImages: new Set([UI_MATRIX[1].homeImage]),
  });
  assert.equal(
    await failedImage.test.selectCharacter('sunwukong', 'swipe-left'),
    false
  );
  assert.equal(failedImage.test.getCurrentCharacterKey(), 'yuhuang');

  const race = loadHomeRuntime({
    imageDelays: {
      [UI_MATRIX[2].homeImage]: 20,
      [UI_MATRIX[3].homeImage]: 0,
    },
  });
  const firstSelection = race.test.selectCharacter(
    'guanyin',
    'character-panel'
  );
  const secondSelection = race.test.selectCharacter(
    'caishen',
    'character-panel'
  );
  await Promise.all([firstSelection, secondSelection]);
  assert.equal(race.test.getCurrentCharacterKey(), 'caishen');
}

async function verifyCallPagesAndRestart() {
  for (const expected of UI_MATRIX) {
    const runtime = createCallRuntime(
      expected.key === 'yuhuang' ? null : expected.key
    );
    const pageShell = runtime.selectors['.page-shell'];
    const image = runtime.selectors['[data-call-character-image]'];
    const heading = runtime.selectors['[data-call-character-heading]'];
    const location = runtime.selectors['[data-call-character-location]'];
    const name = runtime.selectors['[data-call-character-name]'];
    const motto = runtime.selectors['[data-call-character-motto]'];
    const controls = runtime.selectors['[data-call-character-controls]'];
    const status = runtime.ids.callStatusText;
    const button = runtime.ids.callPrimaryButton;

    assert.equal(runtime.document.title, `${expected.name} · 实时通话`);
    assert.equal(
      runtime.ids.callReturnButton.attributes.get('href'),
      DEFAULT_HOME_URL
    );
    assert.equal(
      runtime.ids.callIdentityEntry.attributes.get('href'),
      DEFAULT_IDENTITY_ENTRY_URL
    );
    assert.equal(pageShell.dataset.callCharacterKey, expected.key);
    assert.equal(
      pageShell.attributes.get('aria-label'),
      `${expected.name}实时通话页面`
    );
    assert.equal(image.src, expected.callImage);
    assert.ok(image.alt.length > 0);
    assert.equal(
      heading.attributes.get('aria-label'),
      `${expected.name}角色信息`
    );
    assert.equal(location.textContent, expected.location);
    assert.equal(name.textContent, expected.name);
    assert.equal(motto.textContent, expected.motto);
    assert.equal(
      controls.attributes.get('aria-label'),
      `与${expected.name}实时通话控制`
    );
    assert.equal(status.textContent, expected.idle);
    assert.equal(runtime.subscriptions.length, 1);

    button.click();
    await wait();
    assert.equal(runtime.apiCounts.connect, 1);
    assert.equal(runtime.apiCounts.warmupPlayback, 1);
    assert.equal(runtime.apiCounts.startAudio, 1);

    const emit = runtime.subscriptions[0];
    emit({
      callId: 1,
      detail: {},
      state: 'session-ready',
    });
    assert.equal(status.textContent, expected.connected);
    emit({
      callId: 1,
      detail: {},
      state: 'audio-active',
    });
    assert.equal(status.textContent, expected.listening);
    emit({
      callId: 1,
      detail: {
        userSpeaking: true,
      },
      state: 'listening',
    });
    assert.equal(status.textContent, expected.userSpeaking);
    emit({
      callId: 1,
      detail: {},
      state: 'waiting-response',
    });
    assert.equal(status.textContent, expected.thinking);
    emit({
      callId: 1,
      detail: {},
      state: 'assistant-speaking',
    });
    assert.equal(status.textContent, expected.speaking);

    button.click();
    await wait();
    assert.equal(runtime.apiCounts.disconnect, 1);
    assert.equal(button.textContent, '重新通话');
    assert.equal(status.textContent, '本次通话已结束');

    button.click();
    await wait();
    assert.equal(runtime.apiCounts.connect, 2);
    assert.equal(pageShell.dataset.callCharacterKey, expected.key);
  }
}

async function verifyReturnUrlNavigation() {
  const incorrectRootRelativeUrl = new URL(
    HOME_PATH,
    'http://127.0.0.1:3001/'
  );
  assert.equal(incorrectRootRelativeUrl.port, '3001');
  assert.equal(
    incorrectRootRelativeUrl.pathname,
    HOME_PATH
  );

  for (const expected of [
    {
      homePageUrl:
        'http://127.0.0.1:8765/ui_prototypes/yuhuang_mobile_v1/home.html',
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '8765',
    },
    {
      homePageUrl:
        'http://127.0.0.1:18765/ui_prototypes/yuhuang_mobile_v1/home.html',
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '18765',
    },
    {
      homePageUrl:
        'https://example.com/ui_prototypes/yuhuang_mobile_v1/home.html',
      protocol: 'https:',
      hostname: 'example.com',
      port: '',
    },
  ]) {
    const runtime = loadHomeRuntime({
      homePageUrl: expected.homePageUrl,
    });
    const callUrl = new URL(runtime.test.buildRealtimeNavigationUrl(
      `${CALL_URL}?characterKey=sunwukong&debug=1`
    ));
    const returnUrl = new URL(callUrl.searchParams.get('returnUrl'));
    assert.equal(callUrl.searchParams.get('characterKey'), 'sunwukong');
    assert.equal(callUrl.searchParams.get('debug'), '1');
    assert.equal(returnUrl.protocol, expected.protocol);
    assert.equal(returnUrl.hostname, expected.hostname);
    assert.equal(returnUrl.port, expected.port);
    assert.equal(returnUrl.pathname, HOME_PATH);
  }

  const homeRuntime = loadHomeRuntime({
    homePageUrl:
      'http://127.0.0.1:18765/ui_prototypes/yuhuang_mobile_v1/home.html',
  });
  assert.equal(
    await homeRuntime.test.selectCharacter('guanyin', 'swipe-left'),
    true
  );
  homeRuntime.test.handleStartConversation();
  const assignedCallUrl = new URL(
    homeRuntime.locationAssignments.at(-1)
  );
  assert.equal(assignedCallUrl.port, '3001');
  assert.equal(assignedCallUrl.searchParams.get('characterKey'), 'guanyin');
  assert.equal(
    new URL(assignedCallUrl.searchParams.get('returnUrl')).port,
    '18765'
  );

  const validCallRuntime = createCallRuntime('sunwukong', {
    callPageUrl: 'http://127.0.0.1:3001/',
    returnUrl:
      'http://127.0.0.1:18765/ui_prototypes/yuhuang_mobile_v1/home.html',
  });
  const validatedHomeUrl = new URL(
    validCallRuntime.ids.callReturnButton.attributes.get('href')
  );
  assert.equal(validatedHomeUrl.port, '18765');
  assert.notEqual(validatedHomeUrl.port, '3001');
  assert.equal(validatedHomeUrl.pathname, HOME_PATH);
  const identityEntryUrl = new URL(
    validCallRuntime.ids.callIdentityEntry.attributes.get('href')
  );
  assert.equal(identityEntryUrl.origin, validatedHomeUrl.origin);
  assert.equal(identityEntryUrl.pathname, IDENTITY_ENTRY_PATH);
  assert.equal(
    validCallRuntime.ids.callReturnButton.attributes.has('aria-disabled'),
    false
  );
  assert.equal(
    validCallRuntime.ids.callReturnButton.attributes.has('tabindex'),
    false
  );
  assert.equal(
    validCallRuntime.ids.callIdentityEntry.attributes.has('aria-disabled'),
    false
  );
  assert.equal(
    validCallRuntime.ids.callIdentityEntry.attributes.has('tabindex'),
    false
  );

  validCallRuntime.ids.callPrimaryButton.click();
  await wait();
  validCallRuntime.ids.callReturnButton.click();
  await wait();
  assert.equal(
    validCallRuntime.locationAssignments.at(-1),
    validatedHomeUrl.href
  );

  const secureCallRuntime = createCallRuntime(null, {
    callPageUrl: 'https://example.com/',
    returnUrl:
      'https://example.com/ui_prototypes/yuhuang_mobile_v1/home.html',
  });
  const secureHomeUrl = new URL(
    secureCallRuntime.ids.callReturnButton.attributes.get('href')
  );
  assert.equal(secureHomeUrl.protocol, 'https:');
  assert.equal(secureHomeUrl.hostname, 'example.com');

  const invalidReturnUrls = [
    'https://evil.example/ui_prototypes/yuhuang_mobile_v1/home.html',
    'javascript:alert(1)',
    'data:text/html,invalid',
    'file:///ui_prototypes/yuhuang_mobile_v1/home.html',
    'http://user:password@127.0.0.1:18765'
      + '/ui_prototypes/yuhuang_mobile_v1/home.html',
    'http://127.0.0.1:18765/not-the-home-page.html',
    'http://127.0.0.1:18765'
      + '/ui_prototypes/yuhuang_mobile_v1/home.html?source=call',
    'http://127.0.0.1:18765'
      + '/ui_prototypes/yuhuang_mobile_v1/home.html#account',
    'not a valid URL',
  ];
  for (const returnUrl of invalidReturnUrls) {
    const runtime = createCallRuntime(null, { returnUrl });
    assert.equal(
      runtime.ids.callReturnButton.attributes.has('href'),
      false
    );
    assert.equal(
      runtime.ids.callIdentityEntry.attributes.has('href'),
      false
    );
    assert.equal(
      runtime.ids.callReturnButton.attributes.get('aria-disabled'),
      'true'
    );
    assert.equal(
      runtime.ids.callIdentityEntry.attributes.get('aria-disabled'),
      'true'
    );
    assert.equal(
      runtime.ids.callReturnButton.attributes.get('tabindex'),
      '-1'
    );
    assert.equal(
      runtime.ids.callIdentityEntry.attributes.get('tabindex'),
      '-1'
    );
    assert.equal(
      runtime.ids.callStatusText.textContent,
      '无法确定首页地址，请从首页重新进入通话'
    );
    runtime.ids.callReturnButton.click();
    runtime.ids.callIdentityEntry.click();
    assert.equal(runtime.locationAssignments.length, 0);
  }

  const missingReturnUrlRuntime = createCallRuntime(null, {
    returnUrl: null,
  });
  assert.equal(
    missingReturnUrlRuntime.ids.callReturnButton.attributes.has('href'),
    false
  );
  assert.equal(
    missingReturnUrlRuntime.ids.callStatusText.textContent,
    '无法确定首页地址，请从首页重新进入通话'
  );

  const referrerRuntime = createCallRuntime(null, {
    referrer:
      'http://127.0.0.1:18765/ui_prototypes/yuhuang_mobile_v1/home.html',
    returnUrl: null,
  });
  assert.equal(
    new URL(
      referrerRuntime.ids.callReturnButton.attributes.get('href')
    ).port,
    '18765'
  );

  const missingApiRuntime = createCallRuntime('sunwukong', {
    callPageUrl: 'http://127.0.0.1:3001/',
    realtimeApiAvailable: false,
    returnUrl:
      'http://127.0.0.1:18765/ui_prototypes/yuhuang_mobile_v1/home.html',
  });
  assert.equal(
    missingApiRuntime.ids.callReturnButton.attributes.get('href'),
    'http://127.0.0.1:18765'
      + '/ui_prototypes/yuhuang_mobile_v1/home.html'
  );
  assert.equal(
    missingApiRuntime.ids.callIdentityEntry.attributes.get('href'),
    'http://127.0.0.1:18765'
      + '/ui_prototypes/yuhuang_mobile_v1/index.html'
  );
  assert.equal(missingApiRuntime.ids.callPrimaryButton.disabled, true);
  assert.equal(
    missingApiRuntime.ids.callStatusText.textContent,
    '通话组件加载失败，可返回首页后重新进入'
  );
  assert.equal(missingApiRuntime.subscriptions.length, 0);
  assert.deepEqual(missingApiRuntime.apiCounts, {
    connect: 0,
    disconnect: 0,
    startAudio: 0,
    warmupPlayback: 0,
  });
}

function verifyUnavailableCharacters() {
  for (const characterKey of [
    '',
    'GUANYIN',
    'guanyin2',
    'constructor',
    '__proto__',
  ]) {
    const runtime = createCallRuntime(characterKey);
    assert.equal(runtime.document.title, '角色不可用 · 实时通话');
    assert.equal(
      runtime.selectors['[data-call-character-name]'].textContent,
      '角色不可用'
    );
    assert.equal(runtime.ids.callPrimaryButton.disabled, true);
    assert.equal(runtime.subscriptions.length, 0);
  }
}

function createAuthState(mode) {
  return JSON.stringify(mode === 'phone'
    ? {
      version: 1,
      mode: 'phone',
      authenticated: true,
      phoneMasked: '138****1234',
      createdAt: 1721779200000,
    }
    : {
      version: 1,
      mode: 'guest',
      authenticated: false,
      phoneMasked: '',
      createdAt: 1721779200000,
    });
}

function verifyAuthGateAndRechargeRegression() {
  const authKey = 'companion_auth_state_v1';
  const guestRuntime = loadHomeRuntime({
    storageEntries: {
      [authKey]: createAuthState('guest'),
    },
  });
  assert.equal(guestRuntime.test.getPrototypeCreditBalance(), 12.50);
  assert.equal(guestRuntime.test.handleRechargeConfirmation(), false);
  assert.equal(guestRuntime.test.getPrototypeCreditBalance(), 12.50);
  assert.equal(
    guestRuntime.test.getActiveOverlay(),
    guestRuntime.rechargeLoginOverlay
  );
  assert.equal(guestRuntime.rechargePanel.hidden, true);

  const phoneRuntime = loadHomeRuntime({
    storageEntries: {
      [authKey]: createAuthState('phone'),
    },
  });
  assert.equal(phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getPrototypeCreditBalance(), 22.50);

  const twentyYuan = new FakeElement();
  twentyYuan.dataset.packageMode = 'preset';
  twentyYuan.dataset.packageValue = '20';
  phoneRuntime.test.handlePackageSelection({
    currentTarget: twentyYuan,
  });
  assert.equal(phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getPrototypeCreditBalance(), 42.50);

  const customAmount = new FakeElement();
  customAmount.dataset.packageMode = 'custom';
  phoneRuntime.customAmountInput.value = '7.25';
  phoneRuntime.test.handlePackageSelection({
    currentTarget: customAmount,
  });
  assert.equal(phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getPrototypeCreditBalance(), 49.75);

  const alipay = new FakeElement();
  alipay.dataset.paymentMethod = 'alipay';
  alipay.dataset.paymentName = '支付宝支付';
  phoneRuntime.test.handlePaymentSelection({
    currentTarget: alipay,
  });
  assert.equal(phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getPrototypeCreditBalance(), 57);

  const refreshedRuntime = loadHomeRuntime({
    storageEntries: {
      [authKey]: createAuthState('phone'),
    },
  });
  assert.equal(refreshedRuntime.test.getPrototypeCreditBalance(), 12.50);
}

function verifyStaticSafetyAndCurrentUi() {
  const homeHtml = fs.readFileSync(HOME_HTML_PATH, 'utf8');
  const homeJs = fs.readFileSync(HOME_JS_PATH, 'utf8');
  const authHtml = fs.readFileSync(AUTH_HTML_PATH, 'utf8');
  const authJs = fs.readFileSync(AUTH_JS_PATH, 'utf8');
  const callHtml = fs.readFileSync(CALL_HTML_PATH, 'utf8');
  const callJs = fs.readFileSync(CALL_JS_PATH, 'utf8');
  const micJs = fs.readFileSync(MIC_JS_PATH, 'utf8');

  assert.doesNotMatch(homeHtml, /character-switch|character-picker|role-list|role-card/);
  assert.doesNotMatch(homeJs, /renderCharacterOptions|handleCharacterOptionClick|character-panel|pickerText/);
  assert.match(homeHtml, /左右滑动切换角色/);
  assert.match(homeHtml, /当前第 <span data-current-role-position>1 \/ 8<\/span> 位角色/);
  assert.match(homeJs, /handleCharacterPointerDown/);
  assert.match(homeJs, /handleCharacterPointerUp/);
  assert.doesNotMatch(homeJs, /innerHTML/);
  assert.match(homeJs, /new Set\(\[/);
  assert.doesNotMatch(homeJs, /function warmCharacterImages/);

  assert.match(homeJs, /function buildRealtimeNavigationUrl\(/);
  assert.match(callJs, /function resolveReturnHomeUrl\(/);
  assert.match(callJs, /function validateReturnHomeUrl\(/);
  assert.match(callHtml, /id="callReturnButton"/);
  assert.match(callHtml, /data-return-navigation/);
  assert.match(callHtml, /id="callIdentityEntry"/);
  assert.match(
    callHtml,
    /id="callReturnButton"[\s\S]{0,240}aria-disabled="true"[\s\S]{0,80}tabindex="-1"/
  );
  assert.match(
    callHtml,
    /id="callIdentityEntry"[\s\S]{0,240}aria-disabled="true"[\s\S]{0,80}tabindex="-1"/
  );
  assert.match(
    callHtml,
    /<noscript>[\s\S]*?<p role="alert">[\s\S]*?此通话页面需要启用 JavaScript，请返回首页后重新进入。[\s\S]*?<\/noscript>/
  );
  assert.doesNotMatch(
    callHtml,
    /href="\/ui_prototypes\/yuhuang_mobile_v1\/(?:home|index)\.html"/
  );
  assert.doesNotMatch(
    `${homeJs}\n${callHtml}\n${callJs}`,
    /(?:127\.0\.0\.1|localhost):(?:8765|18765)/
  );
  assert.match(
    micJs,
    /characterKey: resolveRequestedCharacterKey\(\)/
  );
  assert.match(
    micJs,
    /return searchParams\.has\('characterKey'\)[\s\S]*searchParams\.get\('characterKey'\)/
  );

  assert.match(authHtml, /class="phone-auth-form"/);
  assert.match(authHtml, /以游客身份进入/);
  assert.match(authJs, /const AUTH_STORAGE_KEY = 'companion_auth_state_v1'/);
  assert.match(authJs, /const DEMO_CODE = '123456'/);
  assert.match(homeJs, /function getValidatedAuthState\(\)/);
  assert.match(homeJs, /function isPhoneAuthenticated\(/);
  assert.match(homeJs, /function renderAccountSummary\(/);
  assert.match(homeJs, /function renderAccountProfile\(/);
  assert.match(homeJs, /function handleRechargeConfirmation\(\) \{[\s\S]*?getValidatedAuthState\(\)/);
  assert.match(homeJs, /window\.location\.assign\('\.\/index\.html'\)/);
  assert.match(homeHtml, /class="account-summary-button"/);
  assert.match(homeHtml, /class="account-profile-overlay prototype-overlay"/);
  assert.match(homeHtml, /class="recharge-login-overlay prototype-overlay"/);
  assert.match(homeJs, /let prototypeCreditBalance = 12\.50;/);
  assert.match(homeHtml, /data-package-value="10"/);
  assert.match(homeHtml, /data-package-value="20"/);
  assert.match(homeHtml, /data-package-value="50"/);
  assert.match(homeHtml, /data-package-mode="custom"/);
  assert.match(homeHtml, /data-payment-method="wechat"/);
  assert.match(homeHtml, /data-payment-method="alipay"/);
}

async function main() {
  verifyStaticSafetyAndCurrentUi();
  verifyAuthGateAndRechargeRegression();
  await verifyHomeConfigurationAndPreloading();
  await verifySwipeAndImageSafety();
  await verifyCallPagesAndRestart();
  await verifyReturnUrlNavigation();
  await verifyMicReconnectCharacterKey();
  verifyUnavailableCharacters();

  process.stdout.write('eight_character_ui_matrix_test: PASS\n');
  process.stdout.write(`roles=${UI_MATRIX.map((role) => role.key).join(',')}\n`);
  process.stdout.write(
    'verified=auth-entry,home-guard,account-profile,recharge-gate,'
      + 'swipe-only,trusted-urls,adjacent-preload,39px,41px,'
      + 'vertical-swipe,overlay-lock,image-failure,race-safety,call-states,'
      + 'ended,restart,return-url-navigation,new-websocket,current-character-hello,'
      + 'unavailable-keys,fixed-custom-wechat-alipay-refresh-balance\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
