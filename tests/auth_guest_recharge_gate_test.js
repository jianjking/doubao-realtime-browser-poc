'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_DIR = path.resolve(__dirname, '..');
const UI_DIR = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1'
);
const AUTH_JS_PATH = path.join(UI_DIR, 'auth.js');
const AUTH_HTML_PATH = path.join(UI_DIR, 'index.html');
const HOME_JS_PATH = path.join(UI_DIR, 'ui.js');
const HOME_HTML_PATH = path.join(UI_DIR, 'home.html');
const HOME_CSS_PATH = path.join(UI_DIR, 'ui.css');
const AVATAR_PATH = path.join(
  UI_DIR,
  'assets/account/default-fu-avatar.svg'
);
const AUTH_STORAGE_KEY = 'companion_auth_state_v1';
const PENDING_ACTION_STORAGE_KEY = 'companion_pending_action_v1';
const DEFAULT_HOME_URL =
  'http://127.0.0.1:8765/ui_prototypes/yuhuang_mobile_v1/home.html';

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
    this.checked = false;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.focused = false;
    this.handlers = new Map();
    this.hidden = false;
    this.parentOverlay = null;
    this.queryMap = new Map();
    this.style = {};
    this.textContent = '';
    this.value = '';
  }

  addEventListener(eventName, handler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName).push(handler);
  }

  closest(selector) {
    return selector === '.prototype-overlay'
      ? this.parentOverlay
      : null;
  }

  dispatch(eventName, overrides = {}) {
    const event = {
      button: 0,
      currentTarget: this,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'touch',
      preventDefault() {},
      target: this,
      ...overrides,
    };
    return Promise.all(
      (this.handlers.get(eventName) || []).map((handler) => handler(event))
    );
  }

  click() {
    return this.dispatch('click');
  }

  focus() {
    this.focused = true;
  }

  getBoundingClientRect() {
    return {
      bottom: 600,
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
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setPointerCapture() {}
}

class FakeDocument {
  constructor(selectorMap, selectorAllMap = new Map()) {
    this.body = {
      classList: new FakeClassList(),
      dataset: {},
    };
    this.handlers = new Map();
    this.selectorAllMap = selectorAllMap;
    this.selectorMap = selectorMap;
    this.title = '';
  }

  addEventListener(eventName, handler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName).push(handler);
  }

  dispatch(eventName, overrides = {}) {
    const event = {
      key: '',
      preventDefault() {},
      ...overrides,
    };
    for (const handler of this.handlers.get(eventName) || []) {
      handler(event);
    }
  }

  querySelector(selector) {
    return this.selectorMap.get(selector) || null;
  }

  querySelectorAll(selector) {
    return this.selectorAllMap.get(selector) || [];
  }
}

function createLocalStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  return {
    dump() {
      return Object.fromEntries(values);
    },
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

function createAuthState(mode = 'guest') {
  return mode === 'phone'
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
    };
}

function loadAuthRuntime(options = {}) {
  const form = new FakeElement();
  const phoneInput = new FakeElement();
  const codeInput = new FakeElement();
  const consentCheckbox = new FakeElement();
  const phoneError = new FakeElement();
  const codeError = new FakeElement();
  const consentError = new FakeElement();
  const sendCodeButton = new FakeElement();
  const guestEntryButton = new FakeElement();
  const phoneLoginButton = new FakeElement();
  const authStatus = new FakeElement();
  const selectorMap = new Map([
    ['.phone-auth-form', form],
    ['#phone-input', phoneInput],
    ['#code-input', codeInput],
    ['.consent-checkbox', consentCheckbox],
    ['#phone-error', phoneError],
    ['#code-error', codeError],
    ['.consent-error', consentError],
    ['.send-code-button', sendCodeButton],
    ['.guest-entry-button', guestEntryButton],
    ['.phone-login-button', phoneLoginButton],
    ['.auth-status', authStatus],
  ]);
  form.querySelector = (selector) => {
    if (selector !== '[aria-invalid="true"]') {
      return null;
    }
    return [phoneInput, codeInput, consentCheckbox].find(
      (element) => element.attributes.get('aria-invalid') === 'true'
    ) || null;
  };

  const document = new FakeDocument(selectorMap);
  const localStorage = createLocalStorage(options.storageEntries);
  const locationAssignments = [];
  const fetchRequests = [];
  const fetchImpl = options.fetchImpl || (async (pathname) => {
    if (pathname === '/api/auth/login') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            authMode: 'development_mock_phone',
            principal: { type: 'user', id: 'user-test' },
            profile: { phoneMasked: '138****1234' },
          };
        },
      };
    }
    return {
      ok: true,
      status: 201,
      async json() {
        return {
          authMode: 'development_guest',
          principal: { type: 'guest', id: 'guest-test' },
        };
      },
    };
  });
  const window = {
    clearInterval() {},
    fetch(pathname, requestOptions) {
      fetchRequests.push({ pathname, requestOptions });
      return fetchImpl(pathname, requestOptions);
    },
    localStorage,
    location: {
      assign(url) {
        locationAssignments.push(url);
      },
      search: options.search || '',
    },
    setInterval() {
      return 1;
    },
  };
  vm.runInNewContext(fs.readFileSync(AUTH_JS_PATH, 'utf8'), {
    URLSearchParams,
    console,
    document,
    window,
  }, {
    filename: AUTH_JS_PATH,
  });

  return {
    authStatus,
    codeError,
    codeInput,
    consentCheckbox,
    consentError,
    form,
    fetchRequests,
    guestEntryButton,
    localStorage,
    locationAssignments,
    phoneError,
    phoneInput,
    phoneLoginButton,
    sendCodeButton,
  };
}

function loadHomeRuntime(options = {}) {
  let source = fs.readFileSync(HOME_JS_PATH, 'utf8');
  source = source.replace(
    '  initializeUi();',
    `  initializeUi();
    globalThis.__homeTest = {
      closeActiveOverlay,
      characters,
      formatBalanceCents,
      getActiveOverlay: () => activeOverlay,
      getAccountBalanceCents: () => accountBalanceCents,
      getAccountLoadPromise: () => accountLoadPromise,
      getCurrentCharacterKey: () => currentCharacterKey,
      getIsStartingCall: () => isStartingCall,
      getValidatedAuthState,
      handleRechargeConfirmation,
      handleStartConversation,
      isPhoneAuthenticated,
      loadAccountState,
      openAccountProfile,
      selectCharacter,
    };`
  );

  const make = () => new FakeElement();
  const sceneImage = make();
  const characterStage = make();
  const rolePosition = make();
  const accountSummaryButton = make();
  const accountPrimary = make();
  const accountSecondary = make();
  const rechargeEntry = make();
  const rechargePanel = make();
  const rechargeLoginOverlay = make();
  const accountProfileOverlay = make();
  const logoutConfirmOverlay = make();
  const profileMainAction = make();
  const rechargeResult = make();
  const rechargeSelectionSummary = make();
  const customAmountField = make();
  const customAmountInput = make();
  const customAmountError = make();
  const toast = make();
  const callControl = make();
  const callButton = make();
  const callButtonLabel = make();
  const callActionLabel = make();
  const homeTitle = make();
  const characterMotto = make();
  const characterReadyText = make();
  const characterStatusDetail = make();
  const profileSummary = make();
  const profileStatus = make();
  const profilePhone = make();
  const profileVip = make();
  const profileRecharge = make();
  const loginForRecharge = make();
  const confirmLogout = make();
  const cancelLogout = make();
  const creditDisplay = make();

  const overlays = [
    rechargePanel,
    rechargeLoginOverlay,
    accountProfileOverlay,
    logoutConfirmOverlay,
  ];
  overlays.forEach((overlay) => {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  });
  const closeButtons = overlays.map((overlay) => {
    const button = make();
    button.parentOverlay = overlay;
    overlay.queryMap.set('[data-close-overlay]', button);
    return button;
  });
  logoutConfirmOverlay.queryMap.delete('[data-close-overlay]');
  logoutConfirmOverlay.queryMap.set('button', confirmLogout);

  const selectorMap = new Map([
    ['.top-controls h1', homeTitle],
    ['.scene-image', sceneImage],
    ['.character-stage', characterStage],
    ['.character-motto', characterMotto],
    ['[data-character-ready-text]', characterReadyText],
    ['[data-character-status-detail]', characterStatusDetail],
    ['[data-current-role-position]', rolePosition],
    ['.account-summary-button', accountSummaryButton],
    ['[data-account-primary]', accountPrimary],
    ['[data-account-secondary]', accountSecondary],
    ['.time-recharge-entry', rechargeEntry],
    ['.recharge-panel', rechargePanel],
    ['.recharge-login-overlay', rechargeLoginOverlay],
    ['.account-profile-overlay', accountProfileOverlay],
    ['.logout-confirm-overlay', logoutConfirmOverlay],
    ['[data-profile-main-action]', profileMainAction],
    ['.ui-toast', toast],
    ['.call-control', callControl],
    ['.call-button', callButton],
    ['.call-button-label', callButtonLabel],
    ['[data-call-action-label]', callActionLabel],
    ['.recharge-selection-summary', rechargeSelectionSummary],
    ['.recharge-confirm', make()],
    ['.recharge-result', rechargeResult],
    ['.custom-amount-field', customAmountField],
    ['.custom-amount-input', customAmountInput],
    ['.custom-amount-error', customAmountError],
    ['[data-profile-summary]', profileSummary],
    ['[data-profile-status]', profileStatus],
    ['[data-profile-phone]', profilePhone],
    ['[data-profile-vip]', profileVip],
    ['[data-profile-recharge]', profileRecharge],
    ['[data-login-for-recharge]', loginForRecharge],
    ['[data-confirm-logout]', confirmLogout],
    ['[data-cancel-logout]', cancelLogout],
  ]);
  const selectorAllMap = new Map([
    ['.prototype-overlay', overlays],
    ['[data-close-overlay]', closeButtons],
    ['.package-option', []],
    ['.payment-option', []],
    ['.side-action[data-action]', []],
    ['[data-current-credit]', [creditDisplay]],
  ]);
  const document = new FakeDocument(selectorMap, selectorAllMap);
  const localStorage = createLocalStorage(options.storageEntries);
  const locationAssignments = [];
  const fetchRequests = [];
  const windowHandlers = new Map();
  const homePageUrl = new URL(options.homePageUrl || DEFAULT_HOME_URL);
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
    return {
      ok: true,
      status: 201,
      async json() {
        return {
          call: {
            id: 'call-ui-test',
          },
        };
      },
    };
  });

  class FakeImage {
    set src(value) {
      this.value = value;
      setTimeout(() => {
        if (this.onload) {
          this.onload();
        }
      }, 0);
    }
  }

  const window = {
    addEventListener(eventName, handler) {
      if (!windowHandlers.has(eventName)) {
        windowHandlers.set(eventName, []);
      }
      windowHandlers.get(eventName).push(handler);
    },
    clearTimeout,
    dispatch(eventName, overrides = {}) {
      const event = {
        persisted: false,
        ...overrides,
      };
      for (const handler of windowHandlers.get(eventName) || []) {
        handler(event);
      }
    },
    fetch(pathname, requestOptions) {
      fetchRequests.push({ pathname, requestOptions });
      return fetchImpl(pathname, requestOptions);
    },
    getListenerCount(eventName) {
      return (windowHandlers.get(eventName) || []).length;
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
    accountPrimary,
    accountProfileOverlay,
    accountSecondary,
    accountSummaryButton,
    callButton,
    callActionLabel,
    callButtonLabel,
    cancelLogout,
    confirmLogout,
    document,
    fetchRequests,
    localStorage,
    locationAssignments,
    loginForRecharge,
    logoutConfirmOverlay,
    profileMainAction,
    profilePhone,
    profileRecharge,
    profileStatus,
    profileVip,
    rechargeEntry,
    rechargeLoginOverlay,
    rechargePanel,
    toast,
    creditDisplay,
    test: context.__homeTest,
    window,
  };
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyAuthValidationAndPrivacy() {
  const empty = loadAuthRuntime();
  empty.form.dispatch('submit');
  assert.equal(empty.phoneError.hidden, false);
  assert.equal(empty.codeError.hidden, false);
  assert.equal(empty.consentError.hidden, false);
  assert.deepEqual(empty.locationAssignments, []);

  const invalidPhone = loadAuthRuntime();
  invalidPhone.phoneInput.value = '128123';
  invalidPhone.sendCodeButton.click();
  assert.equal(invalidPhone.phoneError.hidden, false);
  assert.equal(invalidPhone.sendCodeButton.disabled, false);

  const codeErrors = loadAuthRuntime();
  codeErrors.phoneInput.value = '13800001234';
  codeErrors.codeInput.value = '111111';
  codeErrors.consentCheckbox.checked = true;
  codeErrors.form.dispatch('submit');
  assert.equal(codeErrors.codeError.hidden, false);
  assert.deepEqual(codeErrors.locationAssignments, []);

  const noConsent = loadAuthRuntime();
  noConsent.phoneInput.value = '13800001234';
  noConsent.codeInput.value = '123456';
  noConsent.form.dispatch('submit');
  assert.equal(noConsent.consentError.hidden, false);

  const sendCode = loadAuthRuntime();
  sendCode.phoneInput.value = '13800001234';
  sendCode.sendCodeButton.click();
  assert.equal(sendCode.authStatus.textContent, '演示验证码为123456');
  assert.equal(sendCode.sendCodeButton.disabled, true);
  assert.equal(sendCode.sendCodeButton.textContent, '60秒后重发');

  const login = loadAuthRuntime({
    search: '?mode=phone&returnAction=recharge',
  });
  login.phoneInput.value = '13800001234';
  login.codeInput.value = '123456';
  login.consentCheckbox.checked = true;
  await login.form.dispatch('submit');
  const storedAuth = login.localStorage.getItem(AUTH_STORAGE_KEY);
  const parsedStoredAuth = JSON.parse(storedAuth);
  assert.equal(parsedStoredAuth.version, 1);
  assert.equal(parsedStoredAuth.mode, 'phone');
  assert.equal(parsedStoredAuth.authenticated, true);
  assert.equal(parsedStoredAuth.phoneMasked, '138****1234');
  assert.equal(Number.isInteger(parsedStoredAuth.createdAt), true);
  assert.deepEqual(
    Object.keys(parsedStoredAuth).sort(),
    ['authenticated', 'createdAt', 'mode', 'phoneMasked', 'version']
  );
  assert.equal(login.codeInput.value, '');
  assert.equal(storedAuth.includes('13800001234'), false);
  assert.equal(storedAuth.includes('123456'), false);
  assert.equal(
    login.localStorage.getItem(PENDING_ACTION_STORAGE_KEY),
    'recharge'
  );
  assert.deepEqual(login.locationAssignments, ['./home.html']);
  assert.equal(login.fetchRequests.length, 1);
  assert.equal(login.fetchRequests[0].pathname, '/api/auth/login');
  assert.deepEqual(
    JSON.parse(login.fetchRequests[0].requestOptions.body),
    {
      phone: '13800001234',
      code: '123456',
    }
  );

  const guest = loadAuthRuntime();
  await guest.guestEntryButton.click();
  const guestState = JSON.parse(
    guest.localStorage.getItem(AUTH_STORAGE_KEY)
  );
  assert.equal(guestState.mode, 'guest');
  assert.equal(guestState.authenticated, false);
  assert.equal(guestState.phoneMasked, '');
  assert.deepEqual(guest.locationAssignments, ['./home.html']);
  assert.equal(guest.fetchRequests.length, 1);
  assert.equal(guest.fetchRequests[0].pathname, '/api/auth/guest');

  for (const invalidState of [
    '{damaged',
    JSON.stringify({
      ...createAuthState('phone'),
      version: 2,
    }),
  ]) {
    const runtime = loadAuthRuntime({
      storageEntries: {
        [AUTH_STORAGE_KEY]: invalidState,
      },
    });
    assert.equal(runtime.localStorage.getItem(AUTH_STORAGE_KEY), null);
  }

  const unknownQuery = loadAuthRuntime({
    search: '?mode=admin&returnAction=https://example.com',
  });
  assert.equal(
    unknownQuery.localStorage.getItem(PENDING_ACTION_STORAGE_KEY),
    null
  );
}

async function verifyHomeGuardRechargeAndAccount() {
  const noState = loadHomeRuntime();
  assert.deepEqual(noState.locationAssignments, ['./index.html']);

  for (const invalidState of [
    {
      ...createAuthState('guest'),
      mode: 'admin',
    },
    {
      ...createAuthState('phone'),
      authenticated: 'true',
    },
    {
      ...createAuthState('phone'),
      vipLevel: '至尊会员',
    },
  ]) {
    const runtime = loadHomeRuntime({
      storageEntries: {
        [AUTH_STORAGE_KEY]: JSON.stringify(invalidState),
      },
    });
    assert.deepEqual(runtime.locationAssignments, ['./index.html']);
    assert.equal(runtime.localStorage.getItem(AUTH_STORAGE_KEY), null);
  }

  const guest = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('guest')),
    },
  });
  assert.deepEqual(guest.locationAssignments, []);
  assert.equal(guest.document.body.dataset.authReady, 'true');
  assert.equal(guest.accountPrimary.textContent, '游客用户');
  assert.equal(guest.accountSecondary.textContent, '游客体验');
  assert.equal(
    guest.accountSummaryButton.attributes.get('aria-label'),
    '查看游客个人信息，充值前需要登录'
  );

  guest.accountSummaryButton.click();
  assert.equal(guest.accountProfileOverlay.hidden, false);
  assert.equal(guest.profileStatus.textContent, '游客体验');
  assert.equal(guest.profilePhone.textContent, '未绑定');
  assert.equal(guest.profileVip.textContent, '游客');
  assert.equal(guest.profileRecharge.textContent, '登录后可以充值');
  guest.document.dispatch('keydown', {
    key: 'Escape',
  });
  assert.equal(guest.accountProfileOverlay.hidden, true);
  assert.equal(guest.accountSummaryButton.focused, true);

  guest.rechargeEntry.click();
  assert.equal(guest.rechargePanel.hidden, true);
  assert.equal(guest.rechargeLoginOverlay.hidden, false);
  assert.equal(guest.test.handleRechargeConfirmation(), false);
  assert.equal(guest.test.getAccountBalanceCents(), null);

  guest.test.closeActiveOverlay();
  guest.accountSummaryButton.click();
  guest.profileMainAction.click();
  assert.equal(
    guest.localStorage.getItem(PENDING_ACTION_STORAGE_KEY),
    'profile'
  );
  assert.equal(
    guest.locationAssignments.at(-1),
    './index.html?mode=phone&returnAction=profile'
  );

  const guestCall = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('guest')),
    },
  });
  guestCall.callButton.click();
  const guestCallUrl = new URL(guestCall.locationAssignments.at(-1));
  assert.equal(guestCallUrl.origin, 'http://127.0.0.1:3001');
  assert.equal(
    guestCallUrl.searchParams.get('returnUrl'),
    DEFAULT_HOME_URL
  );
  assert.equal(guestCallUrl.searchParams.has('businessCallId'), false);

  const phone = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
    },
  });
  await wait();
  assert.equal(phone.creditDisplay.textContent, '¥12.50');
  assert.equal(phone.test.getAccountBalanceCents(), 1250);
  assert.equal(phone.accountPrimary.textContent, '138****1234');
  assert.equal(phone.accountSecondary.textContent, '普通会员');
  assert.equal(
    phone.accountSummaryButton.attributes.get('aria-label'),
    '查看138****1234的个人信息，当前普通会员'
  );
  phone.rechargeEntry.click();
  assert.equal(phone.rechargePanel.hidden, false);
  assert.equal(phone.rechargeLoginOverlay.hidden, true);
  assert.equal(phone.test.handleRechargeConfirmation(), true);
  assert.equal(phone.test.getAccountBalanceCents(), 1250);

  phone.test.closeActiveOverlay();
  phone.accountSummaryButton.click();
  assert.equal(phone.profileStatus.textContent, '已登录');
  assert.equal(phone.profilePhone.textContent, '138****1234');
  assert.equal(phone.profileVip.textContent, '普通会员');
  assert.equal(phone.profileRecharge.textContent, '可以使用充值演示');
  phone.profileMainAction.click();
  assert.equal(phone.logoutConfirmOverlay.hidden, false);
  phone.cancelLogout.click();
  assert.equal(phone.accountProfileOverlay.hidden, false);
  assert.notEqual(phone.localStorage.getItem(AUTH_STORAGE_KEY), null);
  phone.profileMainAction.click();
  phone.confirmLogout.click();
  assert.equal(phone.localStorage.getItem(AUTH_STORAGE_KEY), null);
  assert.equal(phone.localStorage.getItem(PENDING_ACTION_STORAGE_KEY), null);
  assert.equal(phone.locationAssignments.at(-1), './index.html');

  const pendingRecharge = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
      [PENDING_ACTION_STORAGE_KEY]: 'recharge',
    },
  });
  await wait();
  assert.equal(pendingRecharge.rechargePanel.hidden, false);
  assert.equal(
    pendingRecharge.localStorage.getItem(PENDING_ACTION_STORAGE_KEY),
    null
  );

  const refreshed = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
    },
  });
  await wait();
  assert.equal(refreshed.rechargePanel.hidden, true);
  assert.equal(refreshed.test.getAccountBalanceCents(), 1250);

  const pendingProfile = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
      [PENDING_ACTION_STORAGE_KEY]: 'profile',
    },
  });
  await wait();
  assert.equal(pendingProfile.accountProfileOverlay.hidden, false);
  assert.equal(pendingProfile.rechargePanel.hidden, true);
  assert.equal(
    pendingProfile.localStorage.getItem(PENDING_ACTION_STORAGE_KEY),
    null
  );

  const unknownPending = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
      [PENDING_ACTION_STORAGE_KEY]: 'https://example.com',
    },
  });
  await wait();
  assert.equal(
    unknownPending.localStorage.getItem(PENDING_ACTION_STORAGE_KEY),
    null
  );
  assert.equal(unknownPending.rechargePanel.hidden, true);
  assert.equal(unknownPending.accountProfileOverlay.hidden, true);
}

function createJsonResponse(status, responseBody) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return responseBody;
    },
  };
}

function createAccountResponse(balanceCents) {
  return createJsonResponse(200, {
    account: {
      currency: 'CNY',
      balanceCents,
      remainingSeconds: 0,
    },
  });
}

async function verifyRealAccountAndCallFlow() {
  const authKey = AUTH_STORAGE_KEY;
  const phoneStorage = {
    [authKey]: JSON.stringify(createAuthState('phone')),
  };

  const formatRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
  });
  assert.equal(formatRuntime.test.formatBalanceCents(1250), '¥12.50');
  assert.equal(formatRuntime.test.formatBalanceCents(10), '¥0.10');
  assert.equal(formatRuntime.test.formatBalanceCents(0), '¥0.00');
  assert.equal(formatRuntime.test.formatBalanceCents(-3), '-¥0.03');

  let resolveLoadingAccount;
  const loadingRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: () => new Promise((resolve) => {
      resolveLoadingAccount = resolve;
    }),
  });
  assert.equal(loadingRuntime.creditDisplay.textContent, '--');
  resolveLoadingAccount(createAccountResponse(10));
  await wait();
  assert.equal(loadingRuntime.creditDisplay.textContent, '¥0.10');

  const failedAccountRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => {
      throw new Error('network unavailable');
    },
  });
  await wait();
  assert.equal(
    failedAccountRuntime.creditDisplay.textContent,
    '加载失败'
  );

  for (const character of formatRuntime.test.characters) {
    const callRequests = [];
    const runtime = loadHomeRuntime({
      storageEntries: phoneStorage,
      fetchImpl: async (pathname, requestOptions) => {
        if (pathname === '/api/me') {
          return createAccountResponse(1250);
        }
        callRequests.push({ pathname, requestOptions });
        return createJsonResponse(201, {
          call: {
            id: `business-${character.key}`,
          },
        });
      },
    });
    await wait();
    await runtime.test.selectCharacter(character.key, 'test');
    assert.equal(await runtime.test.handleStartConversation(), true);
    assert.equal(callRequests.length, 1);
    assert.equal(callRequests[0].pathname, '/api/calls');
    assert.deepEqual(
      JSON.parse(callRequests[0].requestOptions.body),
      { roleSlug: character.key }
    );
    const navigationUrl = new URL(runtime.locationAssignments.at(-1));
    assert.equal(
      navigationUrl.searchParams.get('characterKey'),
      character.realtimeCharacterKey
    );
    assert.equal(
      navigationUrl.searchParams.get('businessCallId'),
      `business-${character.key}`
    );
    assert.equal(runtime.test.getAccountBalanceCents(), 1250);
    assert.equal(runtime.test.getIsStartingCall(), true);
  }

  const insufficientRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async (pathname) => (
      pathname === '/api/me'
        ? createAccountResponse(9)
        : createJsonResponse(409, {
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: 'internal message is not shown',
          },
        })
    ),
  });
  await wait();
  const insufficientNavigationCount =
    insufficientRuntime.locationAssignments.length;
  assert.equal(
    await insufficientRuntime.test.handleStartConversation(),
    false
  );
  assert.equal(
    insufficientRuntime.locationAssignments.length,
    insufficientNavigationCount
  );
  assert.equal(
    insufficientRuntime.toast.textContent,
    '账户话费不足，无法开始通话'
  );
  assert.equal(insufficientRuntime.rechargePanel.hidden, false);
  assert.equal(insufficientRuntime.test.getAccountBalanceCents(), 9);
  assert.equal(insufficientRuntime.callButton.disabled, false);

  const otherConflictRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async (pathname) => (
      pathname === '/api/me'
        ? createAccountResponse(1250)
        : createJsonResponse(409, {
          error: {
            code: 'ROLE_UNAVAILABLE',
            message: 'internal message is not shown',
          },
        })
    ),
  });
  await wait();
  assert.equal(
    await otherConflictRuntime.test.handleStartConversation(),
    false
  );
  assert.equal(
    otherConflictRuntime.toast.textContent,
    '该角色暂时无法通话，请选择其他角色'
  );
  assert.equal(otherConflictRuntime.rechargePanel.hidden, true);

  const expiredRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => createJsonResponse(401, {
      error: { code: 'AUTH_REQUIRED' },
    }),
  });
  await wait();
  assert.equal(expiredRuntime.creditDisplay.textContent, '--');
  assert.equal(
    JSON.parse(
      expiredRuntime.localStorage.getItem(AUTH_STORAGE_KEY)
    ).mode,
    'guest'
  );
  assert.equal(
    expiredRuntime.toast.textContent,
    '登录状态已失效，请重新登录'
  );

  let resolveCallRequest;
  let callRequestCount = 0;
  const duplicateRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async (pathname) => {
      if (pathname === '/api/me') {
        return createAccountResponse(1250);
      }
      callRequestCount += 1;
      if (callRequestCount > 1) {
        return createJsonResponse(500, {
          error: { code: 'INTERNAL_ERROR' },
        });
      }
      return new Promise((resolve) => {
        resolveCallRequest = resolve;
      });
    },
  });
  await wait();
  const firstStart = duplicateRuntime.test.handleStartConversation();
  const secondStart = duplicateRuntime.test.handleStartConversation();
  assert.equal(callRequestCount, 1);
  assert.equal(await secondStart, false);
  assert.equal(duplicateRuntime.callButton.disabled, true);
  assert.equal(duplicateRuntime.callActionLabel.textContent, '正在接通…');
  resolveCallRequest(createJsonResponse(500, {
    error: { code: 'INTERNAL_ERROR' },
  }));
  assert.equal(await firstStart, false);
  assert.equal(duplicateRuntime.callButton.disabled, false);
  assert.equal(duplicateRuntime.callActionLabel.textContent, '开始通话');
  assert.equal(
    await duplicateRuntime.test.handleStartConversation(),
    false
  );
  assert.equal(callRequestCount, 2);

  let networkCallCount = 0;
  const networkRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async (pathname) => {
      if (pathname === '/api/me') {
        return createAccountResponse(1250);
      }
      networkCallCount += 1;
      throw new Error('network unavailable');
    },
  });
  await wait();
  assert.equal(await networkRuntime.test.handleStartConversation(), false);
  assert.equal(networkCallCount, 1);
  assert.equal(
    networkRuntime.toast.textContent,
    '网络连接失败，请稍后重试'
  );
  assert.equal(networkRuntime.callButton.disabled, false);

  const guestRuntime = loadHomeRuntime({
    storageEntries: {
      [authKey]: JSON.stringify(createAuthState('guest')),
    },
    fetchImpl: async () => {
      throw new Error('guest must not call business APIs');
    },
  });
  assert.equal(await guestRuntime.test.handleStartConversation(), true);
  const guestUrl = new URL(guestRuntime.locationAssignments.at(-1));
  assert.equal(guestUrl.searchParams.has('businessCallId'), false);
  assert.equal(guestRuntime.fetchRequests.length, 0);
}

async function verifyAccountRefreshLifecycle() {
  const phoneStorage = {
    [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
  };

  let currentBalanceCents = 1250;
  const normalReturnRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => createAccountResponse(currentBalanceCents),
  });
  await wait();
  assert.equal(normalReturnRuntime.window.getListenerCount('pageshow'), 1);
  assert.equal(normalReturnRuntime.fetchRequests.length, 1);
  assert.equal(normalReturnRuntime.creditDisplay.textContent, '¥12.50');
  const accountClickHandlerCount =
    normalReturnRuntime.accountSummaryButton.handlers.get('click').length;

  normalReturnRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  await wait();
  assert.equal(normalReturnRuntime.fetchRequests.length, 1);

  currentBalanceCents = 1190;
  normalReturnRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  await wait();
  assert.equal(normalReturnRuntime.fetchRequests.length, 2);
  assert.equal(normalReturnRuntime.creditDisplay.textContent, '¥11.90');
  assert.equal(
    normalReturnRuntime.accountSummaryButton.handlers.get('click').length,
    accountClickHandlerCount
  );

  let bfcacheBalanceCents = 1250;
  const bfcacheRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => createAccountResponse(bfcacheBalanceCents),
  });
  await wait();
  bfcacheRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  await bfcacheRuntime.test.selectCharacter('sunwukong', 'test');
  bfcacheRuntime.rechargeEntry.click();
  bfcacheBalanceCents = 1180;
  bfcacheRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  await wait();
  assert.equal(bfcacheRuntime.fetchRequests.length, 2);
  assert.equal(bfcacheRuntime.creditDisplay.textContent, '¥11.80');
  assert.equal(
    bfcacheRuntime.test.getCurrentCharacterKey(),
    'sunwukong'
  );
  assert.equal(bfcacheRuntime.rechargePanel.hidden, false);

  let resolveConcurrentRefresh;
  let concurrentRequestCount = 0;
  const concurrentRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: () => {
      concurrentRequestCount += 1;
      if (concurrentRequestCount === 1) {
        return Promise.resolve(createAccountResponse(1250));
      }
      return new Promise((resolve) => {
        resolveConcurrentRefresh = resolve;
      });
    },
  });
  await wait();
  concurrentRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  concurrentRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  const activeRefreshPromise =
    concurrentRuntime.test.getAccountLoadPromise();
  concurrentRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  concurrentRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  assert.equal(concurrentRequestCount, 2);
  assert.equal(
    concurrentRuntime.test.loadAccountState(),
    activeRefreshPromise
  );
  resolveConcurrentRefresh(createAccountResponse(1170));
  await activeRefreshPromise;
  assert.equal(concurrentRuntime.creditDisplay.textContent, '¥11.70');
  assert.equal(concurrentRuntime.test.getAccountLoadPromise(), null);

  let shouldFailRefresh = false;
  const retainedBalanceRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => {
      if (shouldFailRefresh) {
        throw new Error('network unavailable');
      }
      return createAccountResponse(1250);
    },
  });
  await wait();
  retainedBalanceRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  shouldFailRefresh = true;
  retainedBalanceRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  await wait();
  assert.equal(retainedBalanceRuntime.creditDisplay.textContent, '¥12.50');
  assert.equal(
    retainedBalanceRuntime.toast.textContent,
    '话费刷新失败，请稍后重试'
  );

  const initialFailureRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => {
      throw new Error('initial account request failed');
    },
  });
  await wait();
  assert.equal(initialFailureRuntime.creditDisplay.textContent, '加载失败');

  for (const expiredStatus of [401, 403]) {
    let expireOnRefresh = false;
    const expiredRuntime = loadHomeRuntime({
      storageEntries: phoneStorage,
      fetchImpl: async () => (
        expireOnRefresh
          ? createJsonResponse(expiredStatus, {
            error: { code: 'AUTH_REQUIRED' },
          })
          : createAccountResponse(1250)
      ),
    });
    await wait();
    expiredRuntime.window.dispatch('pageshow', {
      persisted: false,
    });
    expireOnRefresh = true;
    expiredRuntime.window.dispatch('pageshow', {
      persisted: true,
    });
    await wait();
    assert.equal(expiredRuntime.creditDisplay.textContent, '--');
    assert.equal(expiredRuntime.accountPrimary.textContent, '游客用户');
    assert.equal(
      JSON.parse(
        expiredRuntime.localStorage.getItem(AUTH_STORAGE_KEY)
      ).mode,
      'guest'
    );
  }

  const guestRuntime = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('guest')),
    },
    fetchImpl: async () => {
      throw new Error('guest account request must not run');
    },
  });
  guestRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  guestRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  await wait();
  assert.equal(guestRuntime.fetchRequests.length, 0);
  assert.equal(guestRuntime.creditDisplay.textContent, '--');

  let resolveStaleAccount;
  const staleRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: () => new Promise((resolve) => {
      resolveStaleAccount = resolve;
    }),
  });
  staleRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  staleRuntime.localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify(createAuthState('guest'))
  );
  staleRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  resolveStaleAccount(createAccountResponse(9999));
  await wait();
  assert.equal(staleRuntime.creditDisplay.textContent, '--');
  assert.equal(staleRuntime.test.getAccountBalanceCents(), null);

  let failedReturnRequestCount = 0;
  const failedReturnRuntime = loadHomeRuntime({
    storageEntries: phoneStorage,
    fetchImpl: async () => {
      failedReturnRequestCount += 1;
      return createAccountResponse(1250);
    },
  });
  await wait();
  failedReturnRuntime.window.dispatch('pageshow', {
    persisted: false,
  });
  failedReturnRuntime.window.dispatch('pageshow', {
    persisted: true,
  });
  await wait();
  assert.equal(failedReturnRequestCount, 2);
  assert.equal(failedReturnRuntime.creditDisplay.textContent, '¥12.50');
}

function verifyStaticUiAndPrivacyBoundaries() {
  const authHtml = fs.readFileSync(AUTH_HTML_PATH, 'utf8');
  const homeHtml = fs.readFileSync(HOME_HTML_PATH, 'utf8');
  const homeCss = fs.readFileSync(HOME_CSS_PATH, 'utf8');
  const homeJs = fs.readFileSync(HOME_JS_PATH, 'utf8');
  const avatar = fs.readFileSync(AVATAR_PATH, 'utf8');
  const callJs = fs.readFileSync(
    path.join(PROJECT_DIR, 'public/realtime_call_ui.js'),
    'utf8'
  );
  const micJs = fs.readFileSync(
    path.join(PROJECT_DIR, 'public/doubao_mic_single_turn.js'),
    'utf8'
  );

  assert.match(authHtml, /autocomplete="tel"/);
  assert.match(authHtml, /autocomplete="one-time-code"/);
  assert.match(authHtml, /inputmode="numeric"/);
  assert.match(authHtml, /演示验证码：<span>123456<\/span>/);
  assert.match(homeHtml, /左右滑动切换角色/);
  assert.doesNotMatch(
    `${homeHtml}\n${homeCss}\n${homeJs}`,
    /(?:^|[^\w-])(?:character-switch|character-picker|role-list|role-card)(?:$|[^\w-])/
  );
  assert.match(homeHtml, /充值前请先登录/);
  assert.match(homeHtml, /登录后才能充值和保存账户信息。游客仍可继续浏览和通话。/);
  assert.match(homeHtml, /class="account-summary-button"/);
  assert.match(homeHtml, /class="account-profile-overlay prototype-overlay"/);
  assert.match(homeJs, /const TRUSTED_PENDING_ACTIONS = new Set\(\['recharge', 'profile'\]\)/);
  assert.match(homeJs, /function handleRechargeConfirmation\(\) \{[\s\S]*?getValidatedAuthState\(\)/);
  assert.doesNotMatch(callJs, /phoneMasked|vipTier|authenticated/);
  assert.doesNotMatch(micJs, /phoneMasked|vipTier/);

  assert.match(avatar, /viewBox="0 0 128 128"/);
  assert.match(avatar, />福<\/text>/);
  assert.doesNotMatch(avatar, /<script|<foreignObject|\son[a-z]+\s*=|\shref\s*=/i);
}

async function main() {
  await verifyAuthValidationAndPrivacy();
  await verifyHomeGuardRechargeAndAccount();
  await verifyRealAccountAndCallFlow();
  await verifyAccountRefreshLifecycle();
  verifyStaticUiAndPrivacyBoundaries();

  process.stdout.write('auth_guest_recharge_gate_test: PASS\n');
  process.stdout.write(
    'verified=phone-errors,code-errors,consent,masked-storage,guest,'
      + 'strict-schema,home-guard,recharge-gate,direct-confirm,'
      + 'phone-recharge,pending-once,account-summary,profile,logout,'
      + 'profile-return,real-balance,currency-format,call-create,'
      + 'insufficient-balance,error-separation,expired-session,'
      + 'network-error,duplicate-lock,eight-role-business-call-id,'
      + 'guest-call,account-pageshow-once,normal-return-refresh,'
      + 'bfcache-refresh,account-single-flight,refresh-retains-balance,'
      + 'initial-refresh-error,refresh-expired-session,guest-restore,'
      + 'stale-response-guard,role-state-preserved,overlay-preserved,'
      + 'failed-return-balance,privacy,avatar-svg\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
