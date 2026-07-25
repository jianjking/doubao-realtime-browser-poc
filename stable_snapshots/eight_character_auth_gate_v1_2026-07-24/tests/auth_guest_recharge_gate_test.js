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
    for (const handler of this.handlers.get(eventName) || []) {
      handler(event);
    }
  }

  click() {
    this.dispatch('click');
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
  const window = {
    clearInterval() {},
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
    guestEntryButton,
    localStorage,
    locationAssignments,
    phoneError,
    phoneInput,
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
      getActiveOverlay: () => activeOverlay,
      getCurrentCharacterKey: () => currentCharacterKey,
      getPrototypeCreditBalance: () => prototypeCreditBalance,
      getValidatedAuthState,
      handleRechargeConfirmation,
      isPhoneAuthenticated,
      openAccountProfile,
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
    clearTimeout,
    localStorage,
    location: {
      assign(url) {
        locationAssignments.push(url);
      },
    },
    setTimeout,
  };
  const context = {
    Element: FakeElement,
    Image: FakeImage,
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
    cancelLogout,
    confirmLogout,
    document,
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
    test: context.__homeTest,
  };
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function verifyAuthValidationAndPrivacy() {
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
  login.form.dispatch('submit');
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

  const guest = loadAuthRuntime();
  guest.guestEntryButton.click();
  const guestState = JSON.parse(
    guest.localStorage.getItem(AUTH_STORAGE_KEY)
  );
  assert.equal(guestState.mode, 'guest');
  assert.equal(guestState.authenticated, false);
  assert.equal(guestState.phoneMasked, '');
  assert.deepEqual(guest.locationAssignments, ['./home.html']);

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
  assert.equal(guest.test.getPrototypeCreditBalance(), 12.50);

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
  assert.equal(guestCall.locationAssignments.at(-1), 'http://127.0.0.1:3001/');

  const phone = loadHomeRuntime({
    storageEntries: {
      [AUTH_STORAGE_KEY]: JSON.stringify(createAuthState('phone')),
    },
  });
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
  assert.equal(phone.test.getPrototypeCreditBalance(), 22.50);

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
  assert.equal(refreshed.test.getPrototypeCreditBalance(), 12.50);

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
  verifyAuthValidationAndPrivacy();
  await verifyHomeGuardRechargeAndAccount();
  verifyStaticUiAndPrivacyBoundaries();

  process.stdout.write('auth_guest_recharge_gate_test: PASS\n');
  process.stdout.write(
    'verified=phone-errors,code-errors,consent,masked-storage,guest,'
      + 'strict-schema,home-guard,recharge-gate,direct-confirm,'
      + 'phone-recharge,pending-once,account-summary,profile,logout,'
      + 'profile-return,privacy,avatar-svg\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
