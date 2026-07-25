'use strict';

(() => {
  const AUTH_STORAGE_KEY = 'companion_auth_state_v1';
  const PENDING_ACTION_STORAGE_KEY = 'companion_pending_action_v1';
  const DEMO_CODE = '123456';
  const PHONE_PATTERN = /^1[3-9]\d{9}$/;
  const AUTH_STATE_KEYS = Object.freeze([
    'version',
    'mode',
    'authenticated',
    'phoneMasked',
    'createdAt',
  ]);
  const TRUSTED_PENDING_ACTIONS = new Set(['recharge', 'profile']);

  const form = document.querySelector('.phone-auth-form');
  const phoneInput = document.querySelector('#phone-input');
  const codeInput = document.querySelector('#code-input');
  const consentCheckbox = document.querySelector('.consent-checkbox');
  const phoneError = document.querySelector('#phone-error');
  const codeError = document.querySelector('#code-error');
  const consentError = document.querySelector('.consent-error');
  const sendCodeButton = document.querySelector('.send-code-button');
  const guestEntryButton = document.querySelector('.guest-entry-button');
  const authStatus = document.querySelector('.auth-status');

  let countdownTimer = null;
  let countdownRemaining = 0;

  function isStrictAuthState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const keys = Object.keys(value).sort();
    const expectedKeys = [...AUTH_STATE_KEYS].sort();
    if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])) {
      return false;
    }
    if (value.version !== 1
      || !Number.isFinite(value.createdAt)
      || !Number.isInteger(value.createdAt)) {
      return false;
    }
    const isGuest = value.mode === 'guest'
      && value.authenticated === false
      && value.phoneMasked === '';
    const isPhone = value.mode === 'phone'
      && value.authenticated === true
      && /^1[3-9]\d\*{4}\d{4}$/.test(value.phoneMasked);
    return isGuest || isPhone;
  }

  function getValidatedAuthState() {
    const rawState = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (rawState === null) {
      return null;
    }
    try {
      const parsedState = JSON.parse(rawState);
      if (isStrictAuthState(parsedState)) {
        return parsedState;
      }
    } catch {
      // A damaged local prototype state is treated as uninitialized.
    }
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }

  function getTrustedPendingAction() {
    const pendingAction = window.localStorage.getItem(
      PENDING_ACTION_STORAGE_KEY
    );
    if (TRUSTED_PENDING_ACTIONS.has(pendingAction)) {
      return pendingAction;
    }
    if (pendingAction !== null) {
      window.localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
    }
    return null;
  }

  function getTrustedReturnActionFromQuery() {
    const query = new URLSearchParams(window.location.search);
    if (query.get('mode') !== 'phone') {
      return null;
    }
    const returnAction = query.get('returnAction');
    return TRUSTED_PENDING_ACTIONS.has(returnAction)
      ? returnAction
      : null;
  }

  function savePendingActionFromQuery() {
    const returnAction = getTrustedReturnActionFromQuery();
    if (!returnAction) {
      return;
    }
    window.localStorage.setItem(
      PENDING_ACTION_STORAGE_KEY,
      returnAction
    );
  }

  function saveAuthState(state) {
    if (!isStrictAuthState(state)) {
      throw new Error('拒绝保存无效的本地身份状态');
    }
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify(state)
    );
  }

  function renderFieldError(element, message = '') {
    if (!element) {
      return;
    }
    element.textContent = message;
    element.hidden = message === '';
  }

  function clearFormErrors() {
    renderFieldError(phoneError);
    renderFieldError(codeError);
    renderFieldError(consentError);
    phoneInput.removeAttribute('aria-invalid');
    codeInput.removeAttribute('aria-invalid');
    consentCheckbox.removeAttribute('aria-invalid');
  }

  function validatePhone() {
    const phone = phoneInput.value.trim();
    if (!PHONE_PATTERN.test(phone)) {
      renderFieldError(phoneError, '请输入正确的11位手机号');
      phoneInput.setAttribute('aria-invalid', 'true');
      return null;
    }
    renderFieldError(phoneError);
    phoneInput.removeAttribute('aria-invalid');
    return phone;
  }

  function validateLoginForm() {
    clearFormErrors();
    const phone = validatePhone();
    let isValid = phone !== null;

    if (codeInput.value.trim() !== DEMO_CODE) {
      renderFieldError(codeError, '验证码不正确，请输入演示验证码123456');
      codeInput.setAttribute('aria-invalid', 'true');
      isValid = false;
    }
    if (!consentCheckbox.checked) {
      renderFieldError(
        consentError,
        '请先阅读并同意本地原型使用说明'
      );
      consentCheckbox.setAttribute('aria-invalid', 'true');
      isValid = false;
    }
    return isValid ? phone : null;
  }

  function renderCountdown() {
    if (countdownRemaining <= 0) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
      sendCodeButton.disabled = false;
      sendCodeButton.textContent = '发送验证码';
      return;
    }
    sendCodeButton.disabled = true;
    sendCodeButton.textContent = `${countdownRemaining}秒后重发`;
  }

  function handleSendCode() {
    if (!validatePhone()) {
      phoneInput.focus();
      return;
    }
    authStatus.textContent = '演示验证码为123456';
    countdownRemaining = 60;
    renderCountdown();
    countdownTimer = window.setInterval(() => {
      countdownRemaining -= 1;
      renderCountdown();
    }, 1000);
  }

  function handlePhoneLogin(event) {
    event.preventDefault();
    const phone = validateLoginForm();
    if (!phone) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) {
        firstInvalid.focus();
      }
      return;
    }

    const phoneMasked = `${phone.slice(0, 3)}****${phone.slice(-4)}`;
    saveAuthState({
      version: 1,
      mode: 'phone',
      authenticated: true,
      phoneMasked,
      createdAt: Date.now(),
    });
    const trustedReturnAction = getTrustedReturnActionFromQuery()
      || getTrustedPendingAction();
    if (trustedReturnAction) {
      window.localStorage.setItem(
        PENDING_ACTION_STORAGE_KEY,
        trustedReturnAction
      );
    }
    codeInput.value = '';
    window.location.assign('./home.html');
  }

  function handleGuestEntry() {
    saveAuthState({
      version: 1,
      mode: 'guest',
      authenticated: false,
      phoneMasked: '',
      createdAt: Date.now(),
    });
    window.localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
    codeInput.value = '';
    window.location.assign('./home.html');
  }

  function initializeAuthPage() {
    getValidatedAuthState();
    getTrustedPendingAction();
    savePendingActionFromQuery();

    form.addEventListener('submit', handlePhoneLogin);
    sendCodeButton.addEventListener('click', handleSendCode);
    guestEntryButton.addEventListener('click', handleGuestEntry);

    const query = new URLSearchParams(window.location.search);
    if (query.get('mode') === 'phone') {
      phoneInput.focus();
    }
  }

  /*
   * Production must issue and validate codes on the server, enforce rate
   * limits, create a secure server session, and re-authorize payment actions.
   * This local prototype sends no SMS and performs no real payment.
   */
  initializeAuthPage();
})();
