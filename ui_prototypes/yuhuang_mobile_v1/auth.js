'use strict';

(() => {
  const AUTH_STORAGE_KEY = 'companion_auth_state_v1';
  const PENDING_ACTION_STORAGE_KEY = 'companion_pending_action_v1';
  const PHONE_PATTERN = /^1[3-9]\d{9}$/;
  const AUTH_STATE_KEYS = Object.freeze([
    'version',
    'mode',
    'authenticated',
    'phoneMasked',
    'createdAt',
  ]);
  const TRUSTED_PENDING_ACTIONS = new Set([
    'recharge',
    'profile',
    'fortune',
  ]);

  const form = document.querySelector('.phone-auth-form');
  const phoneInput = document.querySelector('#phone-input');
  const codeInput = document.querySelector('#code-input');
  const consentCheckbox = document.querySelector('.consent-checkbox');
  const phoneError = document.querySelector('#phone-error');
  const codeError = document.querySelector('#code-error');
  const consentError = document.querySelector('.consent-error');
  const sendCodeButton = document.querySelector('.send-code-button');
  const guestEntryButton = document.querySelector('.guest-entry-button');
  const phoneLoginButton = document.querySelector('.phone-login-button');
  const authStatus = document.querySelector('.auth-status');
  const mockCodeNote = document.querySelector('.mock-code-note');
  const mockCodeValue = mockCodeNote
    ? mockCodeNote.querySelector('span')
    : null;

  let countdownTimer = null;
  let countdownRemaining = 0;
  let isAuthenticating = false;
  let isSendingCode = false;
  let activeChallengeId = '';
  let challengePhone = '';

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

    if (!activeChallengeId) {
      renderFieldError(codeError, '请先获取短信验证码');
      codeInput.setAttribute('aria-invalid', 'true');
      isValid = false;
    } else if (!/^\d{6}$/.test(codeInput.value.trim())) {
      renderFieldError(codeError, '请输入6位数字验证码');
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

  async function handleSendCode() {
    if (isSendingCode || isAuthenticating || countdownRemaining > 0) {
      return;
    }
    const phone = validatePhone();
    if (!phone) {
      phoneInput.focus();
      return;
    }
    isSendingCode = true;
    sendCodeButton.disabled = true;
    sendCodeButton.textContent = '正在发送';
    authStatus.textContent = '正在发送验证码，请稍候';
    renderFieldError(codeError);
    try {
      const { response, responseBody } = await requestAuth(
        '/api/auth/sms/send',
        { phone }
      );
      if (
        response.status !== 201
        || !responseBody
        || typeof responseBody.challengeId !== 'string'
      ) {
        const errorCode = responseBody
          && responseBody.error
          && responseBody.error.code;
        authStatus.textContent = friendlySmsError(errorCode);
        return;
      }
      activeChallengeId = responseBody.challengeId;
      challengePhone = phone;
      if (mockCodeNote && mockCodeValue) {
        const mockCode = responseBody.mockCode;
        mockCodeValue.textContent = typeof mockCode === 'string'
          ? mockCode
          : '';
        mockCodeNote.hidden = typeof mockCode !== 'string';
      }
      countdownRemaining = Number.isInteger(responseBody.resendAfterSeconds)
        ? responseBody.resendAfterSeconds
        : 60;
      renderCountdown();
      countdownTimer = window.setInterval(() => {
        countdownRemaining -= 1;
        renderCountdown();
      }, 1000);
      authStatus.textContent = '验证码已发送，请查收短信';
    } catch {
      authStatus.textContent = '网络连接失败，请稍后重试';
    } finally {
      isSendingCode = false;
      if (countdownRemaining <= 0) {
        sendCodeButton.disabled = false;
        sendCodeButton.textContent = '发送验证码';
      }
    }
  }

  function friendlySmsError(code) {
    const messages = {
      SMS_DISABLED: '短信登录暂未开启，请稍后再试',
      SMS_PHONE_HOURLY_LIMIT: '这个手机号请求次数较多，请稍后再试',
      SMS_PHONE_DAILY_LIMIT: '今日验证码次数已用完，请明天再试',
      SMS_IP_HOURLY_LIMIT: '当前网络请求次数较多，请稍后再试',
      SMS_RESEND_TOO_SOON: '验证码已发送，请稍候再重新获取',
      SMS_SEND_FAILED: '短信发送失败，请检查手机号后重试',
    };
    return messages[code] || '暂时无法发送验证码，请稍后重试';
  }

  function setAuthenticating(authenticating) {
    isAuthenticating = authenticating;
    if (phoneLoginButton) {
      phoneLoginButton.disabled = authenticating;
    }
    guestEntryButton.disabled = authenticating;
    sendCodeButton.disabled = authenticating
      || isSendingCode
      || countdownRemaining > 0;
  }

  function friendlyLoginError(code) {
    const messages = {
      INVALID_VERIFICATION_CODE: '验证码不正确，请核对后重新输入',
      SMS_CHALLENGE_EXPIRED: '验证码已过期，请重新获取',
      SMS_CHALLENGE_LOCKED: '错误次数过多，请重新获取验证码',
      SMS_CHALLENGE_CONSUMED: '这个验证码已经使用过，请重新获取',
      SMS_CHALLENGE_INVALIDATED: '已发送新验证码，请输入最新短信中的验证码',
      SMS_CHALLENGE_SEND_FAILED: '上次短信发送失败，请重新获取验证码',
      SMS_DISABLED: '短信登录暂未开启，请稍后再试',
      SMS_CHECK_FAILED: '暂时无法核验验证码，请稍后重试',
    };
    return messages[code] || '暂时无法登录，请稍后重试';
  }

  async function requestAuth(pathname, requestBody) {
    if (typeof window.fetch !== 'function') {
      throw new TypeError('fetch is unavailable');
    }
    const response = await window.fetch(pathname, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(requestBody === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(requestBody === undefined
        ? {}
        : { body: JSON.stringify(requestBody) }),
    });
    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
    return {
      response,
      responseBody,
    };
  }

  async function handlePhoneLogin(event) {
    event.preventDefault();
    if (isAuthenticating) {
      return;
    }
    const phone = validateLoginForm();
    if (!phone) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) {
        firstInvalid.focus();
      }
      return;
    }

    setAuthenticating(true);
    authStatus.textContent = '正在登录…';
    try {
      const { response, responseBody } = await requestAuth(
        '/api/auth/login',
        {
          phone,
          challengeId: activeChallengeId,
          code: codeInput.value.trim(),
        }
      );
      const phoneMasked = responseBody
        && responseBody.profile
        && responseBody.profile.phoneMasked;
      if (
        !response.ok
        || !responseBody
        || responseBody.authMode !== 'sms_phone'
        || !responseBody.principal
        || responseBody.principal.type !== 'user'
        || typeof phoneMasked !== 'string'
      ) {
        const errorCode = responseBody
          && responseBody.error
          && responseBody.error.code;
        authStatus.textContent = friendlyLoginError(errorCode);
        return;
      }

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
      if (trustedReturnAction === 'fortune') {
        const characterKey = new URLSearchParams(
          window.location.search
        ).get('characterKey');
        const safeCharacterKey = [
          'yuhuang',
          'sunwukong',
          'guanyin',
          'caishen',
          'rulai',
          'zhubajie',
          'shawujing',
          'tangseng',
        ].includes(characterKey)
          ? characterKey
          : 'guanyin';
        window.localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
        window.location.assign(
          `./fortune.html?characterKey=${encodeURIComponent(safeCharacterKey)}`
        );
      } else {
        window.location.assign('./choice.html');
      }
    } catch {
      authStatus.textContent = '网络连接失败，请稍后重试';
    } finally {
      setAuthenticating(false);
    }
  }

  async function handleGuestEntry() {
    if (isAuthenticating) {
      return;
    }
    setAuthenticating(true);
    authStatus.textContent = '正在进入游客体验…';
    try {
      const { response, responseBody } = await requestAuth(
        '/api/auth/guest'
      );
      if (
        response.status !== 201
        || !responseBody
        || responseBody.authMode !== 'development_guest'
        || !responseBody.principal
        || responseBody.principal.type !== 'guest'
      ) {
        authStatus.textContent = '暂时无法进入游客体验，请稍后重试';
        return;
      }
      saveAuthState({
        version: 1,
        mode: 'guest',
        authenticated: false,
        phoneMasked: '',
        createdAt: Date.now(),
      });
      window.localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
      codeInput.value = '';
      window.location.assign('./choice.html');
    } catch {
      authStatus.textContent = '网络连接失败，请稍后重试';
    } finally {
      setAuthenticating(false);
    }
  }

  function initializeAuthPage() {
    getValidatedAuthState();
    getTrustedPendingAction();
    savePendingActionFromQuery();

    form.addEventListener('submit', handlePhoneLogin);
    sendCodeButton.addEventListener('click', handleSendCode);
    guestEntryButton.addEventListener('click', handleGuestEntry);
    phoneInput.addEventListener('input', () => {
      const phone = phoneInput.value.trim();
      if (challengePhone && phone !== challengePhone) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        countdownRemaining = 0;
        activeChallengeId = '';
        challengePhone = '';
        codeInput.value = '';
        sendCodeButton.disabled = false;
        sendCodeButton.textContent = '发送验证码';
        if (mockCodeNote) {
          mockCodeNote.hidden = true;
        }
        renderFieldError(codeError);
        authStatus.textContent = '手机号已修改，请重新获取验证码';
      }
    });

    const query = new URLSearchParams(window.location.search);
    if (query.get('mode') === 'phone') {
      phoneInput.focus();
    }
  }

  initializeAuthPage();
  if (
    window.XianBanStartup
    && typeof window.XianBanStartup.markAppReady === 'function'
  ) {
    window.XianBanStartup.markAppReady();
  }
})();
