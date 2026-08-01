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
const CHOICE_HTML_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/choice.html'
);
const CHOICE_CSS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/choice-poster.css'
);
const CHOICE_UNIFIED_POSTER_ASSET_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/assets/choice/choice-poster-unified-v2.png'
);
const FORTUNE_HTML_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune.html'
);
const FORTUNE_JS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune.js'
);
const DAOTONG_ASSET_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/assets/fortune/daotong-guide-v1.png'
);
const ENTRY_CSS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/entry.css'
);
const HOME_CSS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/ui.css'
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
const INVALID_BUSINESS_CALL_ID_MESSAGE =
  '通话信息无效，请返回首页重新进入。';
let businessCallIdScenarioCount = 0;

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
const ROLE_PRICE_PER_MINUTE_FEN = Object.freeze([
  100,
  90,
  110,
  130,
  150,
  80,
  60,
  70,
]);

function createRoleCatalogResponse(
  prices = ROLE_PRICE_PER_MINUTE_FEN
) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        roles: UI_MATRIX.map((role, index) => ({
          slug: role.key,
          displayName: role.name,
          available: true,
          pricing: {
            currency: 'CNY',
            billingUnitSeconds: 6,
            pricePerMinuteFen: prices[index],
          },
        })),
      };
    },
  };
}

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
    this.focused = false;
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
    this.parentOverlay = null;
    this.queryMap = new Map();
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

  closest(selector) {
    return selector === '.prototype-overlay'
      ? this.parentOverlay
      : null;
  }

  focus() {
    this.focused = true;
  }

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

  querySelector(selector) {
    return this.queryMap.get(selector) || null;
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
      buildRegisteredRealtimeNavigationUrl,
      buildRealtimeNavigationUrl,
      characters,
      closeOverlay,
      formatBalanceCents,
      getActiveOverlay: () => activeOverlay,
      getAccountBalanceCents: () => accountBalanceCents,
      getCurrentCharacterKey: () => currentCharacterKey,
      getIsStartingCall: () => isStartingCall,
      getRoleCatalogLoadPromise: () => roleCatalogLoadPromise,
      getRoleCatalogState: () => roleCatalogState,
      getRolePricingByKey: () => rolePricingByKey,
      getValidatedAuthState,
      handleCharacterPointerDown,
      handleCharacterPointerUp,
      handlePackageSelection,
      handlePaymentSelection,
      handleRechargeConfirmation,
      handleEscapeKey,
      handleHomePageShow,
      handleOverlayBackdropClick,
      handleStartConversation,
      initializeUi,
      loadAccountState,
      loadPublicRoleCatalog,
      openCurrentRolePricing,
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
  const rechargeConfirmButton = new FakeElement();
  const rolePricingTrigger = new FakeElement();
  const rolePricingOverlay = new FakeElement();
  rolePricingOverlay.hidden = true;
  rolePricingOverlay.setAttribute('aria-hidden', 'true');
  const rolePricingName = new FakeElement();
  const rolePricingMinutePrice = new FakeElement();
  const rolePricingUnitSeconds = new FakeElement();
  const rolePricingRoundingSeconds = new FakeElement();
  const rolePricingRoundingSecondsCopy = new FakeElement();
  const rolePricingAcknowledgement = new FakeElement();
  rolePricingAcknowledgement.parentOverlay = rolePricingOverlay;
  rolePricingOverlay.queryMap.set(
    '[data-dialog-initial-focus], [data-close-overlay], button',
    rolePricingAcknowledgement
  );
  const customAmountField = new FakeElement();
  const customAmountInput = new FakeElement();
  const customAmountError = new FakeElement();
  const creditDisplay = new FakeElement();
  const callButton = new FakeElement();
  const callButtonLabel = new FakeElement();
  const callActionLabel = new FakeElement();
  const toast = new FakeElement();
  const packageButtons = [];
  const paymentButtons = [];
  const locationAssignments = [];
  const localStorage = createLocalStorage(options.storageEntries);
  const fetchRequests = [];
  const fetchImpl = options.fetchImpl || (async (pathname) => {
    if (pathname === '/api/me') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            account: {
              currency: 'CNY',
              balanceCents: 1250,
              remainingSeconds: 0,
            },
          };
        },
      };
    }
    if (pathname === '/api/roles') {
      return createRoleCatalogResponse();
    }
    if (pathname === '/api/dev/recharge') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            account: {
              currency: 'CNY',
              balanceCents: 2250,
              remainingSeconds: 0,
            },
          };
        },
      };
    }
    return {
      ok: true,
      status: 201,
      async json() {
        return {
          call: {
            id: 'call-ui-matrix',
          },
        };
      },
    };
  });
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

  const documentHandlers = new Map();
  const windowHandlers = new Map();
  const document = {
    addEventListener(eventName, handler) {
      if (!documentHandlers.has(eventName)) {
        documentHandlers.set(eventName, []);
      }
      documentHandlers.get(eventName).push(handler);
    },
    body: {
      classList: new FakeClassList(),
      dataset: {},
    },
    querySelector(selector) {
      const elements = {
        '.character-stage': characterStage,
        '.call-button': callButton,
        '.call-button-label': callButtonLabel,
        '.custom-amount-error': customAmountError,
        '.custom-amount-field': customAmountField,
        '.custom-amount-input': customAmountInput,
        '.recharge-login-overlay': rechargeLoginOverlay,
        '.recharge-panel': rechargePanel,
        '.recharge-confirm': rechargeConfirmButton,
        '.recharge-result': rechargeResult,
        '.recharge-selection-summary': rechargeSelectionSummary,
        '.role-pricing-overlay': rolePricingOverlay,
        '.role-pricing-trigger': rolePricingTrigger,
        '.time-recharge-entry': rechargeEntry,
        '.ui-toast': toast,
        '[data-call-action-label]': callActionLabel,
        '[data-role-pricing-minute-price]':
          rolePricingMinutePrice,
        '[data-role-pricing-name]': rolePricingName,
        '[data-role-pricing-rounding-seconds]':
          rolePricingRoundingSeconds,
        '[data-role-pricing-rounding-seconds-copy]':
          rolePricingRoundingSecondsCopy,
        '[data-role-pricing-unit-seconds]':
          rolePricingUnitSeconds,
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
      if (selector === '.prototype-overlay') {
        return [
          rolePricingOverlay,
          rechargePanel,
          rechargeLoginOverlay,
        ];
      }
      if (selector === '[data-close-overlay]') {
        return [rolePricingAcknowledgement];
      }
      return [];
    },
    dispatch(eventName, overrides = {}) {
      const event = {
        key: '',
        preventDefault() {},
        ...overrides,
      };
      for (const handler of documentHandlers.get(eventName) || []) {
        handler(event);
      }
    },
    title: '',
  };
  const window = {
    addEventListener(eventName, handler) {
      if (!windowHandlers.has(eventName)) {
        windowHandlers.set(eventName, []);
      }
      windowHandlers.get(eventName).push(handler);
    },
    clearTimeout,
    fetch(pathname, requestOptions) {
      fetchRequests.push({ pathname, requestOptions });
      return fetchImpl(pathname, requestOptions);
    },
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
    getListenerCount(eventName) {
      return (windowHandlers.get(eventName) || []).length;
    },
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
    callActionLabel,
    callButton,
    callButtonLabel,
    creditDisplay,
    fetchRequests,
    imageRequests,
    localStorage,
    locationAssignments,
    rechargeLoginOverlay,
    rechargePanel,
    rolePricingMinutePrice,
    rolePricingName,
    rolePricingAcknowledgement,
    rolePricingOverlay,
    rolePricingRoundingSeconds,
    rolePricingRoundingSecondsCopy,
    rolePricingTrigger,
    rolePricingUnitSeconds,
    toast,
    customAmountInput,
    test: context.__homeTest,
    document,
    window,
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
      + `globalThis.__micTest = {
        connectRelay,
        setActiveProductCallId(callId) {
          activeProductCallId = callId;
        },
      };`
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
    const pageUrl = new URL(search, CALL_URL);
    const window = {
      addEventListener() {},
      clearTimeout,
      location: {
        href: pageUrl.href,
        search,
      },
      setTimeout,
    };
    const context = {
      AudioContext: class {},
      Blob,
      Element: FakeElement,
      Int16Array,
      URL,
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
    assert.equal(
      Object.prototype.hasOwnProperty.call(firstSocket.sent[0], 'callId'),
      false
    );
    businessCallIdScenarioCount += 1;

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
    assert.equal(
      Object.prototype.hasOwnProperty.call(secondSocket.sent[0], 'callId'),
      false
    );
    businessCallIdScenarioCount += 1;

    secondSocket.close(1000, 'local test complete');
    await wait();

    if (expected.key === 'yuhuang' || expected.key === 'sunwukong') {
      const businessCallId = expected.key === 'yuhuang'
        ? 'call-123'
        : 'call-业务/片?%';
      const businessSearch = expected.key === 'yuhuang'
        ? '?callId=call-123'
        : '?characterKey=sunwukong'
          + '&callId=call-%E4%B8%9A%E5%8A%A1%2F%E7%89%87%3F%25';
      const businessPageUrl = new URL(businessSearch, CALL_URL);
      window.location.href = businessPageUrl.href;
      window.location.search = businessPageUrl.search;
      const localCallId = 37;
      context.__micTest.setActiveProductCallId(localCallId);
      const result = await context.__micTest.connectRelay({
        callId: localCallId,
      });
      assert.equal(result.status, 'created');
      assert.equal(result.callId, localCallId);
      assert.equal(sockets.length, 3);
      const businessSocket = sockets[2];
      businessSocket.readyState = FakeWebSocket.OPEN;
      businessSocket.emit('message', {
        data: JSON.stringify({
          type: 'relay.ready',
          version: 'local-fake',
        }),
      });
      assert.deepEqual(businessSocket.sent[0], {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: expected.key,
        callId: businessCallId,
      });
      assert.notEqual(businessSocket.sent[0].callId, localCallId);
      businessCallIdScenarioCount += 1;

      if (expected.key === 'yuhuang') {
        const invalidActiveUrl = new URL(CALL_URL);
        const invalidActiveCallId = 'bad\u0085id';
        invalidActiveUrl.searchParams.set('callId', invalidActiveCallId);
        window.location.href = invalidActiveUrl.href;
        window.location.search = invalidActiveUrl.search;
        const socketCountBefore = sockets.length;
        const sentCountBefore = businessSocket.sent.length;
        const turnStateBefore = elements.get('turnState').textContent;
        const snapshotBefore = window.DoubaoRealtimeCall.getSnapshot();
        const activeResult = await context.__micTest.connectRelay({
          callId: localCallId,
        });
        businessCallIdScenarioCount += 1;
        assert.equal(activeResult.status, 'already-active');
        assert.equal(activeResult.socket, businessSocket);
        assert.equal(activeResult.callId, localCallId);
        assert.equal(sockets.length, socketCountBefore);
        assert.equal(businessSocket.sent.length, sentCountBefore);
        assert.equal(
          elements.get('turnState').textContent,
          turnStateBefore
        );
        assert.equal(
          window.DoubaoRealtimeCall.getSnapshot(),
          snapshotBefore
        );
        assert.equal(
          elements.get('logOutput').textContent.includes(
            invalidActiveCallId
          ),
          false
        );
      }

      businessSocket.close(1000, 'local business call test complete');
      await wait();
      continue;
    }

    const c1InvalidCallIds = [
      `bad${String.fromCharCode(0x80)}id`,
      `bad${String.fromCharCode(0x85)}id`,
      `bad${String.fromCharCode(0x9f)}id`,
    ];
    const invalidSearches = {
      guanyin: [{
        search: '?characterKey=guanyin&callId=call-A&callId=call-B',
        unsafeFragments: ['call-A', 'call-B'],
      }],
      caishen: [{
        search: '?characterKey=caishen&callId=',
        unsafeFragments: [],
      }],
      rulai: [{
        search: '?characterKey=rulai&callId=%20%20',
        unsafeFragments: [],
      }],
      zhubajie: [
        {
          search: '?characterKey=zhubajie&callId=%20abc',
          unsafeFragments: ['abc'],
        },
        {
          search: '?characterKey=zhubajie&callId=abc%20',
          unsafeFragments: ['abc'],
        },
      ],
      shawujing: [{
        search: `?characterKey=shawujing&callId=${'x'.repeat(129)}`,
        unsafeFragments: ['x'.repeat(129)],
      }],
      tangseng: [
        {
          search: '?characterKey=tangseng&callId=bad%00id',
          unsafeFragments: ['bad', 'id'],
        },
        {
          search: '?characterKey=tangseng&callId=bad%1Fid',
          unsafeFragments: ['bad', 'id'],
        },
        {
          search: '?characterKey=tangseng&callId=bad%7Fid',
          unsafeFragments: ['bad', 'id'],
        },
        ...c1InvalidCallIds.map((callId) => ({
          callId,
          unsafeFragments: [callId],
        })),
      ],
    };

    for (const scenario of invalidSearches[expected.key]) {
      const invalidPageUrl = scenario.callId === undefined
        ? new URL(scenario.search, CALL_URL)
        : new URL(CALL_URL);
      if (scenario.callId !== undefined) {
        invalidPageUrl.searchParams.set('characterKey', expected.key);
        invalidPageUrl.searchParams.set('callId', scenario.callId);
      }
      window.location.href = invalidPageUrl.href;
      window.location.search = invalidPageUrl.search;
      const socketCountBefore = sockets.length;
      const result = await context.__micTest.connectRelay();
      businessCallIdScenarioCount += 1;
      assert.equal(result.status, 'invalid-business-call-id');
      assert.equal(result.socket, null);
      assert.equal(result.message, INVALID_BUSINESS_CALL_ID_MESSAGE);
      assert.equal(sockets.length, socketCountBefore);
      assert.equal(
        elements.get('turnState').textContent,
        `当前对话：${INVALID_BUSINESS_CALL_ID_MESSAGE}`
      );
      assert.ok(
        elements.get('logOutput').textContent.includes(
          INVALID_BUSINESS_CALL_ID_MESSAGE
        )
      );
      for (const unsafeFragment of scenario.unsafeFragments) {
        assert.equal(
          elements.get('logOutput').textContent.includes(unsafeFragment),
          false
        );
      }
    }
  }
}

function verifyBrowserLifecycleBoundary() {
  const browserSource = fs.readFileSync(MIC_JS_PATH, 'utf8');
  const forbiddenPatterns = [
    /internal_call_lifecycle_client/,
    /relay_internal_call_lifecycle_bootstrap/,
    /\bmarkConnecting\s*\(/,
    /\bmarkActive\s*\(/,
    /\bmarkEnded\s*\(/,
    /\bmarkFailed\s*\(/,
    /\bBUSINESS_INTERNAL_API_TOKEN\b/,
    /\bBUSINESS_BACKEND_INTERNAL_BASE_URL\b/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(browserSource, pattern);
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
    storageEntries: {
      companion_auth_state_v1: createAuthState('guest'),
    },
  });
  assert.equal(
    await homeRuntime.test.selectCharacter('guanyin', 'swipe-left'),
    true
  );
  await homeRuntime.test.handleStartConversation();
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

async function verifyRolePricingDetails() {
  const initializedRuntime = loadHomeRuntime({
    storageEntries: {
      companion_auth_state_v1: createAuthState('guest'),
    },
  });
  initializedRuntime.test.initializeUi();
  assert.equal(
    await initializedRuntime.test.getRoleCatalogLoadPromise(),
    true
  );
  assert.equal(
    (initializedRuntime.rolePricingTrigger.handlers.get('click') || [])
      .length,
    1
  );
  assert.equal(initializedRuntime.window.getListenerCount('pageshow'), 1);
  initializedRuntime.rolePricingTrigger.click();
  assert.equal(initializedRuntime.rolePricingOverlay.hidden, false);
  initializedRuntime.rolePricingAcknowledgement.click();
  assert.equal(initializedRuntime.rolePricingOverlay.hidden, true);
  assert.equal(initializedRuntime.rolePricingTrigger.focused, true);
  initializedRuntime.rolePricingTrigger.click();
  initializedRuntime.rolePricingOverlay.click();
  assert.equal(initializedRuntime.rolePricingOverlay.hidden, true);
  initializedRuntime.rolePricingTrigger.click();
  initializedRuntime.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(initializedRuntime.rolePricingOverlay.hidden, true);

  let resolveCatalog;
  let catalogRequestCount = 0;
  const loadingRuntime = loadHomeRuntime({
    fetchImpl: async (pathname) => {
      assert.equal(pathname, '/api/roles');
      catalogRequestCount += 1;
      return new Promise((resolve) => {
        resolveCatalog = resolve;
      });
    },
  });
  const firstLoad = loadingRuntime.test.loadPublicRoleCatalog();
  const duplicateLoad =
    loadingRuntime.test.loadPublicRoleCatalog();
  assert.equal(firstLoad, duplicateLoad);
  assert.equal(catalogRequestCount, 1);
  assert.equal(loadingRuntime.rolePricingTrigger.disabled, true);
  assert.equal(loadingRuntime.test.openCurrentRolePricing(), false);
  assert.doesNotMatch(
    loadingRuntime.rolePricingMinutePrice.textContent,
    /¥0\.00/
  );
  resolveCatalog(createRoleCatalogResponse());
  assert.equal(await firstLoad, true);
  assert.equal(loadingRuntime.test.getRoleCatalogState(), 'ready');
  assert.equal(loadingRuntime.rolePricingTrigger.disabled, false);
  assert.equal(
    loadingRuntime.rolePricingTrigger.attributes.get('aria-busy'),
    'false'
  );

  assert.equal(loadingRuntime.test.formatBalanceCents(100), '¥1.00');
  assert.equal(loadingRuntime.test.formatBalanceCents(60), '¥0.60');
  assert.equal(loadingRuntime.test.formatBalanceCents(150), '¥1.50');

  assert.equal(loadingRuntime.test.openCurrentRolePricing(), true);
  assert.equal(
    loadingRuntime.test.getActiveOverlay(),
    loadingRuntime.rolePricingOverlay
  );
  assert.equal(loadingRuntime.rolePricingName.textContent, '玉皇大帝');
  assert.equal(
    loadingRuntime.rolePricingMinutePrice.textContent,
    '¥1.00'
  );
  assert.equal(loadingRuntime.rolePricingUnitSeconds.textContent, '6');
  assert.equal(
    loadingRuntime.rolePricingRoundingSeconds.textContent,
    '6'
  );
  assert.equal(
    loadingRuntime.rolePricingRoundingSecondsCopy.textContent,
    '6'
  );
  assert.equal(
    loadingRuntime.fetchRequests.some(
      (request) => request.pathname === '/api/calls'
    ),
    false
  );

  loadingRuntime.test.closeOverlay(
    loadingRuntime.rolePricingOverlay,
    true
  );
  assert.equal(loadingRuntime.rolePricingOverlay.hidden, true);
  assert.equal(loadingRuntime.rolePricingTrigger.focused, true);

  for (const [index, role] of UI_MATRIX.entries()) {
    assert.equal(
      await loadingRuntime.test.selectCharacter(role.key, 'test'),
      true
    );
    assert.equal(loadingRuntime.test.openCurrentRolePricing(), true);
    assert.equal(loadingRuntime.rolePricingName.textContent, role.name);
    assert.equal(
      loadingRuntime.rolePricingMinutePrice.textContent,
      loadingRuntime.test.formatBalanceCents(
        ROLE_PRICE_PER_MINUTE_FEN[index]
      )
    );
    loadingRuntime.test.closeOverlay(
      loadingRuntime.rolePricingOverlay,
      false
    );
  }

  await loadingRuntime.test.selectCharacter('yuhuang', 'test');
  loadingRuntime.test.openCurrentRolePricing();
  assert.equal(
    await loadingRuntime.test.selectCharacter('sunwukong', 'test'),
    true
  );
  assert.equal(loadingRuntime.rolePricingOverlay.hidden, true);
  assert.equal(loadingRuntime.test.openCurrentRolePricing(), true);
  assert.equal(loadingRuntime.rolePricingName.textContent, '孙悟空');
  assert.equal(
    loadingRuntime.rolePricingMinutePrice.textContent,
    '¥0.90'
  );

  loadingRuntime.test.handleEscapeKey({
    key: 'Escape',
    preventDefault() {},
  });
  assert.equal(loadingRuntime.rolePricingOverlay.hidden, true);
  loadingRuntime.test.openCurrentRolePricing();
  loadingRuntime.test.handleOverlayBackdropClick({
    currentTarget: loadingRuntime.rolePricingOverlay,
    target: loadingRuntime.rolePricingOverlay,
  });
  assert.equal(loadingRuntime.rolePricingOverlay.hidden, true);

  loadingRuntime.test.openOverlay(
    loadingRuntime.rechargePanel,
    loadingRuntime.rechargeEntry
  );
  assert.equal(loadingRuntime.rechargePanel.hidden, false);
  loadingRuntime.test.openCurrentRolePricing();
  assert.equal(loadingRuntime.rechargePanel.hidden, true);
  assert.equal(loadingRuntime.rolePricingOverlay.hidden, false);

  let failureCatalogRequests = 0;
  let callRequests = 0;
  const failureRuntime = loadHomeRuntime({
    storageEntries: {
      companion_auth_state_v1: createAuthState('phone'),
    },
    fetchImpl: async (pathname) => {
      if (pathname === '/api/roles') {
        failureCatalogRequests += 1;
        if (failureCatalogRequests === 1) {
          throw new Error('catalog unavailable');
        }
        return createRoleCatalogResponse();
      }
      if (pathname === '/api/calls') {
        callRequests += 1;
        return {
          ok: true,
          status: 201,
          async json() {
            return { call: { id: 'call-after-catalog-failure' } };
          },
        };
      }
      if (pathname === '/api/dev/recharge') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              account: {
                currency: 'CNY',
                balanceCents: 2250,
                remainingSeconds: 0,
              },
            };
          },
        };
      }
      throw new Error(`unexpected request: ${pathname}`);
    },
  });
  assert.equal(
    await failureRuntime.test.loadPublicRoleCatalog(),
    false
  );
  assert.equal(failureRuntime.test.getRoleCatalogState(), 'error');
  assert.equal(failureRuntime.rolePricingTrigger.disabled, false);
  assert.equal(failureRuntime.test.openCurrentRolePricing(), false);
  assert.match(
    failureRuntime.toast.textContent,
    /收费信息暂时无法加载/
  );
  assert.equal(
    await failureRuntime.test.getRoleCatalogLoadPromise(),
    true
  );
  assert.equal(failureRuntime.test.getRoleCatalogState(), 'ready');
  assert.equal(
    await failureRuntime.test.selectCharacter('guanyin', 'test'),
    true
  );
  assert.equal(
    await failureRuntime.test.handleRechargeConfirmation(),
    true
  );
  assert.equal(failureRuntime.test.getAccountBalanceCents(), 2250);
  assert.equal(
    await failureRuntime.test.handleStartConversation(),
    true
  );
  assert.equal(callRequests, 1);

  let catalogVersion = 0;
  let bfcacheCatalogRequests = 0;
  const bfcacheRuntime = loadHomeRuntime({
    fetchImpl: async (pathname) => {
      assert.equal(pathname, '/api/roles');
      bfcacheCatalogRequests += 1;
      const prices = [...ROLE_PRICE_PER_MINUTE_FEN];
      if (catalogVersion === 1) {
        prices[1] = 120;
      }
      return createRoleCatalogResponse(prices);
    },
  });
  assert.equal(
    await bfcacheRuntime.test.loadPublicRoleCatalog(),
    true
  );
  await bfcacheRuntime.test.selectCharacter('sunwukong', 'test');
  bfcacheRuntime.test.handleHomePageShow();
  assert.equal(bfcacheRuntime.test.openCurrentRolePricing(), true);
  catalogVersion = 1;
  bfcacheRuntime.test.handleHomePageShow();
  bfcacheRuntime.test.handleHomePageShow();
  assert.equal(bfcacheRuntime.rolePricingOverlay.hidden, true);
  assert.equal(
    await bfcacheRuntime.test.getRoleCatalogLoadPromise(),
    true
  );
  assert.equal(bfcacheCatalogRequests, 2);
  assert.equal(
    bfcacheRuntime.test.getCurrentCharacterKey(),
    'sunwukong'
  );
  assert.equal(bfcacheRuntime.test.openCurrentRolePricing(), true);
  assert.equal(
    bfcacheRuntime.rolePricingMinutePrice.textContent,
    '¥1.20'
  );
}

async function verifyAuthGateAndRechargeRegression() {
  const authKey = 'companion_auth_state_v1';
  const guestRuntime = loadHomeRuntime({
    storageEntries: {
      [authKey]: createAuthState('guest'),
    },
  });
  assert.equal(guestRuntime.test.getAccountBalanceCents(), null);
  assert.equal(await guestRuntime.test.handleRechargeConfirmation(), false);
  assert.equal(guestRuntime.test.getAccountBalanceCents(), null);
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
  await phoneRuntime.test.loadAccountState();
  assert.equal(phoneRuntime.test.getAccountBalanceCents(), 1250);
  assert.equal(await phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getAccountBalanceCents(), 2250);

  const twentyYuan = new FakeElement();
  twentyYuan.dataset.packageMode = 'preset';
  twentyYuan.dataset.packageCents = '2000';
  phoneRuntime.test.handlePackageSelection({
    currentTarget: twentyYuan,
  });
  assert.equal(await phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getAccountBalanceCents(), 2250);

  const customAmount = new FakeElement();
  customAmount.dataset.packageMode = 'custom';
  phoneRuntime.customAmountInput.value = '7.25';
  phoneRuntime.test.handlePackageSelection({
    currentTarget: customAmount,
  });
  assert.equal(await phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getAccountBalanceCents(), 2250);

  const alipay = new FakeElement();
  alipay.dataset.paymentMethod = 'alipay';
  alipay.dataset.paymentName = '支付宝支付';
  phoneRuntime.test.handlePaymentSelection({
    currentTarget: alipay,
  });
  assert.equal(await phoneRuntime.test.handleRechargeConfirmation(), true);
  assert.equal(phoneRuntime.test.getAccountBalanceCents(), 2250);

  const refreshedRuntime = loadHomeRuntime({
    storageEntries: {
      [authKey]: createAuthState('phone'),
    },
  });
  await refreshedRuntime.test.loadAccountState();
  assert.equal(refreshedRuntime.test.getAccountBalanceCents(), 1250);
}

function verifyStaticSafetyAndCurrentUi() {
  const homeHtml = fs.readFileSync(HOME_HTML_PATH, 'utf8');
  const homeCss = fs.readFileSync(HOME_CSS_PATH, 'utf8');
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
  assert.doesNotMatch(homeJs, /prototypeCreditBalance|12\.50;/);
  assert.match(homeJs, /let accountBalanceCents = null;/);
  assert.match(homeHtml, /data-package-cents="1000"/);
  assert.match(homeHtml, /data-package-cents="2000"/);
  assert.match(homeHtml, /data-package-cents="5000"/);
  assert.match(homeHtml, /data-package-mode="custom"/);
  assert.match(homeHtml, /data-payment-method="wechat"/);
  assert.match(homeHtml, /data-payment-method="alipay"/);
  assert.equal(
    (homeHtml.match(/class="role-pricing-trigger"/g) || []).length,
    1
  );
  assert.match(
    homeHtml,
    /class="side-actions side-actions-right"[\s\S]*?class="role-pricing-trigger"[\s\S]*?data-action="culture"[\s\S]*?data-action="share"[\s\S]*?<\/nav>/
  );
  assert.match(
    homeHtml,
    /<button[\s\S]{0,180}class="role-pricing-trigger"[\s\S]{0,260}type="button"[\s\S]{0,180}aria-label="查看收费说明"[\s\S]{0,180}aria-haspopup="dialog"/
  );
  assert.match(
    homeHtml,
    /class="role-pricing-overlay prototype-overlay"[\s\S]{0,180}role="dialog"/
  );
  assert.match(homeHtml, /收费说明/);
  assert.match(homeHtml, /\/ 分钟/);
  assert.match(homeHtml, /实际每/);
  assert.match(homeHtml, /不足/);
  assert.match(homeHtml, /通话结束后自动从账户话费中扣除/);
  assert.match(
    homeHtml,
    /data-close-overlay>我知道了<\/button>/
  );
  assert.match(
    homeCss,
    /:root\s*\{[\s\S]*?--action-rail-right:\s*calc\(var\(--safe-right\) \+ 7px\);[\s\S]*?--action-rail-width:\s*72px;/
  );
  assert.match(
    homeCss,
    /\.side-actions-right\s*\{[\s\S]*?right:\s*var\(--action-rail-right\);[\s\S]*?width:\s*var\(--action-rail-width\);[\s\S]*?align-items:\s*center;/
  );
  assert.match(
    homeCss,
    /\.role-pricing-trigger\s*\{[\s\S]*?position:\s*relative;[\s\S]*?width:\s*48px;[\s\S]*?height:\s*48px;/
  );
  assert.match(homeJs, /const ROLE_CATALOG_API_URL = '\/api\/roles'/);
  assert.match(homeJs, /function loadPublicRoleCatalog\(\)/);
  assert.match(homeJs, /rolePricingByKey\.get\(currentCharacterKey\)/);
  assert.doesNotMatch(
    homeJs,
    /pricePerMinuteFen\s*:\s*(?:100|90|110|130|150|80|60|70)\b/
  );
}

function verifyFeatureChoiceAndFortuneEntry() {
  const choiceHtml = fs.readFileSync(CHOICE_HTML_PATH, 'utf8');
  const fortuneHtml = fs.readFileSync(FORTUNE_HTML_PATH, 'utf8');
  const fortuneJs = fs.readFileSync(FORTUNE_JS_PATH, 'utf8');
  const entryCss = fs.readFileSync(ENTRY_CSS_PATH, 'utf8');
  const homeHtml = fs.readFileSync(HOME_HTML_PATH, 'utf8');

  assert.equal(
    (choiceHtml.match(/class="feature-card feature-card-/g) || []).length,
    2
  );
  assert.match(
    choiceHtml,
    /<a class="feature-card feature-card-call" href="\.\/home\.html">[\s\S]*?<strong>与神仙通话<\/strong>[\s\S]*?<span>听您慢慢说<\/span>/
  );
  assert.match(
    choiceHtml,
    /<a class="feature-card feature-card-fortune" href="\.\/fortune\.html">[\s\S]*?<strong>上香求签<\/strong>[\s\S]*?<span>静心诉说，诚心求一签<\/span>/
  );
  assert.doesNotMatch(choiceHtml, /onclick=|href="\.\/choice\.html"/);
  assert.match(
    homeHtml,
    /<a class="side-action feature-choice-link" href="\.\/choice\.html" aria-label="返回功能选择">/
  );

  assert.match(fortuneHtml, /<h1 id="fortune-title">上香求签<\/h1>/);
  assert.match(
    fortuneHtml,
    /神明高坐庙堂，道童在殿前引导求签。/
  );
  assert.match(
    fortuneHtml,
    /class="shrine-scene-background"[\s\S]*?data-fortune-character-image/
  );
  assert.match(
    fortuneHtml,
    /class="temple-scene shrine-character-layer"[\s\S]*?class="acolyte-character"[\s\S]*?src="\.\/assets\/fortune\/daotong-guide-v1\.png"/
  );
  assert.match(
    fortuneHtml,
    /class="shrine-foreground"[\s\S]*?class="fortune-result-layer"[\s\S]*?class="page-footnotes"/
  );
  assert.match(
    fortuneHtml,
    /<section class="offering-stage"[\s\S]*?香炉与一炷未点燃的香/
  );
  assert.match(
    fortuneHtml,
    /<section class="acolyte-guide"[\s\S]*?道童引导/
  );
  assert.doesNotMatch(
    fortuneHtml,
    /acolyte-silhouette|acolyte-head|acolyte-body/
  );
  assert.match(
    fortuneHtml,
    /<button class="offer-incense-button" type="button" data-offer-incense>敬上一炷香<\/button>/
  );
  assert.match(
    fortuneHtml,
    /<button class="speak-control-button" type="button" data-speak-control>开始诉说<\/button>/
  );
  assert.match(
    fortuneHtml,
    /<section class="wish-paper" data-wish-paper[\s\S]*?道童代您写下/
  );
  assert.doesNotMatch(
    fortuneHtml,
    /data-(?:transcript-actions|confirm-transcript|retry-transcript|wish-next-step|offer-wish)|就是这个意思|重新说一遍|奉入香炉/
  );
  assert.match(
    fortuneHtml,
    /data-wish-offering-stage aria-hidden="true" hidden[\s\S]*?data-wish-furnace[\s\S]*?data-wish-furnace-mouth[\s\S]*?data-flying-wish-paper[\s\S]*?data-flying-wish-paper-text/
  );
  assert.match(
    fortuneHtml,
    /<button class="draw-fortune-preview-button" type="button" data-draw-fortune disabled>诚心求一签<\/button>/
  );
  assert.match(
    fortuneHtml,
    /data-fortune-result[\s\S]*?data-lot-number[\s\S]*?data-lot-level[\s\S]*?data-lot-title[\s\S]*?data-lot-verses/
  );
  assert.match(
    fortuneHtml,
    /当前为项目原型签文，正式签谱后续校订。/
  );
  assert.match(
    fortuneHtml,
    /data-interpret-fortune>请道童解签<\/button>/
  );
  assert.match(
    fortuneHtml,
    /data-interpretation-result[\s\S]*?<h4>道童解签<\/h4>[\s\S]*?data-interpretation-text[\s\S]*?data-interpretation-audio/
  );
  assert.match(
    fortuneHtml,
    /data-interpretation-audio[\s\S]*?data-interpretation-audio-control[\s\S]*?>\s*听道童解签\s*<\/button>/
  );
  assert.match(
    fortuneHtml,
    /签文与解读仅作传统文化体验及情绪陪伴参考。/
  );
  assert.doesNotMatch(
    fortuneHtml,
    /签意概括|道童解读|眼下可做的小事|温馨提示|data-interpretation-(?:summary|reflection|action|safety)/
  );
  assert.match(
    fortuneHtml,
    /<a class="return-choice-button" href="\.\/choice\.html">返回功能选择<\/a>/
  );
  assert.match(fortuneHtml, /<script src="\.\/fortune\.js"><\/script>/);
  assert.match(
    fortuneJs,
    /new URLSearchParams\(window\.location\.search\)[\s\S]*?get\('characterKey'\)/
  );
  assert.match(
    fortuneJs,
    /`\.\/*assets\/characters\/\$\{characterKey\}\/\$\{characterKey\}-home-hero-\$\{version\}\.png`/
  );
  assert.equal((fortuneJs.match(/assets\/characters/g) || []).length, 1);
  assert.equal(fs.existsSync(DAOTONG_ASSET_PATH), true);
  assert.match(
    entryCss,
    /\.shrine-deity-visual\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*50% 42%;[\s\S]*?scale\(1\.035\)/
  );
  assert.match(
    entryCss,
    /\.acolyte-character\s*\{[\s\S]*?object-fit:\s*contain;/
  );
  assert.doesNotMatch(fortuneHtml, /神仙亲自解签/);
  assert.doesNotMatch(
    fortuneHtml,
    /<(?:input|textarea)\b|contenteditable=|抽签动画|语音识别预览|解签内容|TTS/
  );

  assert.match(entryCss, /body\s*\{[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(
    entryCss,
    /\.feature-card\s*\{[\s\S]*?min-height:\s*158px;/
  );
  assert.match(
    entryCss,
    /\.return-choice-button\s*\{[\s\S]*?min-height:\s*60px;/
  );
  assert.match(entryCss, /width:\s*min\(430px,\s*100%\);/);
  assert.match(
    entryCss,
    /\.fortune-interpretation-audio-button\s*\{[\s\S]*?min-height:\s*54px;/
  );
  assert.match(
    entryCss,
    /\.wish-offering-stage\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?pointer-events:\s*none;/
  );
}

function verifyFeatureChoiceAndStagedFortuneEntry() {
  const choiceHtml = fs.readFileSync(CHOICE_HTML_PATH, 'utf8');
  const choiceCss = fs.readFileSync(CHOICE_CSS_PATH, 'utf8');
  const fortuneHtml = fs.readFileSync(FORTUNE_HTML_PATH, 'utf8');
  const fortuneJs = fs.readFileSync(FORTUNE_JS_PATH, 'utf8');
  const entryCss = fs.readFileSync(ENTRY_CSS_PATH, 'utf8');
  const homeHtml = fs.readFileSync(HOME_HTML_PATH, 'utf8');

  assert.equal(
    (choiceHtml.match(/class="feature-card feature-card-/g) || []).length,
    2
  );
  assert.match(
    choiceHtml,
    /href="\.\/home\.html"[\s\S]*?<strong>与神仙通话<\/strong>/
  );
  assert.match(
    choiceHtml,
    /href="\.\/fortune\.html\?characterKey=guanyin"[\s\S]*?<strong>上香求签<\/strong>/
  );
  assert.match(
    choiceHtml,
    /class="landline-phone" aria-hidden="true">[\s\S]*?landline-shell-gradient[\s\S]*?landline-body-gradient[\s\S]*?landline-dial-ring/
  );
  assert.match(
    choiceHtml,
    /class="choice-poster-image"[\s\S]*?assets\/choice\/choice-poster-unified-v2\.png/
  );
  assert.match(
    choiceHtml,
    /class="choice-page-copy"[\s\S]*?<h1>[\s\S]*?<span>[\s\S]*?class="feature-card feature-card-call/
  );
  assert.doesNotMatch(
    choiceHtml,
    /fortune-card-scene|fortune-worshipper|assets\/fortune\/scenes\/fortune-scene-caishen-v1\.png|worshipper-kneeling-back-v[12]\.png/
  );
  assert.match(
    choiceCss,
    /\.choice-link-call\s*\{[\s\S]*?top:\s*35\.95%;[\s\S]*?width:\s*95\.30%;/
  );
  assert.match(
    choiceCss,
    /\.choice-link-fortune\s*\{[\s\S]*?top:\s*60\.35%;[\s\S]*?height:\s*25\.55%;/
  );
  assert.match(
    choiceCss,
    /\.choice-card-accessible-copy\s*\{[\s\S]*?display:\s*grid;/
  );
  assert.match(choiceCss, /\.landline-phone\s*\{[\s\S]*?display:\s*none;/);
  assert.match(choiceHtml, /class="call-card-enter"/);
  assert.match(choiceHtml, /class="choice-footer-copy"/);
  assert.equal(fs.existsSync(CHOICE_UNIFIED_POSTER_ASSET_PATH), true);
  assert.match(
    homeHtml,
    /href="\.\/choice\.html" aria-label="返回功能选择"/
  );
  assert.match(fortuneHtml, /<h1 id="fortune-title">上香求签<\/h1>/);
  assert.match(
    fortuneHtml,
    /三炷清香已燃，请向神明诉说心愿。/
  );
  assert.match(
    fortuneHtml,
    /class="shrine-scene-background"[\s\S]*?data-fortune-character-image/
  );
  assert.equal(
    (
      fortuneHtml.match(
        /src="\.\/assets\/fortune\/daotong-guide-v1\.png"/g
      ) || []
    ).length,
    1
  );
  assert.equal(
    (
      fortuneHtml.match(
        /class="incense-stick incense-stick-(?:left|center|right)"/g
      ) || []
    ).length,
    3
  );
  assert.equal(
    (fortuneHtml.match(/class="incense-ember"/g) || []).length,
    3
  );
  assert.match(
    fortuneHtml,
    /data-speak-control>按住诉说<\/button>/
  );
  assert.doesNotMatch(
    fortuneHtml,
    /data-offer-incense|香火已敬|开始诉说|听道童解签/
  );
  assert.match(fortuneHtml, /data-wish-paper[^>]*hidden/);
  assert.match(
    fortuneHtml,
    /data-draw-fortune disabled>开始抽签<\/button>/
  );
  assert.match(
    fortuneHtml,
    /data-fortune-draw-animation[^>]*hidden[\s\S]*?lot-cylinder[\s\S]*?lot-draw-stick[\s\S]*?lot-draw-slip/
  );
  assert.match(
    fortuneHtml,
    /data-interpret-fortune>请道童解签<\/button>/
  );
  assert.match(
    fortuneHtml,
    /data-interpretation-audio-control[\s\S]*?hidden[\s\S]*?>\s*点击朗读/
  );
  assert.match(
    fortuneHtml,
    /签文与解读仅作传统文化体验及情绪陪伴参考。/
  );
  assert.doesNotMatch(
    fortuneHtml,
    /<(?:input|textarea)\b|contenteditable=|神仙亲自解签/
  );
  assert.match(
    fortuneJs,
    /new URLSearchParams\(window\.location\.search\)[\s\S]*?get\('characterKey'\)/
  );
  assert.match(
    fortuneJs,
    /const version = characterKey === 'sunwukong' \? 'v2' : 'v1';/
  );
  assert.equal((fortuneJs.match(/assets\/characters/g) || []).length, 1);
  assert.match(
    fortuneJs,
    /speakControlButton\.setPointerCapture\(pointerId\)/
  );
  assert.doesNotMatch(fortuneJs, /touchstart|touchend|pointermove/);
  assert.match(
    fortuneJs,
    /await requestInterpretationAudio\(true\)/
  );
  assert.equal(fs.existsSync(DAOTONG_ASSET_PATH), true);
  assert.match(
    entryCss,
    /\.fortune-page\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(entryCss, /@keyframes lot-cylinder-shake\s*\{/);
  assert.match(entryCss, /@keyframes lot-cylinder-wait\s*\{/);
  assert.match(entryCss, /@keyframes lot-stick-rise\s*\{/);
  assert.match(entryCss, /@keyframes lot-slip-reveal\s*\{/);
  assert.match(entryCss, /width:\s*min\(430px,\s*100%\);/);
}

async function main() {
  verifyBrowserLifecycleBoundary();
  verifyStaticSafetyAndCurrentUi();
  verifyFeatureChoiceAndStagedFortuneEntry();
  await verifyRolePricingDetails();
  await verifyAuthGateAndRechargeRegression();
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
      + 'business-call-id-url,unavailable-keys,'
      + 'role-pricing-catalog,role-pricing-eight-roles,'
      + 'role-pricing-loading-error-dedup-bfcache,role-pricing-overlay,'
      + 'fixed-custom-wechat-alipay-refresh-balance,lifecycle-boundary,'
      + 'call-fortune-choice,fortune-incense-microphone-entry\n'
  );
  process.stdout.write(
    `businessCallIdScenarios=${businessCallIdScenarioCount}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
