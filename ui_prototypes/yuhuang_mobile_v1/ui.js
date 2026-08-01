'use strict';

(() => {
  const REALTIME_PAGE_URL = 'http://127.0.0.1:3001/';
  const HOME_PATH = '/ui_prototypes/yuhuang_mobile_v1/home.html';
  const ACCOUNT_API_URL = '/api/me';
  const CALL_API_URL = '/api/calls';
  const ROLE_CATALOG_API_URL = '/api/roles';
  const DEV_RECHARGE_API_URL = '/api/dev/recharge';
  const MAX_DEV_RECHARGE_AMOUNT_CENTS = 100000;
  const AUTH_STORAGE_KEY = 'companion_auth_state_v1';
  const PENDING_ACTION_STORAGE_KEY = 'companion_pending_action_v1';
  const TOAST_DURATION_MS = 3200;
  const CUSTOM_AMOUNT_RANGE_ERROR = '请输入0.01至1000元之间的金额';
  const CUSTOM_AMOUNT_PRECISION_ERROR = '充值金额最多保留两位小数';
  const CUSTOM_AMOUNT_SUMMARY_ERROR = '请输入有效的充值金额';
  const SWIPE_MIN_DISTANCE_PX = 40;
  const SWIPE_DIRECTION_RATIO = 1.1;
  const AUTH_STATE_KEYS = Object.freeze([
    'version',
    'mode',
    'authenticated',
    'phoneMasked',
    'createdAt',
  ]);
  const TRUSTED_PENDING_ACTIONS = new Set(['recharge', 'profile']);

  const characters = [
    {
      key: 'yuhuang',
      name: '玉皇大帝',
      imageSrc: './assets/characters/yuhuang/yuhuang-home-hero-v1.png',
      imageAlt: '玉皇大帝角色主视觉',
      motto: '端坐凌霄，听您慢慢说',
      readyText: '玉帝已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'yuhuang',
    },
    {
      key: 'sunwukong',
      name: '孙悟空',
      imageSrc:
        './assets/characters/sunwukong/sunwukong-home-hero-v2.png',
      imageAlt: '孙悟空手持金箍棒站在云海山峦间的角色主视觉',
      motto: '火眼金睛，陪您轻松聊聊',
      readyText: '孙悟空已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'sunwukong',
    },
    {
      key: 'guanyin',
      name: '观音菩萨',
      imageSrc: './assets/characters/guanyin/guanyin-home-hero-v1.png',
      imageAlt: '观音菩萨手持杨柳枝端坐莲台的角色主视觉',
      motto: '慈心静听，陪您安心说',
      readyText: '观音已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'guanyin',
    },
    {
      key: 'caishen',
      name: '财神爷',
      imageSrc: './assets/characters/caishen/caishen-home-hero-v1.png',
      imageAlt: '财神爷手捧金元宝站在祥云间的角色主视觉',
      motto: '笑迎福气，陪您聊聊家常',
      readyText: '财神爷已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'caishen',
    },
    {
      key: 'rulai',
      name: '如来佛祖',
      imageSrc: './assets/characters/rulai/rulai-home-hero-v1.png',
      imageAlt: '如来佛祖端坐金色莲台的角色主视觉',
      motto: '心平气和，听您慢慢说',
      readyText: '如来佛祖已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'rulai',
    },
    {
      key: 'zhubajie',
      name: '猪八戒',
      imageSrc:
        './assets/characters/zhubajie/zhubajie-home-hero-v1.png',
      imageAlt: '猪八戒肩扛九齿钉耙站在高老庄云海间的角色主视觉',
      motto: '乐呵相伴，陪您说说笑笑',
      readyText: '猪八戒已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'zhubajie',
    },
    {
      key: 'shawujing',
      name: '沙悟净',
      imageSrc:
        './assets/characters/shawujing/shawujing-home-hero-v1.png',
      imageAlt: '沙悟净手持月牙铲站在流沙河畔的角色主视觉',
      motto: '踏实守候，陪您慢慢聊',
      readyText: '沙悟净已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'shawujing',
    },
    {
      key: 'tangseng',
      name: '唐僧',
      imageSrc:
        './assets/characters/tangseng/tangseng-home-hero-v1.png',
      imageAlt: '唐僧身披袈裟手持锡杖站在大唐圣地的角色主视觉',
      motto: '温和耐心，陪您安心说',
      readyText: '唐僧已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'tangseng',
    },
  ];
  const charactersByKey = new Map(
    characters.map((character) => [character.key, character])
  );
  const REALTIME_URLS_BY_CHARACTER_KEY = Object.freeze(
    Object.fromEntries(characters.map((character) => [
      character.key,
      character.key === 'yuhuang'
        ? REALTIME_PAGE_URL
        : `${REALTIME_PAGE_URL}?characterKey=${character.key}`,
    ]))
  );

  function buildRealtimeNavigationUrl(realtimeUrl) {
    if (typeof URL !== 'function'
      || !window.location.origin
      || !window.location.href) {
      return realtimeUrl;
    }
    const returnUrl = new URL(HOME_PATH, window.location.origin).href;
    const callUrl = new URL(realtimeUrl, window.location.href);
    callUrl.searchParams.set('returnUrl', returnUrl);
    return callUrl.href;
  }

  function buildRegisteredRealtimeNavigationUrl({
    realtimeUrl,
    characterKey,
    businessCallId,
  }) {
    const callUrl = new URL(
      buildRealtimeNavigationUrl(realtimeUrl),
      window.location.href
    );
    callUrl.searchParams.set('characterKey', characterKey);
    callUrl.searchParams.set('businessCallId', businessCallId);
    return callUrl.href;
  }
  const characterImagePreloadPromises = new Map();
  const auxiliaryMessages = {
    guide: '点击“开始通话”后，允许使用麦克风，随后直接开口即可。',
    culture: '传统文化内容正在准备中。',
    share: '分享陪伴功能正在准备中。',
  };

  let activeOverlay = null;
  let activeOverlayTrigger = null;
  let toastTimer = null;
  let imageAnimationTimer = null;
  let currentCharacterKey = 'yuhuang';
  let characterSelectionRequestId = 0;
  let swipePointerId = null;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let selectedAmountMode = 'preset';
  let selectedRechargeAmountCents = 1000;
  let selectedRechargeAmountDisplay = '10';
  let selectedPaymentMethod = 'wechat';
  let selectedPaymentName = '微信支付';
  let accountBalanceCents = null;
  let accountBalanceState = 'loading';
  let accountLoadPromise = null;
  let accountLoadRequestId = 0;
  let hasSeenInitialPageShow = false;
  let currentAuthState = null;
  let sessionAuthState = 'loading';
  let isStartingCall = false;
  let isSubmittingRecharge = false;
  let roleCatalogState = 'loading';
  let roleCatalogLoadPromise = null;
  let rolePricingByKey = new Map();

  const homePage = document.querySelector('.app-shell');
  const homeTitle = document.querySelector('.top-controls h1');
  const sceneImage = document.querySelector('.scene-image');
  const characterStage = document.querySelector('.character-stage');
  const characterMotto = document.querySelector('.character-motto');
  const characterReadyText = document.querySelector(
    '[data-character-ready-text]'
  );
  const characterStatusDetail = document.querySelector(
    '[data-character-status-detail]'
  );
  const rolePosition = document.querySelector(
    '[data-current-role-position]'
  );
  const rolePricingTrigger = document.querySelector(
    '.role-pricing-trigger'
  );
  const rolePricingOverlay = document.querySelector(
    '.role-pricing-overlay'
  );
  const rolePricingName = document.querySelector(
    '[data-role-pricing-name]'
  );
  const rolePricingMinutePrice = document.querySelector(
    '[data-role-pricing-minute-price]'
  );
  const rolePricingUnitSeconds = document.querySelector(
    '[data-role-pricing-unit-seconds]'
  );
  const rolePricingRoundingSeconds = document.querySelector(
    '[data-role-pricing-rounding-seconds]'
  );
  const rolePricingRoundingSecondsCopy = document.querySelector(
    '[data-role-pricing-rounding-seconds-copy]'
  );
  const accountSummaryButton = document.querySelector(
    '.account-summary-button'
  );
  const accountPrimary = document.querySelector('[data-account-primary]');
  const accountSecondary = document.querySelector(
    '[data-account-secondary]'
  );
  const rechargeEntry = document.querySelector('.time-recharge-entry');
  const rechargePanel = document.querySelector('.recharge-panel');
  const rechargeLoginOverlay = document.querySelector(
    '.recharge-login-overlay'
  );
  const accountProfileOverlay = document.querySelector(
    '.account-profile-overlay'
  );
  const logoutConfirmOverlay = document.querySelector(
    '.logout-confirm-overlay'
  );
  const profileMainAction = document.querySelector(
    '[data-profile-main-action]'
  );
  const toast = document.querySelector('.ui-toast');
  const callControl = document.querySelector('.call-control');
  const callButton = document.querySelector('.call-button');
  const callButtonLabel = document.querySelector('.call-button-label');
  const callActionLabel = document.querySelector(
    '[data-call-action-label]'
  );
  const rechargeSelectionSummary = document.querySelector(
    '.recharge-selection-summary'
  );
  const rechargeConfirmButton = document.querySelector(
    '.recharge-confirm'
  );
  const rechargeResult = document.querySelector('.recharge-result');
  const customAmountField = document.querySelector('.custom-amount-field');
  const customAmountInput = document.querySelector('.custom-amount-input');
  const customAmountError = document.querySelector('.custom-amount-error');

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

  function isPhoneAuthenticated(authState = currentAuthState) {
    return Boolean(
      sessionAuthState === 'authenticated'
      && authState
      && authState.mode === 'phone'
      && authState.authenticated === true
    );
  }

  function getAccountPresentation(authState) {
    if (sessionAuthState === 'loading') {
      return {
        primary: '正在确认身份',
        secondary: '请稍候',
        summaryAria: '正在确认登录状态',
        profileSummary: '正在确认登录状态',
        status: '正在加载',
        phone: '正在确认',
        vip: '正在确认',
        recharge: '确认登录状态后可用',
        mainAction: '请稍候',
      };
    }
    if (sessionAuthState === 'error') {
      return {
        primary: '账户状态待确认',
        secondary: '网络异常',
        summaryAria: '账户状态暂时无法确认',
        profileSummary: '账户状态暂时无法确认',
        status: '网络异常',
        phone: '暂时无法确认',
        vip: '暂时无法确认',
        recharge: '请稍后重试',
        mainAction: '稍后重试',
      };
    }
    // VIP is display-only in this local prototype and derives from validated
    // auth mode; no stored vip/isVip/vipLevel field is ever trusted.
    if (isPhoneAuthenticated(authState)) {
      return {
        primary: authState.phoneMasked,
        secondary: '普通会员',
        summaryAria:
          `查看${authState.phoneMasked}的个人信息，当前普通会员`,
        profileSummary: `${authState.phoneMasked} · 普通会员`,
        status: '已登录',
        phone: authState.phoneMasked,
        vip: '普通会员',
        recharge: '可以使用充值演示',
        mainAction: '退出登录',
      };
    }
    return {
      primary: '游客用户',
      secondary: '游客体验',
      summaryAria: '查看游客个人信息，充值前需要登录',
      profileSummary: '游客用户 · 游客体验',
      status: '游客体验',
      phone: '未绑定',
      vip: '游客',
      recharge: '登录后可以充值',
      mainAction: '手机号登录／注册',
    };
  }

  function renderAccountSummary(authState) {
    const presentation = getAccountPresentation(authState);
    if (accountPrimary) {
      accountPrimary.textContent = presentation.primary;
    }
    if (accountSecondary) {
      accountSecondary.textContent = presentation.secondary;
    }
    if (accountSummaryButton) {
      accountSummaryButton.setAttribute(
        'aria-label',
        presentation.summaryAria
      );
    }
  }

  function renderAccountProfile(authState) {
    const presentation = getAccountPresentation(authState);
    const values = {
      '[data-profile-summary]': presentation.profileSummary,
      '[data-profile-status]': presentation.status,
      '[data-profile-phone]': presentation.phone,
      '[data-profile-vip]': presentation.vip,
      '[data-profile-recharge]': presentation.recharge,
    };
    Object.entries(values).forEach(([selector, value]) => {
      const element = document.querySelector(selector);
      if (element) {
        element.textContent = value;
      }
    });
    if (profileMainAction) {
      profileMainAction.textContent = presentation.mainAction;
      profileMainAction.dataset.accountAction = isPhoneAuthenticated(authState)
        ? 'logout'
        : 'profile-login';
      profileMainAction.classList.toggle(
        'is-logout-action',
        isPhoneAuthenticated(authState)
      );
    }
  }

  function openAccountProfile(trigger = accountSummaryButton) {
    const authState = currentAuthState;
    if (!authState) {
      showToast('账户状态暂时无法确认，请稍后重试');
      return;
    }
    renderAccountSummary(authState);
    renderAccountProfile(authState);
    openOverlay(accountProfileOverlay, trigger);
  }

  function closeAccountProfile(restoreFocus = true) {
    closeOverlay(accountProfileOverlay, restoreFocus);
  }

  function openRechargeLoginPrompt(trigger = rechargeEntry) {
    closeOverlay(rechargePanel, false);
    openOverlay(rechargeLoginOverlay, trigger);
  }

  function navigateToPhoneLogin(pendingAction) {
    if (!TRUSTED_PENDING_ACTIONS.has(pendingAction)) {
      return;
    }
    window.localStorage.setItem(
      PENDING_ACTION_STORAGE_KEY,
      pendingAction
    );
    window.location.assign(
      `./index.html?mode=phone&returnAction=${pendingAction}`
    );
  }

  function handleAccountProfileAction() {
    const authState = currentAuthState;
    if (!authState) {
      showToast('账户状态暂时无法确认，请稍后重试');
      return;
    }
    if (isPhoneAuthenticated(authState)) {
      handleLogoutRequest();
      return;
    }
    // The UI source action is profile-login; only trusted "profile" persists.
    navigateToPhoneLogin('profile');
  }

  function handleLogoutRequest() {
    if (!isPhoneAuthenticated()) {
      return;
    }
    openOverlay(logoutConfirmOverlay, accountSummaryButton);
  }

  function cancelLogout() {
    closeOverlay(logoutConfirmOverlay, false);
    openAccountProfile(accountSummaryButton);
  }

  function confirmLogout() {
    if (!isPhoneAuthenticated()) {
      return;
    }
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
    window.location.assign('./index.html');
  }

  function consumePendingAction() {
    const pendingAction = window.localStorage.getItem(
      PENDING_ACTION_STORAGE_KEY
    );
    if (pendingAction !== null) {
      window.localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
    }
    if (!TRUSTED_PENDING_ACTIONS.has(pendingAction)
      || !isPhoneAuthenticated(currentAuthState)) {
      return;
    }
    window.setTimeout(() => {
      if (pendingAction === 'recharge') {
        openOverlay(rechargePanel, rechargeEntry);
      } else if (pendingAction === 'profile') {
        openAccountProfile(accountSummaryButton);
      }
    }, 0);
  }

  function openOverlay(overlay, trigger) {
    if (!overlay) {
      return;
    }

    if (activeOverlay && activeOverlay !== overlay) {
      closeOverlay(activeOverlay, false);
    }

    activeOverlay = overlay;
    activeOverlayTrigger = trigger || null;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-open-overlay');

    if (activeOverlayTrigger) {
      activeOverlayTrigger.setAttribute('aria-expanded', 'true');
    }

    const initialFocusTarget = overlay.querySelector(
      '[data-dialog-initial-focus], [data-close-overlay], button'
    );
    if (initialFocusTarget) {
      initialFocusTarget.focus();
    }
  }

  function closeOverlay(overlay, restoreFocus = true) {
    if (!overlay) {
      return;
    }

    const trigger = overlay === activeOverlay ? activeOverlayTrigger : null;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }

    if (overlay === activeOverlay) {
      activeOverlay = null;
      activeOverlayTrigger = null;
      document.body.classList.remove('has-open-overlay');
    }

    if (restoreFocus && trigger) {
      trigger.focus();
    }
  }

  function closeActiveOverlay() {
    if (activeOverlay) {
      closeOverlay(activeOverlay, true);
    }
  }

  function handleOverlayBackdropClick(event) {
    if (event.target === event.currentTarget) {
      closeActiveOverlay();
    }
  }

  function handleEscapeKey(event) {
    if (event.key === 'Escape' && activeOverlay) {
      event.preventDefault();
      closeActiveOverlay();
    }
  }

  function showToast(message) {
    if (!toast || !message) {
      return;
    }

    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toast.textContent = '';
    }, TOAST_DURATION_MS);
  }

  function formatBalanceCents(balanceCents) {
    if (!Number.isSafeInteger(balanceCents)) {
      throw new TypeError('balanceCents must be a safe integer');
    }
    const absoluteCents = Math.abs(balanceCents);
    const yuan = Math.floor(absoluteCents / 100);
    const cents = String(absoluteCents % 100).padStart(2, '0');
    return `${balanceCents < 0 ? '-' : ''}¥${yuan}.${cents}`;
  }

  function parsePublicRoleCatalog(responseBody) {
    const roles = responseBody && responseBody.roles;
    if (!Array.isArray(roles) || roles.length !== characters.length) {
      return null;
    }

    const nextPricingByKey = new Map();
    for (const role of roles) {
      const pricing = role && role.pricing;
      if (
        !role
        || typeof role !== 'object'
        || Array.isArray(role)
        || typeof role.slug !== 'string'
        || !charactersByKey.has(role.slug)
        || typeof role.displayName !== 'string'
        || role.displayName === ''
        || role.available !== true
        || !pricing
        || typeof pricing !== 'object'
        || Array.isArray(pricing)
        || pricing.currency !== 'CNY'
        || !Number.isSafeInteger(pricing.billingUnitSeconds)
        || pricing.billingUnitSeconds <= 0
        || !Number.isSafeInteger(pricing.pricePerMinuteFen)
        || pricing.pricePerMinuteFen <= 0
        || nextPricingByKey.has(role.slug)
      ) {
        return null;
      }
      nextPricingByKey.set(role.slug, Object.freeze({
        slug: role.slug,
        displayName: role.displayName,
        pricing: Object.freeze({
          currency: pricing.currency,
          billingUnitSeconds: pricing.billingUnitSeconds,
          pricePerMinuteFen: pricing.pricePerMinuteFen,
        }),
      }));
    }
    return nextPricingByKey.size === characters.length
      ? nextPricingByKey
      : null;
  }

  function setRoleCatalogState(state, nextPricingByKey = null) {
    roleCatalogState = state;
    rolePricingByKey = nextPricingByKey || new Map();
    if (state !== 'ready' && activeOverlay === rolePricingOverlay) {
      closeOverlay(rolePricingOverlay, true);
    }
    if (rolePricingTrigger) {
      rolePricingTrigger.disabled = state === 'loading';
      rolePricingTrigger.setAttribute(
        'aria-busy',
        String(state === 'loading')
      );
    }
  }

  function loadPublicRoleCatalog() {
    if (roleCatalogLoadPromise) {
      return roleCatalogLoadPromise;
    }

    setRoleCatalogState('loading');
    const requestPromise = (async () => {
      if (typeof window.fetch !== 'function') {
        setRoleCatalogState('error');
        return false;
      }
      try {
        const response = await window.fetch(ROLE_CATALOG_API_URL, {
          headers: {
            Accept: 'application/json',
          },
        });
        const responseBody = await readJsonResponse(response);
        const nextPricingByKey = response.ok
          ? parsePublicRoleCatalog(responseBody)
          : null;
        if (!nextPricingByKey) {
          setRoleCatalogState('error');
          return false;
        }
        setRoleCatalogState('ready', nextPricingByKey);
        return true;
      } catch {
        setRoleCatalogState('error');
        return false;
      }
    })();
    const trackedPromise = requestPromise.finally(() => {
      if (roleCatalogLoadPromise === trackedPromise) {
        roleCatalogLoadPromise = null;
      }
    });
    roleCatalogLoadPromise = trackedPromise;
    return trackedPromise;
  }

  function renderCurrentRolePricing(rolePricing) {
    if (rolePricingName) {
      rolePricingName.textContent = rolePricing.displayName;
    }
    if (rolePricingMinutePrice) {
      rolePricingMinutePrice.textContent = formatBalanceCents(
        rolePricing.pricing.pricePerMinuteFen
      );
    }
    const billingUnitSeconds =
      String(rolePricing.pricing.billingUnitSeconds);
    if (rolePricingUnitSeconds) {
      rolePricingUnitSeconds.textContent = billingUnitSeconds;
    }
    if (rolePricingRoundingSeconds) {
      rolePricingRoundingSeconds.textContent = billingUnitSeconds;
    }
    if (rolePricingRoundingSecondsCopy) {
      rolePricingRoundingSecondsCopy.textContent = billingUnitSeconds;
    }
  }

  function openCurrentRolePricing() {
    const rolePricing = rolePricingByKey.get(currentCharacterKey);
    if (roleCatalogState === 'loading') {
      showToast('收费信息正在加载，请稍候');
      return false;
    }
    if (!rolePricing) {
      showToast('收费信息暂时无法加载，请稍后重试');
      void loadPublicRoleCatalog();
      return false;
    }
    renderCurrentRolePricing(rolePricing);
    openOverlay(rolePricingOverlay, rolePricingTrigger);
    return true;
  }

  function renderCreditBalance() {
    let displayValue = '--';
    let ariaValue = '加载中';
    if (
      accountBalanceState === 'ready'
      && Number.isSafeInteger(accountBalanceCents)
    ) {
      displayValue = formatBalanceCents(accountBalanceCents);
      ariaValue = displayValue;
    } else if (accountBalanceState === 'error') {
      displayValue = '加载失败';
      ariaValue = '加载失败';
    } else if (accountBalanceState === 'guest') {
      ariaValue = '游客暂不显示话费';
    }

    document.querySelectorAll('[data-current-credit]').forEach((element) => {
      element.textContent = displayValue;
    });
    if (rechargeEntry) {
      rechargeEntry.setAttribute(
        'aria-label',
        `当前话费${ariaValue}，进入话费充值`
      );
    }
  }

  function setAccountBalanceState(state, balanceCents = null) {
    accountBalanceState = state;
    accountBalanceCents = state === 'ready' ? balanceCents : null;
    renderCreditBalance();
  }

  function createGuestAuthState() {
    return {
      version: 1,
      mode: 'guest',
      authenticated: false,
      phoneMasked: '',
      createdAt: Date.now(),
    };
  }

  function createPhoneAuthState(phoneMasked) {
    const cachedAuthState = getValidatedAuthState();
    return {
      version: 1,
      mode: 'phone',
      authenticated: true,
      phoneMasked,
      createdAt: cachedAuthState
        && cachedAuthState.mode === 'phone'
        && cachedAuthState.phoneMasked === phoneMasked
        ? cachedAuthState.createdAt
        : Date.now(),
    };
  }

  function saveCurrentAuthState(authState) {
    currentAuthState = authState;
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify(authState)
    );
    renderAccountSummary(authState);
    renderAccountProfile(authState);
  }

  function setRechargeAccessChecking(checking) {
    if (!rechargeEntry) {
      return;
    }
    rechargeEntry.disabled = checking;
    rechargeEntry.setAttribute('aria-disabled', String(checking));
  }

  function applyGuestSession(authStateName) {
    sessionAuthState = authStateName;
    saveCurrentAuthState(createGuestAuthState());
    setAccountBalanceState('guest');
  }

  function handleExpiredSession() {
    accountLoadRequestId += 1;
    applyGuestSession('unauthenticated');
  }

  async function readJsonResponse(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function handleAccountLoadFailure(hadConfirmedBalance) {
    sessionAuthState = 'error';
    renderAccountSummary(currentAuthState);
    renderAccountProfile(currentAuthState);
    if (hadConfirmedBalance) {
      showToast('话费刷新失败，请稍后重试');
      return;
    }
    setAccountBalanceState('error');
  }

  function loadAccountState() {
    if (accountLoadPromise) {
      return accountLoadPromise;
    }

    const requestId = accountLoadRequestId + 1;
    accountLoadRequestId = requestId;
    const hadConfirmedBalance = accountBalanceState === 'ready'
      && Number.isSafeInteger(accountBalanceCents);
    if (!hadConfirmedBalance) {
      setAccountBalanceState('loading');
    }
    setRechargeAccessChecking(true);

    const requestPromise = (async () => {
      if (typeof window.fetch !== 'function') {
        handleAccountLoadFailure(hadConfirmedBalance);
        return false;
      }

      let response;
      try {
        response = await window.fetch(ACCOUNT_API_URL, {
          headers: {
            Accept: 'application/json',
          },
        });
      } catch {
        if (requestId === accountLoadRequestId) {
          handleAccountLoadFailure(hadConfirmedBalance);
        }
        return false;
      }

      if (requestId !== accountLoadRequestId) {
        return false;
      }
      if (response.status === 401 || response.status === 403) {
        const cachedAuthState = getValidatedAuthState();
        const shouldAnnounceExpiry = sessionAuthState === 'authenticated'
          || Boolean(cachedAuthState && cachedAuthState.mode === 'phone');
        handleExpiredSession();
        if (shouldAnnounceExpiry) {
          showToast('登录状态已失效，请重新登录');
        }
        return false;
      }
      const responseBody = await readJsonResponse(response);
      if (requestId !== accountLoadRequestId) {
        return false;
      }
      const principal = responseBody && responseBody.principal;
      const profile = responseBody && responseBody.profile;
      const account = responseBody && responseBody.account;
      const permissions = responseBody && responseBody.permissions;
      if (
        response.ok
        && principal
        && principal.type === 'guest'
        && account === null
        && permissions
        && permissions.canRecharge === false
      ) {
        applyGuestSession('guest');
        return false;
      }
      if (
        !response.ok
        || !principal
        || principal.type !== 'user'
        || !profile
        || !/^1[3-9]\d\*{4}\d{4}$/.test(profile.phoneMasked)
        || !account
        || account.currency !== 'CNY'
        || !Number.isSafeInteger(account.balanceCents)
        || !permissions
        || permissions.canRecharge !== true
      ) {
        handleAccountLoadFailure(hadConfirmedBalance);
        return false;
      }

      sessionAuthState = 'authenticated';
      saveCurrentAuthState(createPhoneAuthState(profile.phoneMasked));
      setAccountBalanceState('ready', account.balanceCents);
      return true;
    })();
    const trackedPromise = requestPromise.finally(() => {
      if (accountLoadPromise === trackedPromise) {
        accountLoadPromise = null;
        setRechargeAccessChecking(false);
      }
    });
    accountLoadPromise = trackedPromise;
    return trackedPromise;
  }

  function handleHomePageShow() {
    if (!hasSeenInitialPageShow) {
      hasSeenInitialPageShow = true;
      return;
    }
    void loadAccountState();
    if (rolePricingTrigger && rolePricingOverlay) {
      void loadPublicRoleCatalog();
    }
  }

  function renderCharacter(character) {
    const callLabel = character.voiceReady
      ? `开始与${character.name}通话`
      : `${character.name}语音正在准备中`;

    if (sceneImage) {
      sceneImage.src = character.imageSrc;
      sceneImage.alt = character.imageAlt;
      window.clearTimeout(imageAnimationTimer);
      sceneImage.classList.remove('is-character-switching');
      void sceneImage.offsetWidth;
      sceneImage.classList.add('is-character-switching');
      imageAnimationTimer = window.setTimeout(() => {
        sceneImage.classList.remove('is-character-switching');
      }, 260);
    }
    if (characterStage) {
      characterStage.dataset.currentCharacterKey = character.key;
      characterStage.setAttribute(
        'aria-label',
        `${character.name}角色主视觉`
      );
    }
    if (homeTitle) {
      homeTitle.textContent = character.name;
    }
    document.title = `${character.name} · 传统文化智慧陪伴`;
    if (characterMotto) {
      characterMotto.textContent = character.motto;
    }
    if (characterReadyText) {
      characterReadyText.textContent = character.readyText;
    }
    if (characterStatusDetail) {
      characterStatusDetail.textContent = character.statusDetail;
    }
    if (callControl) {
      callControl.setAttribute('aria-label', callLabel);
    }
    if (callButton) {
      callButton.setAttribute('aria-label', callLabel);
    }
    if (callButtonLabel) {
      callButtonLabel.textContent = '开始通话';
    }
    if (rolePosition) {
      const characterIndex = characters.findIndex(
        (candidate) => candidate.key === character.key
      );
      rolePosition.textContent = `${characterIndex + 1} / ${characters.length}`;
    }
  }

  function preloadCharacterImage(character) {
    const cachedPromise = characterImagePreloadPromises.get(
      character.imageSrc
    );
    if (cachedPromise) {
      return cachedPromise;
    }

    const preloadPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = reject;
      image.src = character.imageSrc;
    });
    characterImagePreloadPromises.set(
      character.imageSrc,
      preloadPromise
    );
    preloadPromise.catch(() => {
      if (
        characterImagePreloadPromises.get(character.imageSrc)
        === preloadPromise
      ) {
        characterImagePreloadPromises.delete(character.imageSrc);
      }
    });
    return preloadPromise;
  }

  function warmAdjacentCharacterImages(characterKey) {
    const currentIndex = characters.findIndex(
      (character) => character.key === characterKey
    );
    if (currentIndex === -1 || characters.length < 2) {
      return;
    }

    const adjacentIndexes = new Set([
      (currentIndex - 1 + characters.length) % characters.length,
      (currentIndex + 1) % characters.length,
    ]);
    adjacentIndexes.forEach((index) => {
      preloadCharacterImage(characters[index]).catch(() => {});
    });
  }

  async function selectCharacter(characterKey, source) {
    if (isStartingCall) {
      return false;
    }
    const character = charactersByKey.get(characterKey);
    if (!character) {
      return false;
    }
    const requestId = ++characterSelectionRequestId;
    if (character.key === currentCharacterKey) {
      renderCharacter(character);
      warmAdjacentCharacterImages(character.key);
      return true;
    }

    try {
      await preloadCharacterImage(character);
    } catch (error) {
      if (requestId === characterSelectionRequestId) {
        showToast('角色图片加载失败，请稍后再试');
      }
      return false;
    }
    if (requestId !== characterSelectionRequestId) {
      return false;
    }

    if (activeOverlay === rolePricingOverlay) {
      closeOverlay(rolePricingOverlay, false);
    }
    currentCharacterKey = character.key;
    renderCharacter(character);
    warmAdjacentCharacterImages(character.key);
    if (source === 'swipe-left' || source === 'swipe-right') {
      showToast(`已切换为${character.name}`);
    }
    return true;
  }

  function isPointInsideCharacterStage(clientX, clientY) {
    if (!characterStage) {
      return false;
    }
    const bounds = characterStage.getBoundingClientRect();
    return clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top
      && clientY <= bounds.bottom;
  }

  function resetSwipeGesture() {
    swipePointerId = null;
    swipeStartX = 0;
    swipeStartY = 0;
  }

  function releaseCharacterPointerCapture(pointerId) {
    if (!characterStage
      || typeof characterStage.releasePointerCapture !== 'function') {
      return;
    }

    try {
      if (typeof characterStage.hasPointerCapture !== 'function'
        || characterStage.hasPointerCapture(pointerId)) {
        characterStage.releasePointerCapture(pointerId);
      }
    } catch (error) {
      // Pointer capture may already have been released by the browser.
    }
  }

  function handleCharacterPointerDown(event) {
    const startedFromInteractiveControl = event.target instanceof Element
      && event.target.closest(
        'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"]'
      );
    if (activeOverlay
      || event.isPrimary === false
      || (event.pointerType === 'mouse' && event.button !== 0)
      || startedFromInteractiveControl
      || !isPointInsideCharacterStage(event.clientX, event.clientY)) {
      return;
    }

    swipePointerId = event.pointerId;
    swipeStartX = event.clientX;
    swipeStartY = event.clientY;
    if (typeof characterStage.setPointerCapture === 'function') {
      try {
        characterStage.setPointerCapture(event.pointerId);
      } catch (error) {
        // Keep the in-bounds gesture usable if capture is unavailable.
      }
    }
  }

  function handleCharacterPointerUp(event) {
    if (event.pointerId !== swipePointerId) {
      return;
    }

    const deltaX = event.clientX - swipeStartX;
    const deltaY = event.clientY - swipeStartY;
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);
    const directionRatio = verticalDistance === 0
      ? Number.POSITIVE_INFINITY
      : horizontalDistance / verticalDistance;
    const endedInsideStage = isPointInsideCharacterStage(
      event.clientX,
      event.clientY
    );
    releaseCharacterPointerCapture(event.pointerId);
    resetSwipeGesture();

    if (activeOverlay
      || !endedInsideStage
      || horizontalDistance < SWIPE_MIN_DISTANCE_PX
      || directionRatio < SWIPE_DIRECTION_RATIO) {
      return;
    }

    const currentIndex = characters.findIndex(
      (character) => character.key === currentCharacterKey
    );
    if (currentIndex === -1) {
      return;
    }

    if (deltaX < 0) {
      const nextIndex = (currentIndex + 1) % characters.length;
      selectCharacter(characters[nextIndex].key, 'swipe-left');
      return;
    }

    const previousIndex = (
      currentIndex - 1 + characters.length
    ) % characters.length;
    selectCharacter(characters[previousIndex].key, 'swipe-right');
  }

  function handleCharacterPointerCancel(event) {
    if (event.pointerId === swipePointerId) {
      releaseCharacterPointerCapture(event.pointerId);
      resetSwipeGesture();
    }
  }

  function handleCharacterLostPointerCapture(event) {
    if (event.pointerId === swipePointerId) {
      resetSwipeGesture();
    }
  }

  function clearRechargeResult() {
    if (!rechargeResult) {
      return;
    }
    rechargeResult.hidden = true;
    rechargeResult.textContent = '';
  }

  function formatRechargeAmountCents(amountCents) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      return '';
    }
    const yuan = Math.floor(amountCents / 100);
    const cents = amountCents % 100;
    if (cents === 0) {
      return String(yuan);
    }
    return `${yuan}.${String(cents).padStart(2, '0')}`
      .replace(/0$/, '');
  }

  function parseCustomRechargeAmount(rawValue) {
    const normalizedValue = String(rawValue).trim();
    if (/^\d+\.\d{3,}$/.test(normalizedValue)) {
      return {
        amountCents: null,
        displayAmount: '',
        errorMessage: CUSTOM_AMOUNT_PRECISION_ERROR,
      };
    }

    const formatMatch = normalizedValue.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!formatMatch) {
      return {
        amountCents: null,
        displayAmount: '',
        errorMessage: CUSTOM_AMOUNT_RANGE_ERROR,
      };
    }

    const yuan = Number(formatMatch[1]);
    const centDigits = (formatMatch[2] || '').padEnd(2, '0');
    const cents = centDigits === '' ? 0 : Number(centDigits);
    const amountCents = (yuan * 100) + cents;
    if (
      !Number.isSafeInteger(amountCents)
      || amountCents < 1
      || amountCents > MAX_DEV_RECHARGE_AMOUNT_CENTS
    ) {
      return {
        amountCents: null,
        displayAmount: '',
        errorMessage: CUSTOM_AMOUNT_RANGE_ERROR,
      };
    }

    return {
      amountCents,
      displayAmount: formatRechargeAmountCents(amountCents),
      errorMessage: '',
    };
  }

  function renderCustomAmountError(errorMessage = '') {
    const showError = Boolean(errorMessage);
    if (customAmountField) {
      customAmountField.classList.toggle('is-invalid', showError);
    }
    if (customAmountError) {
      customAmountError.textContent = errorMessage
        || CUSTOM_AMOUNT_RANGE_ERROR;
      customAmountError.hidden = !showError;
    }
    if (customAmountInput) {
      customAmountInput.setAttribute(
        'aria-invalid',
        String(showError)
      );
    }
  }

  function updateRechargeSelectionSummary() {
    if (!rechargeSelectionSummary) {
      return;
    }
    rechargeSelectionSummary.textContent = Number.isSafeInteger(
      selectedRechargeAmountCents
    ) && selectedRechargeAmountCents >= 1
      && selectedRechargeAmountCents <= MAX_DEV_RECHARGE_AMOUNT_CENTS
      && selectedRechargeAmountDisplay
      && selectedPaymentName
      ? `本次模拟充值：${selectedRechargeAmountDisplay}元 · ${selectedPaymentName}（仅界面演示）`
      : CUSTOM_AMOUNT_SUMMARY_ERROR;
  }

  function handlePackageSelection(event) {
    const selectedButton = event.currentTarget;
    const packageMode = selectedButton.dataset.packageMode;

    document.querySelectorAll('.package-option').forEach((button) => {
      const isSelected = button === selectedButton;
      const status = button.querySelector('.selection-status');
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
      if (status) {
        status.textContent = isSelected ? '已选' : '选择';
      }
    });

    if (packageMode === 'custom') {
      selectedAmountMode = 'custom';
      if (customAmountField) {
        customAmountField.hidden = false;
      }

      const parsedAmount = customAmountInput
        ? parseCustomRechargeAmount(customAmountInput.value)
        : parseCustomRechargeAmount('');
      const isValidAmount = !parsedAmount.errorMessage;
      selectedRechargeAmountCents = isValidAmount
        ? parsedAmount.amountCents
        : null;
      selectedRechargeAmountDisplay = isValidAmount
        ? parsedAmount.displayAmount
        : '';
      renderCustomAmountError();
      clearRechargeResult();
      updateRechargeSelectionSummary();
      if (customAmountInput) {
        customAmountInput.focus();
      }
      return;
    }

    const amountCents = Number(selectedButton.dataset.packageCents);
    if (
      !Number.isSafeInteger(amountCents)
      || amountCents < 1
      || amountCents > MAX_DEV_RECHARGE_AMOUNT_CENTS
    ) {
      showToast('请选择有效的充值金额。');
      return;
    }

    selectedAmountMode = 'preset';
    selectedRechargeAmountCents = amountCents;
    selectedRechargeAmountDisplay =
      formatRechargeAmountCents(amountCents);
    if (customAmountField) {
      customAmountField.hidden = true;
    }
    renderCustomAmountError();
    clearRechargeResult();
    updateRechargeSelectionSummary();
  }

  function handleCustomAmountInput() {
    if (selectedAmountMode !== 'custom' || !customAmountInput) {
      return;
    }

    const parsedAmount = parseCustomRechargeAmount(
      customAmountInput.value
    );
    const isValidAmount = !parsedAmount.errorMessage;
    selectedRechargeAmountCents = isValidAmount
      ? parsedAmount.amountCents
      : null;
    selectedRechargeAmountDisplay = isValidAmount
      ? parsedAmount.displayAmount
      : '';
    renderCustomAmountError(parsedAmount.errorMessage);
    clearRechargeResult();
    updateRechargeSelectionSummary();
  }

  function handlePaymentSelection(event) {
    const selectedButton = event.currentTarget;
    const paymentMethod = selectedButton.dataset.paymentMethod;
    const paymentName = selectedButton.dataset.paymentName;
    if (!paymentMethod || !paymentName) {
      showToast('请选择支付方式。');
      return;
    }

    selectedPaymentMethod = paymentMethod;
    selectedPaymentName = paymentName;
    document.querySelectorAll('.payment-option').forEach((button) => {
      const isSelected = button === selectedButton;
      const status = button.querySelector('.selection-status');
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-checked', String(isSelected));
      if (status) {
        status.textContent = isSelected ? '已选' : '选择';
      }
    });
    clearRechargeResult();
    updateRechargeSelectionSummary();
  }

  function setSubmittingRecharge(submitting) {
    isSubmittingRecharge = submitting;
    if (rechargeConfirmButton) {
      rechargeConfirmButton.disabled = submitting;
      rechargeConfirmButton.textContent = submitting
        ? '正在模拟充值…'
        : '模拟充值';
    }
  }

  function showRechargeResult(message) {
    if (rechargeResult) {
      rechargeResult.textContent = message;
      rechargeResult.hidden = false;
    }
    showToast(message);
  }

  async function handleRechargeConfirmation() {
    if (isSubmittingRecharge) {
      return false;
    }
    setSubmittingRecharge(true);
    try {
      if (
        sessionAuthState === 'guest'
        || sessionAuthState === 'unauthenticated'
      ) {
        closeOverlay(rechargePanel, false);
        openRechargeLoginPrompt(rechargeEntry);
        return false;
      }
      const hasRechargeAccess = await loadAccountState();
      if (!hasRechargeAccess || sessionAuthState !== 'authenticated') {
        closeOverlay(rechargePanel, false);
        if (
          sessionAuthState === 'guest'
          || sessionAuthState === 'unauthenticated'
        ) {
          openRechargeLoginPrompt(rechargeEntry);
        } else {
          showToast('账户状态暂时无法确认，请稍后重试');
        }
        return false;
      }

      if (selectedAmountMode === 'custom') {
        const parsedAmount = customAmountInput
          ? parseCustomRechargeAmount(customAmountInput.value)
          : parseCustomRechargeAmount('');
        if (parsedAmount.errorMessage) {
          selectedRechargeAmountCents = null;
          selectedRechargeAmountDisplay = '';
          renderCustomAmountError(parsedAmount.errorMessage);
          updateRechargeSelectionSummary();
          showToast(parsedAmount.errorMessage);
          if (customAmountInput) {
            customAmountInput.focus();
          }
          return false;
        }
        selectedRechargeAmountCents = parsedAmount.amountCents;
        selectedRechargeAmountDisplay = parsedAmount.displayAmount;
        renderCustomAmountError();
      }

      if (!Number.isSafeInteger(selectedRechargeAmountCents)
        || selectedRechargeAmountCents < 1
        || selectedRechargeAmountCents > MAX_DEV_RECHARGE_AMOUNT_CENTS) {
        showToast(CUSTOM_AMOUNT_RANGE_ERROR);
        return false;
      }

      clearRechargeResult();
      if (typeof window.fetch !== 'function') {
        throw new TypeError('fetch is unavailable');
      }
      const response = await window.fetch(DEV_RECHARGE_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amountCents: selectedRechargeAmountCents,
        }),
      });
      const responseBody = await readJsonResponse(response);
      const errorCode = responseBody
        && responseBody.error
        && responseBody.error.code;

      if (response.status === 401 || response.status === 403) {
        handleExpiredSession();
        openRechargeLoginPrompt(rechargeEntry);
        showToast('登录状态已失效，请重新登录');
        return false;
      }
      if (response.status === 404) {
        showRechargeResult('当前未开启模拟充值');
        return false;
      }
      if (
        response.status === 400
        && errorCode === 'INVALID_RECHARGE_AMOUNT'
      ) {
        showRechargeResult('请输入有效的充值金额');
        return false;
      }
      if (errorCode === 'ACCOUNT_UNAVAILABLE') {
        showRechargeResult('账户暂不可用，请稍后重试');
        return false;
      }

      const account = responseBody && responseBody.account;
      if (
        !response.ok
        || !account
        || account.currency !== 'CNY'
        || !Number.isSafeInteger(account.balanceCents)
        || !Number.isSafeInteger(account.remainingSeconds)
        || account.remainingSeconds < 0
      ) {
        showRechargeResult('模拟充值暂时失败，请稍后重试');
        return false;
      }

      accountLoadRequestId += 1;
      setAccountBalanceState('ready', account.balanceCents);
      showRechargeResult('模拟充值成功，未发生真实支付');
      return true;
    } catch {
      showRechargeResult('模拟充值暂时失败，请稍后重试');
      return false;
    } finally {
      setSubmittingRecharge(false);
    }
  }

  async function handleRechargeEntryClick() {
    if (
      sessionAuthState === 'guest'
      || sessionAuthState === 'unauthenticated'
    ) {
      openRechargeLoginPrompt(rechargeEntry);
      return;
    }
    const hasRechargeAccess = await loadAccountState();
    if (hasRechargeAccess && sessionAuthState === 'authenticated') {
      openOverlay(rechargePanel, rechargeEntry);
      return;
    }
    if (
      sessionAuthState === 'guest'
      || sessionAuthState === 'unauthenticated'
    ) {
      openRechargeLoginPrompt(rechargeEntry);
      return;
    }
    showToast('账户状态暂时无法确认，请稍后重试');
  }

  function handleAuxiliaryAction(event) {
    const message = auxiliaryMessages[event.currentTarget.dataset.action];
    if (message) {
      showToast(message);
    }
  }

  function setStartingCall(starting) {
    isStartingCall = starting;
    if (callButton) {
      callButton.disabled = starting;
    }
    const label = starting ? '正在接通…' : '开始通话';
    if (callButtonLabel) {
      callButtonLabel.textContent = label;
    }
    if (callActionLabel) {
      callActionLabel.textContent = label;
    }
  }

  function showCallCreationError(status, responseBody) {
    const errorCode = responseBody
      && responseBody.error
      && responseBody.error.code;
    if (status === 409 && errorCode === 'INSUFFICIENT_BALANCE') {
      showToast('账户话费不足，无法开始通话');
      openOverlay(rechargePanel, rechargeEntry);
      return;
    }
    if (status === 401 || status === 403) {
      handleExpiredSession();
      showToast('登录状态已失效，请重新登录');
      return;
    }
    if (
      errorCode === 'ROLE_NOT_FOUND'
      || errorCode === 'ROLE_UNAVAILABLE'
    ) {
      showToast('该角色暂时无法通话，请选择其他角色');
      return;
    }
    showToast('暂时无法开始通话，请稍后重试');
  }

  async function handleStartConversation() {
    if (isStartingCall) {
      return false;
    }
    const character = charactersByKey.get(currentCharacterKey);
    const realtimeUrl = character
      && Object.hasOwn(
        REALTIME_URLS_BY_CHARACTER_KEY,
        character.realtimeCharacterKey
      )
      ? REALTIME_URLS_BY_CHARACTER_KEY[character.realtimeCharacterKey]
      : null;
    if (!character || !character.voiceReady || !realtimeUrl) {
      showToast(
        character && character.unavailableText
          ? character.unavailableText
          : '该角色暂时无法开始语音通话。'
      );
      return false;
    }

    const authState = getValidatedAuthState();
    if (!authState) {
      window.location.assign('./index.html');
      return false;
    }
    currentAuthState = authState;
    if (!isPhoneAuthenticated(authState)) {
      window.location.assign(buildRealtimeNavigationUrl(realtimeUrl));
      return true;
    }

    setStartingCall(true);
    let isNavigating = false;
    try {
      if (typeof window.fetch !== 'function') {
        throw new TypeError('fetch is unavailable');
      }
      const response = await window.fetch(CALL_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roleSlug: character.key,
        }),
      });
      const responseBody = await readJsonResponse(response);
      const call = responseBody && responseBody.call;
      if (
        response.status !== 201
        || !call
        || typeof call.id !== 'string'
        || call.id === ''
      ) {
        showCallCreationError(response.status, responseBody);
        return false;
      }

      isNavigating = true;
      window.location.assign(
        buildRegisteredRealtimeNavigationUrl({
          realtimeUrl,
          characterKey: character.realtimeCharacterKey,
          businessCallId: call.id,
        })
      );
      return true;
    } catch {
      showToast('网络连接失败，请稍后重试');
      return false;
    } finally {
      if (!isNavigating) {
        setStartingCall(false);
      }
    }
  }

  function initializeUi() {
    getValidatedAuthState();

    document.body.dataset.authReady = 'true';
    renderAccountSummary(currentAuthState);
    renderAccountProfile(currentAuthState);
    if (homePage) {
      renderCharacter(charactersByKey.get(currentCharacterKey));
      if (rolePricingTrigger && rolePricingOverlay) {
        void loadPublicRoleCatalog();
      }
    }
    void loadAccountState().then(consumePendingAction);

    if (accountSummaryButton && accountProfileOverlay) {
      accountSummaryButton.addEventListener('click', () => {
        openAccountProfile(accountSummaryButton);
      });
    }

    if (rechargeEntry && rechargePanel) {
      rechargeEntry.addEventListener('click', handleRechargeEntryClick);
    }

    if (rolePricingTrigger && rolePricingOverlay) {
      rolePricingTrigger.addEventListener(
        'click',
        openCurrentRolePricing
      );
    }

    document.querySelectorAll('.prototype-overlay').forEach((overlay) => {
      overlay.addEventListener('click', handleOverlayBackdropClick);
    });

    document.querySelectorAll('[data-close-overlay]').forEach((button) => {
      button.addEventListener('click', () => {
        closeOverlay(button.closest('.prototype-overlay'), true);
      });
    });

    const rechargeLoginButton = document.querySelector(
      '[data-login-for-recharge]'
    );
    if (rechargeLoginButton) {
      rechargeLoginButton.addEventListener('click', () => {
        navigateToPhoneLogin('recharge');
      });
    }

    if (profileMainAction) {
      profileMainAction.addEventListener(
        'click',
        handleAccountProfileAction
      );
    }

    const confirmLogoutButton = document.querySelector(
      '[data-confirm-logout]'
    );
    if (confirmLogoutButton) {
      confirmLogoutButton.addEventListener('click', confirmLogout);
    }

    const cancelLogoutButton = document.querySelector(
      '[data-cancel-logout]'
    );
    if (cancelLogoutButton) {
      cancelLogoutButton.addEventListener('click', cancelLogout);
    }

    document.querySelectorAll('.package-option').forEach((button) => {
      button.addEventListener('click', handlePackageSelection);
    });

    if (customAmountInput) {
      customAmountInput.addEventListener(
        'input',
        handleCustomAmountInput
      );
    }

    document.querySelectorAll('.payment-option').forEach((button) => {
      button.addEventListener('click', handlePaymentSelection);
    });

    if (rechargeConfirmButton) {
      rechargeConfirmButton.addEventListener(
        'click',
        handleRechargeConfirmation
      );
    }

    document.querySelectorAll('.side-action[data-action]').forEach((button) => {
      button.addEventListener('click', handleAuxiliaryAction);
    });

    if (callButton) {
      callButton.addEventListener('click', handleStartConversation);
    }

    if (characterStage) {
      characterStage.addEventListener(
        'pointerdown',
        handleCharacterPointerDown
      );
      characterStage.addEventListener(
        'pointerup',
        handleCharacterPointerUp
      );
      characterStage.addEventListener(
        'pointercancel',
        handleCharacterPointerCancel
      );
      characterStage.addEventListener(
        'lostpointercapture',
        handleCharacterLostPointerCapture
      );
    }

    document.addEventListener('keydown', handleEscapeKey);
    window.addEventListener('pageshow', handleHomePageShow);
    updateRechargeSelectionSummary();
    if (homePage) {
      warmAdjacentCharacterImages(currentCharacterKey);
    }
  }

  initializeUi();
})();
