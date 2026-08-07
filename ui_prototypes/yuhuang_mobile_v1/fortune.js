'use strict';

(() => {
  const WISH_OFFERING_FALLBACK_MS = 3400;
  const REDUCED_WISH_OFFERING_FALLBACK_MS = 180;
  const DRAW_SHAKE_DURATION_MS = 1100;
  const DRAW_REVEAL_DURATION_MS = 1250;
  const REDUCED_DRAW_DURATION_MS = 120;
  const FORTUNE_SESSION_API_URL = '/api/fortune-sessions';
  const FORTUNE_CONFIG_API_URL = '/api/fortune-config';
  const ACCOUNT_API_URL = '/api/me';
  const FORTUNE_DEITY_KEY = 'yuhuang';
  const DEFAULT_FORTUNE_CHARACTER_KEY = 'guanyin';
  const FORTUNE_CHARACTER_KEYS = new Set([
    'yuhuang',
    'sunwukong',
    'guanyin',
    'caishen',
    'rulai',
    'zhubajie',
    'shawujing',
    'tangseng',
  ]);
  const INTEGRATED_FORTUNE_SCENE_SOURCES = Object.freeze({
    guanyin:
      './assets/fortune/scenes/fortune-scene-guanyin-v1.png',
    caishen:
      './assets/fortune/scenes/fortune-scene-caishen-v1.png',
    rulai:
      './assets/fortune/scenes/fortune-scene-rulai-v1.png',
  });

  const INTEGRATED_FORTUNE_CHARACTER_ORDER = Object.freeze([
    'guanyin',
    'caishen',
    'rulai',
  ]);

  const FORTUNE_SCENE_SWIPE_MIN_DISTANCE_PX = 56;
  const FORTUNE_SCENE_SWIPE_AXIS_RATIO = 1.15;

  const INTERACTION_STATES = Object.freeze({
    READY_TO_SPEAK: 'ready-to-speak',
    REQUESTING_MICROPHONE: 'requesting-microphone',
    CONNECTING_ASR: 'connecting-asr',
    LISTENING: 'listening',
    FINISHING_ASR: 'finishing-asr',
    OFFERING_WISH: 'offering-wish',
    DRAW_READY: 'draw-ready',
    DRAWING_LOT: 'drawing-lot',
    INSUFFICIENT_BALANCE: 'insufficient-balance',
    LOT_DRAWN: 'lot-drawn',
    LOT_ERROR: 'lot-error',
    INTERPRETING_LOT: 'interpreting-lot',
    LOT_INTERPRETED: 'lot-interpreted',
    INTERPRETATION_ERROR: 'interpretation-error',
    MICROPHONE_ERROR: 'microphone-error',
    ASR_ERROR: 'asr-error',
    CLOSED: 'closed',
  });
  const INTERPRETATION_AUDIO_STATES = Object.freeze({
    IDLE: 'idle',
    LOADING: 'loading',
    READY: 'ready',
    STARTING: 'starting',
    PLAYING: 'playing',
    PAUSED: 'paused',
    ENDED: 'ended',
    ERROR: 'error',
  });
  const page = document.querySelector('.fortune-page');
  const fortuneCharacterImage = document.querySelector(
    '[data-fortune-character-image]'
  );
  const fortuneCharacterImageWebp = document.querySelector(
    '[data-fortune-character-image-webp]'
  );
  const fortuneCharacterUnavailable = document.querySelector(
    '[data-fortune-character-unavailable]'
  );
  const acolyteImage = document.querySelector('.acolyte-character');
  const incenseState = document.querySelector('[data-incense-state]');
  const acolyteGuidance = document.querySelector(
    '[data-acolyte-guidance]'
  );
  const waitingState = document.querySelector('[data-waiting-state]');
  const speechTitle = document.querySelector('[data-speech-title]');
  const speechMessage = document.querySelector('[data-speech-message]');
  const speechDetail = document.querySelector('[data-speech-detail]');
  const speakControlButton = document.querySelector(
    '[data-speak-control]'
  );
  const transcriptStatus = document.querySelector(
    '[data-transcript-status]'
  );
  const transcriptText = document.querySelector(
    '[data-transcript-text]'
  );
  const wishPaper = document.querySelector('[data-wish-paper]');
  const wishOfferingStage = document.querySelector(
    '[data-wish-offering-stage]'
  );
  const wishFurnaceMouth = document.querySelector(
    '[data-wish-furnace-mouth]'
  );
  const flyingWishPaper = document.querySelector(
    '[data-flying-wish-paper]'
  );
  const flyingWishPaperText = document.querySelector(
    '[data-flying-wish-paper-text]'
  );
  const wishOfferingComplete = document.querySelector(
    '[data-wish-offering-complete]'
  );
  const fortuneDrawAnimation = document.querySelector(
    '[data-fortune-draw-animation]'
  );
  const fortuneError = document.querySelector('[data-fortune-error]');
  const retryFortuneButton = document.querySelector(
    '[data-retry-fortune]'
  );
  const fortuneResult = document.querySelector('[data-fortune-result]');
  const lotNumber = document.querySelector('[data-lot-number]');
  const lotLevel = document.querySelector('[data-lot-level]');
  const lotTitle = document.querySelector('[data-lot-title]');
  const lotVerses = document.querySelector('[data-lot-verses]');
  const interpretFortuneButton = document.querySelector(
    '[data-interpret-fortune]'
  );
  const interpretationError = document.querySelector(
    '[data-interpretation-error]'
  );
  const retryInterpretationButton = document.querySelector(
    '[data-retry-interpretation]'
  );
  const interpretationResult = document.querySelector(
    '[data-interpretation-result]'
  );
  const interpretationText = document.querySelector(
    '[data-interpretation-text]'
  );
  const interpretationAudio = document.querySelector(
    '[data-interpretation-audio]'
  );
  const interpretationAudioStatus = document.querySelector(
    '[data-interpretation-audio-status]'
  );
  const interpretationAudioControl = document.querySelector(
    '[data-interpretation-audio-control]'
  );
  const fortuneReturnLink = document.querySelector('[data-fortune-return]');
  const resetFortuneButton = document.querySelector('[data-reset-fortune]');
  const fortunePrice = document.querySelector('[data-fortune-price]');
  const fortuneBalance = document.querySelector('[data-fortune-balance]');
  const fortuneInsufficientPrice = document.querySelector(
    '[data-fortune-insufficient-price]'
  );
  const fortunePricingTrigger = document.querySelector(
    '.fortune-pricing-trigger'
  );
  const fortunePricingOverlay = document.querySelector(
    '#fortune-pricing-overlay'
  );
  const closeFortunePricingButton = document.querySelector(
    '[data-close-fortune-pricing]'
  );
  const fortuneInsufficientOverlay = document.querySelector(
    '#fortune-insufficient-overlay'
  );
  const fortuneInsufficientRechargeButton = document.querySelector(
    '[data-fortune-insufficient-recharge]'
  );
  const closeFortuneInsufficientButton = document.querySelector(
    '[data-close-fortune-insufficient]'
  );
  const fortuneErrorTitle = document.querySelector(
    '[data-fortune-error-title]'
  );
  const fortuneErrorMessage = document.querySelector(
    '[data-fortune-error-message]'
  );
  const fortuneRechargeButton = document.querySelector(
    '[data-fortune-recharge]'
  );
  const fortuneChargeSuccess = document.querySelector(
    '[data-fortune-charge-success]'
  );
  const fortuneLoginOverlay = document.querySelector(
    '#fortune-login-overlay'
  );
  const loginForFortuneButton = document.querySelector(
    '[data-login-for-fortune]'
  );
  const closeFortuneLoginButton = document.querySelector(
    '[data-close-fortune-login]'
  );

  if (
    !page
    || !fortuneCharacterImage
    || !fortuneCharacterUnavailable
    || !incenseState
    || !acolyteGuidance
    || !waitingState
    || !speechTitle
    || !speechMessage
    || !speechDetail
    || !speakControlButton
    || !transcriptStatus
    || !transcriptText
    || !wishPaper
    || !wishOfferingStage
    || !wishFurnaceMouth
    || !flyingWishPaper
    || !flyingWishPaperText
    || !wishOfferingComplete
    || !fortuneDrawAnimation
    || !fortuneError
    || !retryFortuneButton
    || !fortuneResult
    || !lotNumber
    || !lotLevel
    || !lotTitle
    || !lotVerses
    || !interpretFortuneButton
    || !interpretationError
    || !retryInterpretationButton
    || !interpretationResult
    || !interpretationText
    || !interpretationAudio
    || !interpretationAudioStatus
    || !interpretationAudioControl
    || !fortuneReturnLink
    || !resetFortuneButton
  ) {
    return;
  }

  let interactionState = INTERACTION_STATES.READY_TO_SPEAK;
  let activeAsrSession = null;
  let finishRequested = false;
  let sessionGeneration = 0;
  let currentTranscript = '';
  let transcriptIsFinal = false;
  let pageIsActive = true;
  let wishOfferingTimer = null;
  let wishOfferingAnimationHandler = null;
  let wishOfferingGeneration = null;
  let fortuneRequestController = null;
  let fortuneRequestGeneration = 0;
  let drawAnimationTimer = null;
  let drawAnimationHandler = null;
  let drawShakeComplete = false;
  let drawRevealComplete = false;
  let publicFortuneSession = null;
  let interpretationRequestController = null;
  let interpretationRequestGeneration = 0;
  let publicInterpretation = null;
  let interpretationAudioState = INTERPRETATION_AUDIO_STATES.IDLE;
  let interpretationAudioElement = null;
  let interpretationAudioObjectUrl = null;
  let interpretationAudioSessionId = null;
  let interpretationAudioRequestController = null;
  let interpretationAudioRequestGeneration = 0;
  let interpretationAudioAutoPlayAttemptCount = 0;
  let fortuneSceneSwipePointerId = null;
  let fortuneSceneSwipeStartX = 0;
  let fortuneSceneSwipeStartY = 0;
  const paidUiEnabled = Boolean(fortunePrice && fortuneBalance);
  let drawPriceCents = null;
  let accountBalanceCents = null;
  let accountAccessState = 'loading';
  let canRecharge = false;
  let hasSeenInitialPageShow = false;
  let paidInitializationPromise = null;
  let activeFortuneClientRequestId = '';
  let currentCharge = null;
  let activeFortuneOverlay = null;
  let activeFortuneOverlayTrigger = null;

  function formatCny(cents) {
    if (!Number.isSafeInteger(cents)) {
      return '--';
    }
    const absoluteCents = Math.abs(cents);
    const yuan = Math.floor(absoluteCents / 100);
    const remainder = String(absoluteCents % 100).padStart(2, '0');
    return `${cents < 0 ? '-' : ''}¥${yuan}.${remainder}`;
  }

  function renderPaidSummary() {
    if (!paidUiEnabled) {
      return;
    }
    fortunePrice.textContent = Number.isSafeInteger(drawPriceCents)
      ? formatCny(drawPriceCents)
      : '加载中';
    if (fortuneInsufficientPrice) {
      fortuneInsufficientPrice.textContent =
        Number.isSafeInteger(drawPriceCents)
          ? formatCny(drawPriceCents)
          : '加载中';
    }
    fortuneBalance.textContent = accountAccessState === 'authenticated'
      && Number.isSafeInteger(accountBalanceCents)
      ? formatCny(accountBalanceCents)
      : accountAccessState === 'error'
        ? '加载失败'
        : '--';
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function loadFortunePrice() {
    const response = await window.fetch(FORTUNE_CONFIG_API_URL, {
      headers: { Accept: 'application/json' },
    });
    const body = await readJson(response);
    if (
      !response.ok
      || !body
      || !Number.isSafeInteger(body.drawPriceCents)
      || body.drawPriceCents < 1
      || body.currency !== 'CNY'
      || body.chargeTiming !== 'fortune_session_created'
    ) {
      throw new Error('Fortune pricing is unavailable');
    }
    drawPriceCents = body.drawPriceCents;
    renderPaidSummary();
    return true;
  }

  function applyFortunePaymentCapabilities(permissions) {
    const providers = permissions && permissions.paymentProviders;
    const hasProvider = Boolean(
      providers
      && (providers.wechat === true || providers.alipay === true)
    );
    canRecharge = Boolean(
      permissions
      && permissions.canRecharge === true
      && hasProvider
    );
    const rechargeEntry = document.querySelector('.time-recharge-entry');
    if (rechargeEntry) {
      rechargeEntry.hidden = !canRecharge;
    }
    if (fortuneRechargeButton) {
      fortuneRechargeButton.hidden = !canRecharge;
    }
    if (fortuneInsufficientRechargeButton) {
      fortuneInsufficientRechargeButton.hidden = !canRecharge;
    }
    if (!canRecharge && activeFortuneOverlay === fortuneInsufficientOverlay) {
      closeFortuneOverlay(fortuneInsufficientOverlay, false);
      if (interactionState === INTERACTION_STATES.INSUFFICIENT_BALANCE) {
        renderSpeechState();
      }
    }
  }

  async function refreshFortuneAccount() {
    let response;
    try {
      response = await window.fetch(ACCOUNT_API_URL, {
        headers: { Accept: 'application/json' },
      });
    } catch {
      applyFortunePaymentCapabilities(null);
      accountAccessState = 'error';
      renderPaidSummary();
      return false;
    }
    const body = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      applyFortunePaymentCapabilities(null);
      accountAccessState = 'guest';
      accountBalanceCents = null;
      renderPaidSummary();
      return false;
    }
    if (
      response.ok
      && body
      && body.principal
      && body.principal.type === 'guest'
    ) {
      applyFortunePaymentCapabilities(null);
      accountAccessState = 'guest';
      accountBalanceCents = null;
      renderPaidSummary();
      return false;
    }
    applyFortunePaymentCapabilities(body && body.permissions);
    if (
      !response.ok
      || !body
      || !body.principal
      || body.principal.type !== 'user'
      || !body.account
      || body.account.currency !== 'CNY'
      || !Number.isSafeInteger(body.account.balanceCents)
    ) {
      accountAccessState = 'error';
      renderPaidSummary();
      return false;
    }
    accountAccessState = 'authenticated';
    accountBalanceCents = body.account.balanceCents;
    renderPaidSummary();
    return true;
  }

  function publishAccountBalance(balanceCents) {
    if (
      !Number.isSafeInteger(balanceCents)
      || typeof window.dispatchEvent !== 'function'
      || typeof window.CustomEvent !== 'function'
    ) {
      return;
    }
    window.dispatchEvent(new window.CustomEvent(
      'companion:account-balance-updated',
      {
        detail: {
          currency: 'CNY',
          balanceCents,
        },
      }
    ));
  }

  function createClientRequestId() {
    if (
      window.crypto
      && typeof window.crypto.randomUUID === 'function'
    ) {
      return window.crypto.randomUUID();
    }
    if (
      window.crypto
      && typeof window.crypto.getRandomValues === 'function'
    ) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(
        bytes,
        (byte) => byte.toString(16).padStart(2, '0')
      ).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-`
        + `${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error('Secure random values are unavailable');
  }

  function replaceFortuneUrlState({ requestId = '', sessionId = '' }) {
    if (
      !window.location
      || typeof window.location.href !== 'string'
      || !window.history
      || typeof window.history.replaceState !== 'function'
    ) {
      return;
    }
    const nextUrl = new URL(window.location.href);
    if (requestId) {
      nextUrl.searchParams.set('fortuneRequestId', requestId);
    } else {
      nextUrl.searchParams.delete('fortuneRequestId');
    }
    if (sessionId) {
      nextUrl.searchParams.set('fortuneSessionId', sessionId);
    } else {
      nextUrl.searchParams.delete('fortuneSessionId');
    }
    window.history.replaceState(null, '', nextUrl.href);
  }

  function openFortuneLoginGate() {
    if (!fortuneLoginOverlay) {
      return;
    }
    fortuneLoginOverlay.hidden = false;
    fortuneLoginOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeFortuneLoginGate() {
    if (!fortuneLoginOverlay) {
      return;
    }
    fortuneLoginOverlay.hidden = true;
    fortuneLoginOverlay.setAttribute('aria-hidden', 'true');
  }

  function openFortuneOverlay(overlay, trigger) {
    if (!overlay) {
      return;
    }
    if (activeFortuneOverlay && activeFortuneOverlay !== overlay) {
      closeFortuneOverlay(activeFortuneOverlay, false);
    }
    const wasHidden = overlay.hidden;
    activeFortuneOverlay = overlay;
    activeFortuneOverlayTrigger = trigger || null;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    if (document.body) {
      document.body.classList.add('has-open-overlay');
    }
    if (activeFortuneOverlayTrigger) {
      activeFortuneOverlayTrigger.setAttribute('aria-expanded', 'true');
    }
    if (wasHidden) {
      const focusTarget = overlay.querySelector('button');
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
      }
    }
  }

  function closeFortuneOverlay(overlay, restoreFocus = true) {
    if (!overlay) {
      return;
    }
    const trigger = overlay === activeFortuneOverlay
      ? activeFortuneOverlayTrigger
      : null;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }
    if (overlay === activeFortuneOverlay) {
      activeFortuneOverlay = null;
      activeFortuneOverlayTrigger = null;
      if (document.body) {
        document.body.classList.remove('has-open-overlay');
      }
    }
    if (restoreFocus && trigger && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  }

  function openFortunePricing() {
    openFortuneOverlay(fortunePricingOverlay, fortunePricingTrigger);
  }

  function openFortuneInsufficientBalance() {
    openFortuneOverlay(fortuneInsufficientOverlay, null);
  }

  function dismissFortuneInsufficientBalance() {
    const shouldResetForSpeech = (
      !transcriptIsFinal
      || currentTranscript.trim() === ''
      || activeFortuneClientRequestId === ''
    );
    closeFortuneOverlay(fortuneInsufficientOverlay, false);
    if (shouldResetForSpeech) {
      interactionState = INTERACTION_STATES.READY_TO_SPEAK;
      renderSpeechState();
      if (typeof speakControlButton.focus === 'function') {
        speakControlButton.focus();
      }
      return;
    }
    const rechargeEntry = document.querySelector('.time-recharge-entry');
    if (
      canRecharge
      && rechargeEntry
      && typeof rechargeEntry.focus === 'function'
    ) {
      rechargeEntry.focus();
    }
  }

  function handleFortuneOverlayBackdropClick(event) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.currentTarget === fortuneInsufficientOverlay) {
      dismissFortuneInsufficientBalance();
      return;
    }
    closeFortuneOverlay(event.currentTarget, true);
  }

  function handleFortuneOverlayKeydown(event) {
    if (event.key !== 'Escape' || !activeFortuneOverlay) {
      return;
    }
    if (activeFortuneOverlay === fortuneInsufficientOverlay) {
      dismissFortuneInsufficientBalance();
      return;
    }
    closeFortuneOverlay(activeFortuneOverlay, true);
  }

  function openFortuneRecharge() {
    if (!canRecharge) {
      if (activeFortuneOverlay) {
        closeFortuneOverlay(activeFortuneOverlay, false);
      }
      interactionState = INTERACTION_STATES.INSUFFICIENT_BALANCE;
      renderSpeechState();
      return;
    }
    if (activeFortuneOverlay) {
      closeFortuneOverlay(activeFortuneOverlay, false);
    }
    const rechargeEntry = document.querySelector('.time-recharge-entry');
    if (
      rechargeEntry
      && typeof rechargeEntry.dispatchEvent === 'function'
      && typeof window.Event === 'function'
    ) {
      rechargeEntry.dispatchEvent(new window.Event('click', {
        bubbles: true,
      }));
    }
  }

  function resolveRequestedCharacterKey() {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.has('characterKey')
      ? searchParams.get('characterKey')
      : DEFAULT_FORTUNE_CHARACTER_KEY;
  }

  function resolveFortuneCharacterImageSrc(characterKey) {
    if (!FORTUNE_CHARACTER_KEYS.has(characterKey)) {
      return null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        INTEGRATED_FORTUNE_SCENE_SOURCES,
        characterKey
      )
    ) {
      return INTEGRATED_FORTUNE_SCENE_SOURCES[characterKey];
    }

    const version = characterKey === 'sunwukong' ? 'v2' : 'v1';

    return `./assets/characters/${characterKey}/${characterKey}-home-hero-${version}.png`;
  }

  function waitForStartupImage(image, onFailure) {
    return new Promise((resolve, reject) => {
      if (!image) {
        reject(new Error('fortune image is missing'));
        return;
      }

      const settle = (isReady) => {
        image.removeEventListener('load', handleLoad);
        image.removeEventListener('error', handleError);
        if (isReady) {
          resolve(true);
          return;
        }
        if (typeof onFailure === 'function') {
          onFailure();
        }
        reject(new Error('fortune image is unavailable'));
      };
      const handleLoad = () => settle(true);
      const handleError = () => settle(false);

      if (image.complete) {
        settle(image.naturalWidth > 0);
        return;
      }
      image.addEventListener('load', handleLoad, { once: true });
      image.addEventListener('error', handleError, { once: true });
    });
  }

  function waitForStartupLayout(element) {
    return new Promise((resolve, reject) => {
      const requestFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0);
      requestFrame(() => {
        requestFrame(() => {
          if (!element || window.getComputedStyle(element).display === 'none') {
            reject(new Error('fortune layout is unavailable'));
            return;
          }
          resolve(true);
        });
      });
    });
  }

  function preloadStartupResource(url) {
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('fortune resource fetch is unavailable'));
    }
    return window.fetch(url, {
      credentials: 'same-origin',
      cache: 'force-cache',
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`fortune resource failed: ${response.status}`);
      }
      return response.arrayBuffer();
    });
  }

  function renderUnavailableFortuneCharacter() {
    fortuneCharacterImage.hidden = true;
    fortuneCharacterImage.removeAttribute('src');
    if (fortuneCharacterImageWebp) {
      fortuneCharacterImageWebp.removeAttribute('srcset');
    }
    fortuneCharacterImage.setAttribute('alt', '');
    fortuneCharacterUnavailable.hidden = false;
    page.dataset.fortuneCharacterKey = 'unavailable';
    page.dataset.fortuneSceneMode = 'unavailable';
  }

  function renderFortuneCharacter() {
    const characterKey = resolveRequestedCharacterKey();
    const imageSrc = resolveFortuneCharacterImageSrc(characterKey);

    if (imageSrc === null) {
      renderUnavailableFortuneCharacter();
      return Promise.resolve(false);
    }

    const usesIntegratedScene =
      Object.prototype.hasOwnProperty.call(
        INTEGRATED_FORTUNE_SCENE_SOURCES,
        characterKey
      );

    page.dataset.fortuneCharacterKey = characterKey;
    page.dataset.fortuneSceneMode = usesIntegratedScene
      ? 'integrated'
      : 'character';

    fortuneCharacterUnavailable.hidden = true;
    fortuneCharacterImage.hidden = false;
    fortuneCharacterImage.dataset.characterKey = characterKey;
    if (fortuneCharacterImageWebp) {
      fortuneCharacterImageWebp.srcset = imageSrc.replace(
        /\.png$/,
        '.webp'
      );
    }
    fortuneCharacterImage.setAttribute('src', imageSrc);
    fortuneCharacterImage.setAttribute(
      'alt',
      usesIntegratedScene
        ? '当前所选神仙的寺庙求签场景'
        : '当前所选神仙角色主视觉'
    );

    return waitForStartupImage(
      fortuneCharacterImage,
      renderUnavailableFortuneCharacter
    );
  }

  const fortuneSceneReadyPromise = renderFortuneCharacter();
  if (!window.XianBanStartup) {
    fortuneSceneReadyPromise.catch(() => {});
  }

  function resetFortuneSceneSwipe() {
    fortuneSceneSwipePointerId = null;
    fortuneSceneSwipeStartX = 0;
    fortuneSceneSwipeStartY = 0;
  }

  function isInteractiveFortuneTarget(target) {
    return Boolean(
      target
      && typeof target.closest === 'function'
      && target.closest(
        'button, a, input, textarea, select, audio'
      )
    );
  }

  function switchIntegratedFortuneCharacter(step) {
    if (
      interactionState !== INTERACTION_STATES.READY_TO_SPEAK
      || page.dataset.fortuneSceneMode !== 'integrated'
    ) {
      return false;
    }

    const currentCharacterKey = resolveRequestedCharacterKey();
    const currentIndex =
      INTEGRATED_FORTUNE_CHARACTER_ORDER.indexOf(
        currentCharacterKey
      );

    const safeCurrentIndex = currentIndex >= 0
      ? currentIndex
      : 0;

    const nextIndex = (
      safeCurrentIndex
      + step
      + INTEGRATED_FORTUNE_CHARACTER_ORDER.length
    ) % INTEGRATED_FORTUNE_CHARACTER_ORDER.length;

    const nextCharacterKey =
      INTEGRATED_FORTUNE_CHARACTER_ORDER[nextIndex];

    const nextUrl = new URL(window.location.href);

    nextUrl.searchParams.set(
      'characterKey',
      nextCharacterKey
    );

    /*
     * 只修改当前地址栏中的 characterKey，
     * 不重新加载 fortune.html。
     *
     * 因此不会先显示 HTML 中原来的玉皇大帝场景，
     * 也不会丢失当前页面已经建立的前端状态。
     */
    window.history.replaceState(
      null,
      '',
      nextUrl.href
    );

    renderFortuneCharacter();
    page.classList.add(
      'has-swiped-fortune-scene'
    );
    return true;
  }

  function handleFortuneSceneSwipePointerDown(event) {
    if (
      page.dataset.fortuneSceneMode !== 'integrated'
      || interactionState !== INTERACTION_STATES.READY_TO_SPEAK
      || fortuneSceneSwipePointerId !== null
      || (event && event.isPrimary === false)
      || (
        event
        && Number.isFinite(event.button)
        && event.button !== 0
      )
      || isInteractiveFortuneTarget(event && event.target)
      || !Number.isFinite(event && event.clientX)
      || !Number.isFinite(event && event.clientY)
    ) {
      return;
    }

    fortuneSceneSwipePointerId = event.pointerId;
    fortuneSceneSwipeStartX = event.clientX;
    fortuneSceneSwipeStartY = event.clientY;

    if (typeof page.setPointerCapture === 'function') {
      try {
        page.setPointerCapture(event.pointerId);
      } catch (error) {
        resetFortuneSceneSwipe();
      }
    }
  }

  function handleFortuneSceneSwipePointerEnd(event) {
    if (
      fortuneSceneSwipePointerId === null
      || !event
      || event.pointerId !== fortuneSceneSwipePointerId
    ) {
      return;
    }

    const pointerId = fortuneSceneSwipePointerId;
    const distanceX =
      event.clientX - fortuneSceneSwipeStartX;
    const distanceY =
      event.clientY - fortuneSceneSwipeStartY;

    const horizontalDistance = Math.abs(distanceX);
    const verticalDistance = Math.abs(distanceY);

    resetFortuneSceneSwipe();

    if (typeof page.releasePointerCapture === 'function') {
      try {
        page.releasePointerCapture(pointerId);
      } catch (error) {
        // 浏览器可能已经自动释放 Pointer Capture。
      }
    }

    if (
      horizontalDistance
        < FORTUNE_SCENE_SWIPE_MIN_DISTANCE_PX
      || horizontalDistance
        <= verticalDistance * FORTUNE_SCENE_SWIPE_AXIS_RATIO
    ) {
      return;
    }

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    /*
     * 左滑进入下一个神仙；
     * 右滑返回上一个神仙。
     */
    switchIntegratedFortuneCharacter(
      distanceX < 0 ? 1 : -1
    );
  }

  function handleFortuneSceneSwipePointerCancel(event) {
    if (
      fortuneSceneSwipePointerId === null
      || (
        event
        && event.pointerId !== fortuneSceneSwipePointerId
      )
    ) {
      return;
    }

    resetFortuneSceneSwipe();
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setWishPaperBusy(isBusy) {
    wishPaper.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  function clearWishOfferingResources() {
    if (wishOfferingTimer !== null) {
      window.clearTimeout(wishOfferingTimer);
      wishOfferingTimer = null;
    }
    if (wishOfferingAnimationHandler !== null) {
      wishOfferingStage.removeEventListener(
        'animationend',
        wishOfferingAnimationHandler
      );
      wishOfferingAnimationHandler = null;
    }
    wishOfferingStage.classList.remove('is-active');
    wishOfferingStage.hidden = true;
    flyingWishPaperText.textContent = '';
    for (const propertyName of [
      '--wish-paper-start-x',
      '--wish-paper-start-y',
      '--wish-paper-width',
      '--wish-paper-height',
      '--wish-lift-x',
      '--wish-lift-y',
      '--wish-approach-x',
      '--wish-approach-y',
      '--wish-flight-x',
      '--wish-flight-y',
      '--wish-enter-y',
    ]) {
      flyingWishPaper.style.removeProperty(propertyName);
    }
    page.classList.remove('is-wish-offering');
  }

  function formatPixelValue(value) {
    return `${Math.round(value * 100) / 100}px`;
  }

  function prepareWishOfferingVisual() {
    wishOfferingStage.classList.remove('is-active');
    wishOfferingStage.hidden = false;
    flyingWishPaperText.textContent = currentTranscript;

    const sourceRect = wishPaper.getBoundingClientRect();
    const mouthRect = wishFurnaceMouth.getBoundingClientRect();
    const viewportWidth = Number.isFinite(window.innerWidth)
      ? window.innerWidth
      : 430;
    const viewportHeight = Number.isFinite(window.innerHeight)
      ? window.innerHeight
      : 932;
    const sourceWidth = sourceRect.width > 0
      ? sourceRect.width
      : Math.max(160, viewportWidth - 40);
    const sourceHeight = sourceRect.height > 0
      ? sourceRect.height
      : 180;
    const paperWidth = Math.min(sourceWidth, 360);
    const paperHeight = Math.min(Math.max(sourceHeight, 120), 178);
    const sourceLeft = Number.isFinite(sourceRect.left)
      ? sourceRect.left
      : (viewportWidth - sourceWidth) / 2;
    const sourceTop = Number.isFinite(sourceRect.top)
      ? sourceRect.top
      : viewportHeight * 0.34;
    const mouthLeft = Number.isFinite(mouthRect.left)
      ? mouthRect.left
      : viewportWidth / 2 - 42;
    const mouthTop = Number.isFinite(mouthRect.top)
      ? mouthRect.top
      : viewportHeight * 0.68;
    const mouthWidth = mouthRect.width > 0 ? mouthRect.width : 84;
    const mouthHeight = mouthRect.height > 0 ? mouthRect.height : 30;
    const startX = sourceLeft + (sourceWidth - paperWidth) / 2;
    const startY = sourceTop;
    const startCenterX = startX + paperWidth / 2;
    const startCenterY = startY + paperHeight * 0.42;
    const mouthCenterX = mouthLeft + mouthWidth / 2;
    const mouthCenterY = mouthTop + mouthHeight * 0.45;
    const flightX = mouthCenterX - startCenterX;
    const flightY = mouthCenterY - startCenterY;
    const liftHeight = Math.min(52, Math.max(28, paperHeight * 0.22));

    const variables = {
      '--wish-paper-start-x': startX,
      '--wish-paper-start-y': startY,
      '--wish-paper-width': paperWidth,
      '--wish-paper-height': paperHeight,
      '--wish-lift-x': flightX * 0.14,
      '--wish-lift-y': -liftHeight,
      '--wish-approach-x': flightX * 0.82,
      '--wish-approach-y': flightY - Math.max(24, mouthHeight * 0.8),
      '--wish-flight-x': flightX,
      '--wish-flight-y': flightY,
      '--wish-enter-y': flightY + Math.max(24, mouthHeight * 0.65),
    };
    for (const [propertyName, value] of Object.entries(variables)) {
      flyingWishPaper.style.setProperty(
        propertyName,
        formatPixelValue(value)
      );
    }
  }

  function renderInterpretationAudioState() {
    page.classList.remove('is-reading-interpretation');
    interpretationAudioControl.hidden = true;
    interpretationAudioControl.disabled = false;
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.LOADING) {
      interpretationAudioStatus.textContent =
        '道童正在准备朗读。';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.READY) {
      interpretationAudioStatus.textContent =
        '解签语音已经准备好。';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.STARTING) {
      interpretationAudioStatus.textContent =
        '道童正在开始朗读。';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.PLAYING) {
      interpretationAudioStatus.textContent = '道童正在解签。';
      page.classList.add('is-reading-interpretation');
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.PAUSED) {
      interpretationAudioStatus.textContent = '朗读已暂停。';
      interpretationAudioControl.textContent = '点击朗读';
      interpretationAudioControl.hidden = false;
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.ENDED) {
      interpretationAudioStatus.textContent = '道童朗读完毕。';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.ERROR) {
      if (interpretationAudioElement) {
        interpretationAudioStatus.textContent =
          '浏览器未能自动播放，请点击朗读。';
        interpretationAudioControl.textContent = '点击朗读';
        interpretationAudioControl.hidden = false;
      } else {
        interpretationAudioStatus.textContent =
          '朗读暂时不可用，文字解签仍可正常阅读。';
      }
      return;
    }
    interpretationAudioStatus.textContent = '道童正在准备朗读。';
  }

  function releaseInterpretationAudio() {
    interpretationAudioRequestGeneration += 1;
    if (interpretationAudioRequestController !== null) {
      interpretationAudioRequestController.abort();
      interpretationAudioRequestController = null;
    }

    const audioElement = interpretationAudioElement;
    const objectUrl = interpretationAudioObjectUrl;
    interpretationAudioElement = null;
    interpretationAudioObjectUrl = null;
    interpretationAudioSessionId = null;
    interpretationAudioState = INTERPRETATION_AUDIO_STATES.IDLE;
    page.classList.remove('is-reading-interpretation');

    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute('src');
      if (typeof audioElement.load === 'function') {
        audioElement.load();
      }
    }
    if (
      objectUrl
      && window.URL
      && typeof window.URL.revokeObjectURL === 'function'
    ) {
      window.URL.revokeObjectURL(objectUrl);
    }
  }

  function clearDrawAnimation() {
    if (drawAnimationTimer !== null) {
      window.clearTimeout(drawAnimationTimer);
      drawAnimationTimer = null;
    }
    if (drawAnimationHandler !== null) {
      fortuneDrawAnimation.removeEventListener(
        'animationend',
        drawAnimationHandler
      );
      drawAnimationHandler = null;
    }
    fortuneDrawAnimation.classList.remove(
      'is-shaking',
      'is-waiting',
      'is-revealing'
    );
    fortuneDrawAnimation.hidden = true;
  }

  function completeFortuneReveal(generation) {
    if (
      !pageIsActive
      || generation !== fortuneRequestGeneration
      || interactionState !== INTERACTION_STATES.DRAWING_LOT
      || !publicFortuneSession
    ) {
      return false;
    }
    drawRevealComplete = true;
    clearDrawAnimation();
    interactionState = INTERACTION_STATES.LOT_DRAWN;
    renderSpeechState();
    if (typeof fortuneResult.focus === 'function') {
      fortuneResult.focus();
    }
    return true;
  }

  function startFortuneReveal(generation) {
    if (
      !pageIsActive
      || generation !== fortuneRequestGeneration
      || interactionState !== INTERACTION_STATES.DRAWING_LOT
      || !drawShakeComplete
      || drawRevealComplete
      || !publicFortuneSession
    ) {
      return false;
    }
    if (drawAnimationTimer !== null) {
      window.clearTimeout(drawAnimationTimer);
      drawAnimationTimer = null;
    }
    fortuneDrawAnimation.classList.remove('is-shaking', 'is-waiting');
    fortuneDrawAnimation.classList.add('is-revealing');
    const animationHandler = (event) => {
      if (event && event.animationName === 'lot-slip-reveal') {
        completeFortuneReveal(generation);
      }
    };
    drawAnimationHandler = animationHandler;
    fortuneDrawAnimation.addEventListener('animationend', animationHandler);
    drawAnimationTimer = window.setTimeout(
      () => completeFortuneReveal(generation),
      prefersReducedMotion()
        ? REDUCED_DRAW_DURATION_MS
        : DRAW_REVEAL_DURATION_MS
    );
    return true;
  }

  function completeFortuneShake(generation) {
    if (
      !pageIsActive
      || generation !== fortuneRequestGeneration
      || interactionState !== INTERACTION_STATES.DRAWING_LOT
      || drawShakeComplete
    ) {
      return false;
    }
    if (drawAnimationTimer !== null) {
      window.clearTimeout(drawAnimationTimer);
      drawAnimationTimer = null;
    }
    if (drawAnimationHandler !== null) {
      fortuneDrawAnimation.removeEventListener(
        'animationend',
        drawAnimationHandler
      );
      drawAnimationHandler = null;
    }
    drawShakeComplete = true;
    fortuneDrawAnimation.classList.remove('is-shaking');
    fortuneDrawAnimation.classList.add('is-waiting');
    if (publicFortuneSession) {
      startFortuneReveal(generation);
    }
    return true;
  }

  function startFortuneDrawAnimation(generation) {
    clearDrawAnimation();
    drawShakeComplete = false;
    drawRevealComplete = false;
    fortuneDrawAnimation.hidden = false;
    fortuneDrawAnimation.classList.add('is-shaking');
    const animationHandler = (event) => {
      if (event && event.animationName === 'lot-cylinder-shake') {
        completeFortuneShake(generation);
      }
    };
    drawAnimationHandler = animationHandler;
    fortuneDrawAnimation.addEventListener('animationend', animationHandler);
    drawAnimationTimer = window.setTimeout(
      () => completeFortuneShake(generation),
      prefersReducedMotion()
        ? REDUCED_DRAW_DURATION_MS
        : DRAW_SHAKE_DURATION_MS
    );
  }

  function renderSpeechState() {
    if (
      interactionState !== INTERACTION_STATES.INSUFFICIENT_BALANCE
      && activeFortuneOverlay === fortuneInsufficientOverlay
    ) {
      closeFortuneOverlay(fortuneInsufficientOverlay, false);
    }
    page.classList.remove(
      'is-listening',
      'has-microphone-error',
      'has-asr-error',
      'has-offered-wish',
      'is-drawing-lot',
      'has-lot-result',
      'is-reading-interpretation'
    );
    page.dataset.fortuneState = interactionState;
    waitingState.hidden = false;
    speechTitle.hidden = true;
    speechMessage.hidden = true;
    speakControlButton.hidden = true;
    speakControlButton.setAttribute('aria-pressed', 'false');
    wishOfferingComplete.hidden = true;
    fortuneDrawAnimation.hidden = true;
    fortuneError.hidden = true;
    fortuneResult.hidden = true;
    retryFortuneButton.disabled = true;
    if (fortuneRechargeButton) {
      fortuneRechargeButton.hidden = true;
    }
    if (fortuneChargeSuccess) {
      fortuneChargeSuccess.hidden = true;
    }
    interpretFortuneButton.hidden = true;
    interpretFortuneButton.disabled = true;
    interpretFortuneButton.textContent = '请道童解签';
    interpretationError.hidden = true;
    retryInterpretationButton.disabled = true;
    interpretationResult.hidden = true;
    interpretationAudio.hidden = true;
    resetFortuneButton.hidden = true;
    wishPaper.hidden = true;
    wishPaper.setAttribute('aria-hidden', 'true');

    if (interactionState === INTERACTION_STATES.READY_TO_SPEAK) {
      speechTitle.hidden = false;
      speechMessage.hidden = false;
      speakControlButton.hidden = false;
      speechTitle.textContent = '静心诉说';
      speechMessage.textContent =
        '点击“开始说话”，说完后再点击“结束说话”。';
      speechDetail.textContent =
        '点击后使用麦克风实时识别，再次点击即停止采集。';
      speakControlButton.textContent = '开始说话';
      speakControlButton.disabled = false;
      setWishPaperBusy(false);
      return;
    }

    if (
      interactionState === INTERACTION_STATES.REQUESTING_MICROPHONE
    ) {
      speechTitle.hidden = false;
      speechMessage.hidden = false;
      speakControlButton.hidden = false;
      speechTitle.textContent = '请求麦克风权限';
      speechMessage.textContent = finishRequested
        ? '已收到结束操作，正在等待麦克风完成准备。'
        : '请允许使用麦克风。';
      speakControlButton.setAttribute('aria-pressed', 'true');
      speakControlButton.textContent = finishRequested
        ? '正在结束……'
        : '结束说话';
      speakControlButton.disabled = finishRequested;
      wishPaper.hidden = false;
      wishPaper.removeAttribute('aria-hidden');
      setWishPaperBusy(false);
      return;
    }

    if (interactionState === INTERACTION_STATES.CONNECTING_ASR) {
      speechTitle.hidden = false;
      speechMessage.hidden = false;
      speakControlButton.hidden = false;
      speechTitle.textContent = '正在准备聆听';
      speechMessage.textContent = finishRequested
        ? '已收到结束操作，正在结束语音识别。'
        : '正在准备聆听，请稍候……';
      speakControlButton.setAttribute('aria-pressed', 'true');
      speakControlButton.textContent = finishRequested
        ? '正在结束……'
        : '结束说话';
      speakControlButton.disabled = finishRequested;
      transcriptStatus.textContent = '准备代您记录';
      wishPaper.hidden = false;
      wishPaper.removeAttribute('aria-hidden');
      setWishPaperBusy(true);
      return;
    }

    if (interactionState === INTERACTION_STATES.LISTENING) {
      page.classList.add('is-listening');
      speechTitle.hidden = false;
      speechMessage.hidden = false;
      speakControlButton.hidden = false;
      speechTitle.textContent = '道童正在聆听';
      speechMessage.textContent = finishRequested
        ? '已收到结束操作，正在整理您的心愿。'
        : '请慢慢说，说完后点击“结束说话”。';
      speakControlButton.setAttribute('aria-pressed', 'true');
      speakControlButton.textContent = finishRequested
        ? '正在结束……'
        : '结束说话';
      speakControlButton.disabled = finishRequested;
      if (currentTranscript === '') {
        transcriptStatus.textContent = '道童正在代您记下……';
      }
      wishPaper.hidden = false;
      wishPaper.removeAttribute('aria-hidden');
      setWishPaperBusy(true);
      return;
    }

    if (interactionState === INTERACTION_STATES.FINISHING_ASR) {
      speechTitle.hidden = false;
      speechMessage.hidden = false;
      speakControlButton.hidden = false;
      speechTitle.textContent = '正在整理心愿';
      speechMessage.textContent = '请稍候，正在写定心愿。';
      speakControlButton.setAttribute('aria-pressed', 'true');
      speakControlButton.textContent = '正在结束……';
      speakControlButton.disabled = true;
      transcriptStatus.textContent = '正在整理您的话……';
      wishPaper.hidden = false;
      wishPaper.removeAttribute('aria-hidden');
      setWishPaperBusy(true);
      return;
    }

    if (interactionState === INTERACTION_STATES.OFFERING_WISH) {
      page.classList.add('is-wish-offering');
      setWishPaperBusy(true);
      wishPaper.setAttribute('aria-hidden', 'true');
      return;
    }

    if (interactionState === INTERACTION_STATES.DRAW_READY) {
      page.classList.add('has-offered-wish');
      setWishPaperBusy(false);
      wishOfferingComplete.hidden = false;
      return;
    }

    if (interactionState === INTERACTION_STATES.DRAWING_LOT) {
      page.classList.add('has-offered-wish', 'is-drawing-lot');
      fortuneDrawAnimation.hidden = false;
      return;
    }

    if (interactionState === INTERACTION_STATES.LOT_ERROR) {
      page.classList.add('has-offered-wish');
      wishPaper.hidden = true;
      wishPaper.setAttribute('aria-hidden', 'true');
      fortuneError.hidden = false;
      retryFortuneButton.disabled = false;
      retryFortuneButton.textContent = '再次请签';
      if (fortuneErrorTitle) {
        fortuneErrorTitle.textContent = '求签未成';
      }
      if (fortuneErrorMessage) {
        fortuneErrorMessage.textContent =
          '暂时未能求得签文，请稍后再试。';
      }
      return;
    }

    if (interactionState === INTERACTION_STATES.INSUFFICIENT_BALANCE) {
      if (canRecharge && fortuneInsufficientOverlay) {
        if (
          transcriptIsFinal
          && currentTranscript.trim() !== ''
          && activeFortuneClientRequestId !== ''
        ) {
          page.classList.add('has-offered-wish');
        } else {
          speechTitle.hidden = false;
          speechMessage.hidden = false;
          speakControlButton.hidden = false;
          speechTitle.textContent = '静心诉说';
          speechMessage.textContent =
            '点击“开始说话”，说完后再点击“结束说话”。';
          speakControlButton.textContent = '开始说话';
          speakControlButton.disabled = false;
        }
        openFortuneInsufficientBalance();
        return;
      }
      page.classList.add('has-offered-wish');
      fortuneError.hidden = false;
      retryFortuneButton.disabled = !canRecharge || !(
        transcriptIsFinal
        && currentTranscript.trim() !== ''
        && activeFortuneClientRequestId !== ''
      );
      retryFortuneButton.textContent = canRecharge
        ? '充值后继续求签'
        : '暂时无法继续求签';
      if (fortuneRechargeButton) {
        fortuneRechargeButton.hidden = !canRecharge;
      }
      if (fortuneErrorTitle) {
        fortuneErrorTitle.textContent = '当前话费不足';
      }
      if (!canRecharge && fortuneErrorMessage) {
        fortuneErrorMessage.textContent =
          '当前暂未开放话费充值，请稍后再试。';
      } else if (
        fortuneErrorMessage
        && Number.isSafeInteger(drawPriceCents)
        && Number.isSafeInteger(accountBalanceCents)
      ) {
        fortuneErrorMessage.textContent =
          `本次求签需要 ${formatCny(drawPriceCents)}，`
          + `当前话费 ${formatCny(accountBalanceCents)}，`
          + `还差 ${formatCny(drawPriceCents - accountBalanceCents)}。`;
      }
      return;
    }

    if (
      (
        interactionState === INTERACTION_STATES.LOT_DRAWN
        || interactionState === INTERACTION_STATES.INTERPRETING_LOT
        || interactionState === INTERACTION_STATES.LOT_INTERPRETED
        || interactionState === INTERACTION_STATES.INTERPRETATION_ERROR
      )
      && publicFortuneSession
    ) {
      page.classList.add('has-offered-wish', 'has-lot-result');
      fortuneResult.hidden = false;
      resetFortuneButton.hidden = false;
      lotNumber.textContent = String(publicFortuneSession.lot.number);
      lotLevel.textContent = publicFortuneSession.lot.level;
      lotTitle.textContent = publicFortuneSession.lot.title;
      lotVerses.textContent =
        publicFortuneSession.lot.verseLines.join('\n');
      if (fortuneChargeSuccess && currentCharge) {
        fortuneChargeSuccess.textContent =
          `本次已扣 ${formatCny(currentCharge.priceCents)}，`
          + `当前话费 ${formatCny(currentCharge.balanceAfterCents)}。`;
        fortuneChargeSuccess.hidden = false;
      }
      if (interactionState === INTERACTION_STATES.LOT_DRAWN) {
        interpretFortuneButton.hidden = false;
        interpretFortuneButton.disabled = false;
        return;
      }
      if (
        interactionState === INTERACTION_STATES.INTERPRETING_LOT
      ) {
        interpretFortuneButton.hidden = false;
        interpretFortuneButton.disabled = true;
        interpretFortuneButton.textContent = '道童正在解签……';
        return;
      }
      if (
        interactionState === INTERACTION_STATES.INTERPRETATION_ERROR
      ) {
        interpretationError.hidden = false;
        retryInterpretationButton.disabled = false;
        return;
      }
      if (
        interactionState === INTERACTION_STATES.LOT_INTERPRETED
        && publicInterpretation
      ) {
        interpretationResult.hidden = false;
        interpretationText.textContent = publicInterpretation.text;
        interpretationAudio.hidden = false;
        renderInterpretationAudioState();
      }
    }
  }

  function resetWishPaper() {
    releaseInterpretationAudio();
    clearWishOfferingResources();
    clearDrawAnimation();
    wishOfferingGeneration = null;
    finishRequested = false;
    currentTranscript = '';
    transcriptIsFinal = false;
    publicFortuneSession = null;
    publicInterpretation = null;
    lotNumber.textContent = '';
    lotLevel.textContent = '';
    lotTitle.textContent = '';
    lotVerses.textContent = '';
    interpretationText.textContent = '';
    transcriptStatus.textContent = '正在聆听';
    transcriptText.textContent = '';
    setWishPaperBusy(false);
    wishOfferingComplete.hidden = true;
    wishPaper.hidden = true;
    wishPaper.setAttribute('aria-hidden', 'true');
    page.classList.remove('has-offered-wish');
  }

  function resetCompletedFortune(event) {
    if (!publicFortuneSession) {
      return false;
    }
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    sessionGeneration += 1;
    fortuneRequestGeneration += 1;
    if (fortuneRequestController !== null) {
      fortuneRequestController.abort();
      fortuneRequestController = null;
    }
    interpretationRequestGeneration += 1;
    if (interpretationRequestController !== null) {
      interpretationRequestController.abort();
      interpretationRequestController = null;
    }
    closeActiveAsrSession();
    resetWishPaper();
    activeFortuneClientRequestId = '';
    currentCharge = null;
    replaceFortuneUrlState({});
    interactionState = INTERACTION_STATES.READY_TO_SPEAK;
    renderSpeechState();
    if (typeof speakControlButton.focus === 'function') {
      speakControlButton.focus();
    }
    return true;
  }

  function isPublicFortuneSession(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof value.id === 'string'
      && value.id !== ''
      && value.status === 'drawn'
      && value.deityKey === FORTUNE_DEITY_KEY
      && typeof value.catalogVersion === 'string'
      && value.catalogVersion !== ''
      && value.lot
      && typeof value.lot === 'object'
      && !Array.isArray(value.lot)
      && typeof value.lot.id === 'string'
      && Number.isSafeInteger(value.lot.number)
      && typeof value.lot.level === 'string'
      && value.lot.level !== ''
      && typeof value.lot.title === 'string'
      && value.lot.title !== ''
      && Array.isArray(value.lot.verseLines)
      && value.lot.verseLines.length > 0
      && value.lot.verseLines.every(
        (line) => typeof line === 'string' && line.trim() !== ''
      )
      && typeof value.createdAt === 'string'
      && typeof value.drawnAt === 'string'
    );
  }

  function isPublicCharge(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Number.isSafeInteger(value.priceCents)
      && value.priceCents > 0
      && value.currency === 'CNY'
      && Number.isSafeInteger(value.balanceBeforeCents)
      && Number.isSafeInteger(value.balanceAfterCents)
      && value.balanceAfterCents
        === value.balanceBeforeCents - value.priceCents
      && typeof value.alreadyProcessed === 'boolean'
    );
  }

  function readSessionIdFromUrl() {
    if (!window.location || typeof window.location.search !== 'string') {
      return '';
    }
    const value = new URLSearchParams(window.location.search).get(
      'fortuneSessionId'
    );
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
      ? value
      : '';
  }

  function restoreClientRequestIdFromUrl() {
    if (!window.location || typeof window.location.search !== 'string') {
      return;
    }
    const value = new URLSearchParams(window.location.search).get(
      'fortuneRequestId'
    );
    if (
      typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ) {
      activeFortuneClientRequestId = value;
    }
  }

  async function restorePaidFortuneFromUrl() {
    const sessionId = readSessionIdFromUrl();
    if (sessionId === '' || accountAccessState !== 'authenticated') {
      return false;
    }
    const response = await window.fetch(
      `${FORTUNE_SESSION_API_URL}/${encodeURIComponent(sessionId)}`,
      { headers: { Accept: 'application/json' } }
    );
    const body = await readJson(response);
    if (
      !response.ok
      || !body
      || !isPublicFortuneSession(body.fortuneSession)
      || !isPublicCharge(body.charge)
    ) {
      return false;
    }
    publicFortuneSession = body.fortuneSession;
    currentCharge = body.charge;
    accountAccessState = 'authenticated';
    interactionState = INTERACTION_STATES.LOT_DRAWN;
    renderPaidSummary();
    renderSpeechState();
    return true;
  }

  function initializePaidFortuneState() {
    if (!paidUiEnabled) {
      accountAccessState = 'authenticated';
      return Promise.resolve(true);
    }
    if (paidInitializationPromise) {
      return paidInitializationPromise;
    }
    restoreClientRequestIdFromUrl();
    paidInitializationPromise = Promise.all([
      loadFortunePrice(),
      refreshFortuneAccount(),
    ]).then(async () => {
      await restorePaidFortuneFromUrl();
      return accountAccessState === 'authenticated';
    }).catch(() => {
      if (!Number.isSafeInteger(drawPriceCents)) {
        drawPriceCents = null;
      }
      if (accountAccessState === 'loading') {
        accountAccessState = 'error';
      }
      renderPaidSummary();
      return false;
    });
    return paidInitializationPromise;
  }

  async function ensurePaidFortuneAccess() {
    await initializePaidFortuneState();
    if (accountAccessState === 'guest') {
      openFortuneLoginGate();
      speechMessage.textContent = '请先登录后求签。';
      return false;
    }
    if (
      accountAccessState !== 'authenticated'
      || !Number.isSafeInteger(drawPriceCents)
      || !Number.isSafeInteger(accountBalanceCents)
    ) {
      speechMessage.textContent = '暂时无法确认当前话费，请稍后重试。';
      return false;
    }
    if (accountBalanceCents < drawPriceCents) {
      interactionState = INTERACTION_STATES.INSUFFICIENT_BALANCE;
      renderSpeechState();
      return false;
    }
    return true;
  }

  function isPublicInterpretationResponse(value, sessionId) {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || value.sessionId !== sessionId
      || !value.interpretation
      || typeof value.interpretation !== 'object'
      || Array.isArray(value.interpretation)
    ) {
      return false;
    }
    const fields = Object.keys(value.interpretation);
    return fields.length === 1
      && fields[0] === 'text'
      && typeof value.interpretation.text === 'string'
      && value.interpretation.text.trim() !== '';
  }

  function isInterpretationAudioResponse(response, audioBlob) {
    if (
      !response
      || !response.ok
      || !response.headers
      || typeof response.headers.get !== 'function'
      || !audioBlob
      || typeof audioBlob.size !== 'number'
      || audioBlob.size <= 0
    ) {
      return false;
    }
    const contentType = response.headers.get('content-type');
    return typeof contentType === 'string'
      && contentType.split(';', 1)[0].trim().toLowerCase() === 'audio/mpeg';
  }

  function bindInterpretationAudioEvents(audioElement, sessionId) {
    function isCurrentAudio() {
      return (
        pageIsActive
        && interpretationAudioElement === audioElement
        && interpretationAudioSessionId === sessionId
        && publicFortuneSession
        && publicFortuneSession.id === sessionId
      );
    }

    audioElement.addEventListener('playing', () => {
      if (!isCurrentAudio()) {
        return;
      }
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.PLAYING;
      renderInterpretationAudioState();
    });
    audioElement.addEventListener('pause', () => {
      if (
        !isCurrentAudio()
        || interpretationAudioState === INTERPRETATION_AUDIO_STATES.ENDED
      ) {
        return;
      }
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.PAUSED;
      renderInterpretationAudioState();
    });
    audioElement.addEventListener('ended', () => {
      if (!isCurrentAudio()) {
        return;
      }
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.ENDED;
      renderInterpretationAudioState();
    });
    audioElement.addEventListener('error', () => {
      if (!isCurrentAudio()) {
        return;
      }
      releaseInterpretationAudio();
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.ERROR;
      renderInterpretationAudioState();
    });
  }

  async function playInterpretationAudio(
    audioElement,
    sessionId,
    isAutomatic
  ) {
    if (
      interpretationAudioElement !== audioElement
      || interpretationAudioSessionId !== sessionId
      || !publicFortuneSession
      || publicFortuneSession.id !== sessionId
    ) {
      return false;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.ENDED) {
      audioElement.currentTime = 0;
    }
    interpretationAudioState = INTERPRETATION_AUDIO_STATES.STARTING;
    renderInterpretationAudioState();
    if (isAutomatic) {
      interpretationAudioAutoPlayAttemptCount += 1;
    }
    try {
      const playResult = audioElement.play();
      if (playResult && typeof playResult.then === 'function') {
        await playResult;
      }
      if (
        interpretationAudioElement === audioElement
        && interpretationAudioSessionId === sessionId
        && interpretationAudioState === INTERPRETATION_AUDIO_STATES.STARTING
      ) {
        interpretationAudioState = INTERPRETATION_AUDIO_STATES.PLAYING;
        renderInterpretationAudioState();
      }
      return true;
    } catch (error) {
      if (interpretationAudioElement !== audioElement) {
        return false;
      }
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.ERROR;
      renderInterpretationAudioState();
      return false;
    }
  }

  async function requestInterpretationAudio(autoPlay) {
    if (
      interactionState !== INTERACTION_STATES.LOT_INTERPRETED
      || !publicFortuneSession
      || typeof publicFortuneSession.id !== 'string'
      || publicFortuneSession.id === ''
      || interpretationAudioRequestController !== null
      || interpretationAudioElement !== null
    ) {
      return;
    }
    if (
      typeof window.fetch !== 'function'
      || typeof window.Audio !== 'function'
      || !window.URL
      || typeof window.URL.createObjectURL !== 'function'
      || typeof window.URL.revokeObjectURL !== 'function'
    ) {
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.ERROR;
      renderInterpretationAudioState();
      return;
    }

    const sessionId = publicFortuneSession.id;
    interpretationAudioState = INTERPRETATION_AUDIO_STATES.LOADING;
    renderInterpretationAudioState();
    interpretationAudioRequestGeneration += 1;
    const requestGeneration = interpretationAudioRequestGeneration;
    interpretationAudioRequestController =
      typeof window.AbortController === 'function'
        ? new window.AbortController()
        : { signal: undefined, abort() {} };

    try {
      const response = await window.fetch(
        `${FORTUNE_SESSION_API_URL}/${encodeURIComponent(sessionId)}`
          + '/interpretation-audio',
        {
          method: 'POST',
          signal: interpretationAudioRequestController.signal,
        }
      );
      const audioBlob = await response.blob();
      if (!isInterpretationAudioResponse(response, audioBlob)) {
        throw new Error('Fortune interpretation audio request failed');
      }
      if (
        !pageIsActive
        || requestGeneration !== interpretationAudioRequestGeneration
        || interactionState !== INTERACTION_STATES.LOT_INTERPRETED
        || !publicFortuneSession
        || publicFortuneSession.id !== sessionId
      ) {
        return;
      }

      const objectUrl = window.URL.createObjectURL(audioBlob);
      let audioElement = null;
      try {
        audioElement = new window.Audio();
        audioElement.preload = 'metadata';
        audioElement.src = objectUrl;
      } catch (error) {
        window.URL.revokeObjectURL(objectUrl);
        throw error;
      }

      interpretationAudioElement = audioElement;
      interpretationAudioObjectUrl = objectUrl;
      interpretationAudioSessionId = sessionId;
      bindInterpretationAudioEvents(audioElement, sessionId);
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.READY;
      renderInterpretationAudioState();
      if (autoPlay) {
        await playInterpretationAudio(audioElement, sessionId, true);
      }
    } catch (error) {
      if (
        !pageIsActive
        || requestGeneration !== interpretationAudioRequestGeneration
        || interactionState !== INTERACTION_STATES.LOT_INTERPRETED
      ) {
        return;
      }
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.ERROR;
      renderInterpretationAudioState();
    } finally {
      if (requestGeneration === interpretationAudioRequestGeneration) {
        interpretationAudioRequestController = null;
      }
    }
  }

  async function handleInterpretationAudioControl() {
    if (
      interactionState !== INTERACTION_STATES.LOT_INTERPRETED
      || !publicFortuneSession
      || !publicInterpretation
      || interpretationAudioState === INTERPRETATION_AUDIO_STATES.LOADING
      || interpretationAudioState === INTERPRETATION_AUDIO_STATES.STARTING
    ) {
      return;
    }
    if (
      !interpretationAudioElement
      || interpretationAudioSessionId !== publicFortuneSession.id
    ) {
      await requestInterpretationAudio(false);
      return;
    }

    const audioElement = interpretationAudioElement;
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.PLAYING) {
      audioElement.pause();
      if (
        interpretationAudioElement === audioElement
        && interpretationAudioState === INTERPRETATION_AUDIO_STATES.PLAYING
      ) {
        interpretationAudioState = INTERPRETATION_AUDIO_STATES.PAUSED;
        renderInterpretationAudioState();
      }
      return;
    }
    await playInterpretationAudio(
      audioElement,
      publicFortuneSession.id,
      false
    );
  }

  function updateWishPaper(text, isFinal) {
    if (typeof text !== 'string' || text.trim() === '') {
      return false;
    }
    const nextText = isFinal ? text.trim() : text;
    if (!isFinal && nextText === currentTranscript) {
      return false;
    }
    currentTranscript = nextText;
    transcriptIsFinal = isFinal;
    transcriptStatus.textContent = isFinal
      ? '心愿已记下'
      : '道童正在代您记下……';
    transcriptText.textContent = nextText;
    setWishPaperBusy(!isFinal);
    return true;
  }

  function renderInteractionError(kind, message) {
    page.dataset.fortuneState = interactionState;
    page.classList.remove('is-listening');
    page.classList.remove('has-microphone-error', 'has-asr-error');
    if (kind === 'microphone') {
      page.classList.add('has-microphone-error');
      speechTitle.textContent = '暂时无法使用麦克风';
      speechDetail.textContent =
        '请检查浏览器或系统的麦克风权限。';
    } else if (kind === 'worklet') {
      page.classList.add('has-asr-error');
      speechTitle.textContent = '语音识别暂时不可用';
      speechDetail.textContent =
        '如果问题仍然存在，请重新打开求签页面。';
    } else {
      page.classList.add('has-asr-error');
      speechTitle.textContent = '语音识别暂时不可用';
      speechDetail.textContent =
        '请确认语音识别服务已启动后再试。';
    }
    speechTitle.hidden = false;
    speechMessage.hidden = false;
    speechMessage.textContent = message;
    speakControlButton.setAttribute('aria-pressed', 'false');
    speakControlButton.textContent = '开始说话';
    speakControlButton.disabled = false;
    speakControlButton.hidden = false;
    setWishPaperBusy(false);
  }

  function closeActiveAsrSession() {
    const sessionToClose = activeAsrSession;
    activeAsrSession = null;
    if (sessionToClose) {
      sessionToClose.close();
    }
  }

  function startSpeakingSession() {
    if (
      activeAsrSession
      || (
        interactionState !== INTERACTION_STATES.READY_TO_SPEAK
        && interactionState !== INTERACTION_STATES.MICROPHONE_ERROR
        && interactionState !== INTERACTION_STATES.ASR_ERROR
      )
    ) {
      return false;
    }
    if (
      !window.FortuneAsrBrowser
      || typeof window.FortuneAsrBrowser.createSession !== 'function'
    ) {
      interactionState = INTERACTION_STATES.ASR_ERROR;
      renderInteractionError(
        'asr',
        '当前页面暂时无法启动语音识别，请重新诉说。'
      );
      return false;
    }

    if (activeFortuneClientRequestId === '') {
      activeFortuneClientRequestId = paidUiEnabled
        ? createClientRequestId()
        : '00000000-0000-4000-8000-000000000001';
      replaceFortuneUrlState({
        requestId: activeFortuneClientRequestId,
      });
    }
    currentCharge = null;
    closeActiveAsrSession();
    resetWishPaper();
    finishRequested = false;
    interactionState = INTERACTION_STATES.REQUESTING_MICROPHONE;
    renderSpeechState();
    const generation = ++sessionGeneration;
    let session = null;

    function isCurrentSession() {
      return pageIsActive
        && generation === sessionGeneration
        && activeAsrSession === session;
    }

    session = window.FortuneAsrBrowser.createSession({
      onConnecting() {
        if (!isCurrentSession()) {
          return;
        }
        interactionState = INTERACTION_STATES.CONNECTING_ASR;
        renderSpeechState();
      },
      onStarted() {
        if (!isCurrentSession()) {
          return;
        }
        interactionState = INTERACTION_STATES.LISTENING;
        renderSpeechState();
        if (finishRequested) {
          finishSpeaking();
        }
      },
      onPartial(text) {
        if (
          !isCurrentSession()
          || (
            interactionState !== INTERACTION_STATES.LISTENING
            && interactionState !== INTERACTION_STATES.FINISHING_ASR
          )
        ) {
          return;
        }
        updateWishPaper(text, false);
      },
      onFinal(text, completesSession) {
        if (
          !isCurrentSession()
          || (
            interactionState !== INTERACTION_STATES.LISTENING
            && interactionState !== INTERACTION_STATES.FINISHING_ASR
          )
        ) {
          return;
        }
        const finalUpdated = updateWishPaper(text, true);
        if (completesSession && finalUpdated) {
          startAutomaticWishOffering(generation, session);
        } else if (completesSession && !finalUpdated) {
          recoverFromInvalidTranscript(generation, session);
        }
      },
      onTranscriptReady() {
        if (!isCurrentSession()) {
          return;
        }
        if (!transcriptIsFinal || currentTranscript.trim() === '') {
          recoverFromInvalidTranscript(generation, session);
          return;
        }
        startAutomaticWishOffering(generation, session);
      },
      onFinishing() {
        if (!isCurrentSession()) {
          return;
        }
        interactionState = INTERACTION_STATES.FINISHING_ASR;
        renderSpeechState();
      },
      onError(error) {
        if (
          !isCurrentSession()
          || (
            interactionState !== INTERACTION_STATES.REQUESTING_MICROPHONE
            && interactionState !== INTERACTION_STATES.CONNECTING_ASR
            && interactionState !== INTERACTION_STATES.LISTENING
            && interactionState !== INTERACTION_STATES.FINISHING_ASR
          )
        ) {
          return;
        }
        activeAsrSession = null;
        finishRequested = false;
        resetWishPaper();
        const microphoneError = error.kind === 'microphone';
        const workletError = error.kind === 'worklet';
        interactionState = microphoneError
          ? INTERACTION_STATES.MICROPHONE_ERROR
          : INTERACTION_STATES.ASR_ERROR;
        renderInteractionError(
          microphoneError
            ? 'microphone'
            : workletError
              ? 'worklet'
              : 'asr',
          microphoneError || workletError
            ? error.message
            : '暂时无法连接语音识别服务，请确认服务已启动后重试。'
        );
      },
      onClosed() {
        if (!isCurrentSession()) {
          return;
        }
        activeAsrSession = null;
      },
    });
    activeAsrSession = session;
    Promise.resolve(session.start()).catch(() => {
      if (!isCurrentSession()) {
        return;
      }
      activeAsrSession = null;
      resetWishPaper();
      interactionState = INTERACTION_STATES.ASR_ERROR;
      renderInteractionError(
        'asr',
        '暂时无法连接语音识别服务，请确认服务已启动后重试。'
      );
    });
    return true;
  }

  function finishSpeaking() {
    if (
      interactionState !== INTERACTION_STATES.LISTENING
      || !activeAsrSession
    ) {
      return false;
    }
    return activeAsrSession.finish();
  }

  function recoverFromInvalidTranscript(generation, session) {
    if (
      generation !== sessionGeneration
      || activeAsrSession !== session
    ) {
      return false;
    }
    closeActiveAsrSession();
    resetWishPaper();
    interactionState = INTERACTION_STATES.READY_TO_SPEAK;
    renderSpeechState();
    speechMessage.textContent = '没有听清，请点击“开始说话”重新诉说。';
    return true;
  }

  function requestFinishSpeaking() {
    if (
      finishRequested
      || !activeAsrSession
      || (
        interactionState !== INTERACTION_STATES.REQUESTING_MICROPHONE
        && interactionState !== INTERACTION_STATES.CONNECTING_ASR
        && interactionState !== INTERACTION_STATES.LISTENING
      )
    ) {
      return false;
    }

    finishRequested = true;
    if (interactionState === INTERACTION_STATES.LISTENING) {
      const finishResult = finishSpeaking();
      if (finishResult === false) {
        finishRequested = false;
        renderSpeechState();
        return false;
      }
    }

    renderSpeechState();
    return true;
  }

  function handleSpeakControlClick() {
    if (
      interactionState === INTERACTION_STATES.READY_TO_SPEAK
      || interactionState === INTERACTION_STATES.MICROPHONE_ERROR
      || interactionState === INTERACTION_STATES.ASR_ERROR
    ) {
      if (!paidUiEnabled) {
        startSpeakingSession();
        return;
      }
      void ensurePaidFortuneAccess().then((hasAccess) => {
        if (hasAccess) {
          startSpeakingSession();
        }
      });
      return;
    }

    requestFinishSpeaking();
  }

  function completeWishOffering(generation) {
    if (
      !pageIsActive
      || generation !== sessionGeneration
      || generation !== wishOfferingGeneration
      || interactionState !== INTERACTION_STATES.OFFERING_WISH
    ) {
      return false;
    }
    clearWishOfferingResources();
    interactionState = INTERACTION_STATES.DRAW_READY;
    renderSpeechState();
    if (typeof wishOfferingComplete.focus === 'function') {
      wishOfferingComplete.focus();
    }
    Promise.resolve().then(() => {
      if (
        pageIsActive
        && generation === sessionGeneration
        && generation === wishOfferingGeneration
        && interactionState === INTERACTION_STATES.DRAW_READY
      ) {
        void handleFortuneDraw();
      }
    });
    return true;
  }

  function startAutomaticWishOffering(generation, session) {
    if (
      !pageIsActive
      || generation !== sessionGeneration
      || activeAsrSession !== session
      || interactionState !== INTERACTION_STATES.FINISHING_ASR
      || !transcriptIsFinal
      || currentTranscript.trim() === ''
      || wishOfferingGeneration !== null
    ) {
      return false;
    }
    currentTranscript = currentTranscript.trim();
    transcriptText.textContent = currentTranscript;
    wishOfferingGeneration = generation;
    interactionState = INTERACTION_STATES.OFFERING_WISH;
    prepareWishOfferingVisual();
    renderSpeechState();
    wishOfferingStage.classList.add('is-active');
    const animationHandler = (event) => {
      if (!event || event.target !== wishOfferingStage) {
        return;
      }
      if (
        event.animationName !== 'wish-offering-stage-sequence'
        && event.animationName !== 'wish-offering-stage-sequence-reduced'
      ) {
        return;
      }
      completeWishOffering(generation);
    };
    wishOfferingAnimationHandler = animationHandler;
    wishOfferingStage.addEventListener(
      'animationend',
      animationHandler
    );
    wishOfferingTimer = window.setTimeout(
      () => completeWishOffering(generation),
      prefersReducedMotion()
        ? REDUCED_WISH_OFFERING_FALLBACK_MS
        : WISH_OFFERING_FALLBACK_MS
    );
    Promise.resolve().then(() => {
      if (
        pageIsActive
        && generation === sessionGeneration
        && activeAsrSession === session
      ) {
        closeActiveAsrSession();
      }
    });
    return true;
  }

  async function handleFortuneDraw() {
    if (
      (
        interactionState !== INTERACTION_STATES.DRAW_READY
        && interactionState !== INTERACTION_STATES.LOT_ERROR
        && interactionState !== INTERACTION_STATES.INSUFFICIENT_BALANCE
      )
      || !transcriptIsFinal
      || currentTranscript.trim() === ''
      || activeFortuneClientRequestId === ''
      || fortuneRequestController !== null
    ) {
      return;
    }

    interactionState = INTERACTION_STATES.DRAWING_LOT;
    releaseInterpretationAudio();
    publicFortuneSession = null;
    fortuneRequestGeneration += 1;
    const requestGeneration = fortuneRequestGeneration;
    renderSpeechState();
    startFortuneDrawAnimation(requestGeneration);
    fortuneRequestController = typeof window.AbortController === 'function'
      ? new window.AbortController()
      : { signal: undefined, abort() {} };

    try {
      const response = await window.fetch(FORTUNE_SESSION_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientRequestId: activeFortuneClientRequestId,
          characterKey: resolveRequestedCharacterKey(),
          situationText: currentTranscript.trim(),
        }),
        signal: fortuneRequestController.signal,
      });
      const responseBody = await response.json();
      if (!response.ok) {
        const requestError = new Error('Fortune Session request failed');
        requestError.responseStatus = response.status;
        requestError.responseBody = responseBody;
        throw requestError;
      }
      if (
        !responseBody
        || !isPublicFortuneSession(responseBody.fortuneSession)
        || !isPublicCharge(responseBody.charge)
      ) {
        throw new Error('Fortune Session response was invalid');
      }
      if (
        !pageIsActive
        || requestGeneration !== fortuneRequestGeneration
        || interactionState !== INTERACTION_STATES.DRAWING_LOT
      ) {
        return;
      }

      publicFortuneSession = responseBody.fortuneSession;
      currentCharge = responseBody.charge;
      accountBalanceCents = responseBody.charge.balanceAfterCents;
      accountAccessState = 'authenticated';
      renderPaidSummary();
      publishAccountBalance(accountBalanceCents);
      replaceFortuneUrlState({
        sessionId: publicFortuneSession.id,
      });
      if (paidUiEnabled) {
        void refreshFortuneAccount();
      }
      if (drawShakeComplete) {
        startFortuneReveal(requestGeneration);
      }
    } catch (error) {
      if (
        !pageIsActive
        || requestGeneration !== fortuneRequestGeneration
        || interactionState !== INTERACTION_STATES.DRAWING_LOT
      ) {
        return;
      }
      const errorCode = error
        && error.responseBody
        && error.responseBody.error
        && error.responseBody.error.code;
      if (errorCode === 'USER_LOGIN_REQUIRED') {
        clearDrawAnimation();
        accountAccessState = 'guest';
        renderPaidSummary();
        interactionState = INTERACTION_STATES.DRAW_READY;
        renderSpeechState();
        openFortuneLoginGate();
        return;
      }
      if (errorCode === 'INSUFFICIENT_ACCOUNT_BALANCE') {
        const details = error.responseBody.error;
        if (
          Number.isSafeInteger(details.priceCents)
          && Number.isSafeInteger(details.balanceCents)
          && Number.isSafeInteger(details.shortfallCents)
          && details.shortfallCents
            === details.priceCents - details.balanceCents
        ) {
          drawPriceCents = details.priceCents;
          accountBalanceCents = details.balanceCents;
          accountAccessState = 'authenticated';
          renderPaidSummary();
        }
        clearDrawAnimation();
        interactionState = INTERACTION_STATES.INSUFFICIENT_BALANCE;
        renderSpeechState();
        if (
          !fortuneInsufficientOverlay
          && typeof fortuneError.focus === 'function'
        ) {
          fortuneError.focus();
        }
        return;
      }
      clearDrawAnimation();
      interactionState = INTERACTION_STATES.LOT_ERROR;
      renderSpeechState();
      if (typeof fortuneError.focus === 'function') {
        fortuneError.focus();
      }
    } finally {
      if (requestGeneration === fortuneRequestGeneration) {
        fortuneRequestController = null;
      }
    }
  }

  async function handleFortuneInterpretation() {
    if (
      (
        interactionState !== INTERACTION_STATES.LOT_DRAWN
        && interactionState !== INTERACTION_STATES.INTERPRETATION_ERROR
      )
      || !publicFortuneSession
      || typeof publicFortuneSession.id !== 'string'
      || publicFortuneSession.id === ''
      || interpretationRequestController !== null
    ) {
      return;
    }

    const sessionId = publicFortuneSession.id;
    interactionState = INTERACTION_STATES.INTERPRETING_LOT;
    releaseInterpretationAudio();
    publicInterpretation = null;
    renderSpeechState();
    interpretationRequestGeneration += 1;
    const requestGeneration = interpretationRequestGeneration;
    interpretationRequestController =
      typeof window.AbortController === 'function'
        ? new window.AbortController()
        : { signal: undefined, abort() {} };

    try {
      const response = await window.fetch(
        `${FORTUNE_SESSION_API_URL}/${encodeURIComponent(sessionId)}`
          + '/interpretation',
        {
          method: 'POST',
          signal: interpretationRequestController.signal,
        }
      );
      const responseBody = await response.json();
      if (
        !response.ok
        || !isPublicInterpretationResponse(responseBody, sessionId)
      ) {
        throw new Error('Fortune interpretation request failed');
      }
      if (
        !pageIsActive
        || requestGeneration !== interpretationRequestGeneration
        || interactionState !== INTERACTION_STATES.INTERPRETING_LOT
      ) {
        return;
      }

      publicInterpretation = {
        text: responseBody.interpretation.text,
      };
      interactionState = INTERACTION_STATES.LOT_INTERPRETED;
      renderSpeechState();
      if (typeof interpretationResult.focus === 'function') {
        interpretationResult.focus();
      }
      await requestInterpretationAudio(true);
    } catch (error) {
      if (
        !pageIsActive
        || requestGeneration !== interpretationRequestGeneration
        || interactionState !== INTERACTION_STATES.INTERPRETING_LOT
      ) {
        return;
      }
      interactionState = INTERACTION_STATES.INTERPRETATION_ERROR;
      renderSpeechState();
      if (typeof interpretationError.focus === 'function') {
        interpretationError.focus();
      }
    } finally {
      if (requestGeneration === interpretationRequestGeneration) {
        interpretationRequestController = null;
      }
    }
  }

  function handlePageExit() {
    pageIsActive = false;
    sessionGeneration += 1;
    fortuneRequestGeneration += 1;
    if (fortuneRequestController !== null) {
      fortuneRequestController.abort();
      fortuneRequestController = null;
    }
    interpretationRequestGeneration += 1;
    if (interpretationRequestController !== null) {
      interpretationRequestController.abort();
      interpretationRequestController = null;
    }
    releaseInterpretationAudio();
    closeActiveAsrSession();
    clearWishOfferingResources();
    clearDrawAnimation();
    if (activeFortuneOverlay) {
      closeFortuneOverlay(activeFortuneOverlay, false);
    }
    finishRequested = false;
    interactionState = INTERACTION_STATES.READY_TO_SPEAK;
  }

  function handlePageShow() {
    pageIsActive = true;
    if (hasSeenInitialPageShow && paidUiEnabled) {
      void refreshFortuneAccount();
    }
    hasSeenInitialPageShow = true;
    if (interactionState === INTERACTION_STATES.READY_TO_SPEAK) {
      resetWishPaper();
      renderSpeechState();
    }
  }

  async function handleAccountBalanceUpdated(event) {
    if (!paidUiEnabled) {
      return;
    }
    const detail = event && event.detail;
    if (
      detail
      && detail.currency === 'CNY'
      && Number.isSafeInteger(detail.balanceCents)
    ) {
      accountAccessState = 'authenticated';
      accountBalanceCents = detail.balanceCents;
      renderPaidSummary();
    } else {
      await refreshFortuneAccount();
    }
    if (
      interactionState === INTERACTION_STATES.INSUFFICIENT_BALANCE
      && Number.isSafeInteger(drawPriceCents)
      && Number.isSafeInteger(accountBalanceCents)
      && accountBalanceCents >= drawPriceCents
    ) {
      if (
        transcriptIsFinal
        && currentTranscript.trim() !== ''
        && activeFortuneClientRequestId !== ''
      ) {
        void handleFortuneDraw();
      } else {
        interactionState = INTERACTION_STATES.READY_TO_SPEAK;
        renderSpeechState();
      }
    }
  }

  function navigateToFortuneLogin() {
    const characterKey = resolveRequestedCharacterKey();
    window.location.assign(
      './index.html?mode=phone&returnAction=fortune'
        + `&characterKey=${encodeURIComponent(characterKey)}`
    );
  }

  page.addEventListener(
    'pointerdown',
    handleFortuneSceneSwipePointerDown
  );
  page.addEventListener(
    'pointerup',
    handleFortuneSceneSwipePointerEnd
  );
  page.addEventListener(
    'pointercancel',
    handleFortuneSceneSwipePointerCancel
  );
  page.addEventListener(
    'lostpointercapture',
    handleFortuneSceneSwipePointerCancel
  );

  speakControlButton.addEventListener(
    'click',
    handleSpeakControlClick
  );
  retryFortuneButton.addEventListener('click', handleFortuneDraw);
  if (fortuneRechargeButton) {
    fortuneRechargeButton.addEventListener('click', openFortuneRecharge);
  }
  if (fortunePricingTrigger && fortunePricingOverlay) {
    fortunePricingTrigger.addEventListener('click', openFortunePricing);
  }
  if (closeFortunePricingButton) {
    closeFortunePricingButton.addEventListener('click', () => {
      closeFortuneOverlay(fortunePricingOverlay, true);
    });
  }
  if (fortuneInsufficientRechargeButton) {
    fortuneInsufficientRechargeButton.addEventListener(
      'click',
      openFortuneRecharge
    );
  }
  if (closeFortuneInsufficientButton) {
    closeFortuneInsufficientButton.addEventListener(
      'click',
      dismissFortuneInsufficientBalance
    );
  }
  if (fortunePricingOverlay) {
    fortunePricingOverlay.addEventListener(
      'click',
      handleFortuneOverlayBackdropClick
    );
  }
  if (fortuneInsufficientOverlay) {
    fortuneInsufficientOverlay.addEventListener(
      'click',
      handleFortuneOverlayBackdropClick
    );
  }
  if (loginForFortuneButton) {
    loginForFortuneButton.addEventListener('click', navigateToFortuneLogin);
  }
  if (closeFortuneLoginButton) {
    closeFortuneLoginButton.addEventListener(
      'click',
      closeFortuneLoginGate
    );
  }
  interpretFortuneButton.addEventListener(
    'click',
    handleFortuneInterpretation
  );
  retryInterpretationButton.addEventListener(
    'click',
    handleFortuneInterpretation
  );
  interpretationAudioControl.addEventListener(
    'click',
    handleInterpretationAudioControl
  );
  resetFortuneButton.addEventListener('click', resetCompletedFortune);
  fortuneReturnLink.addEventListener('click', resetCompletedFortune);
  page.classList.add('has-offered-incense');
  incenseState.textContent = '三柱清香已燃';
  acolyteGuidance.textContent =
    '点击下方“开始说话”，说完后再点击“结束说话”。';
  resetWishPaper();
  renderSpeechState();
  renderPaidSummary();
  const paidStateReadyPromise = initializePaidFortuneState();
  if (
    window.XianBanStartup
    && typeof window.XianBanStartup.registerTask === 'function'
  ) {
    const startup = window.XianBanStartup;
    startup.registerTask(
      'fortune-scene-image',
      fortuneSceneReadyPromise,
      {
        blocking: false,
        failureMessage: '神仙主视觉暂时无法显示，页面已进入降级模式',
      }
    );
    startup.registerTask(
      'fortune-acolyte-image',
      waitForStartupImage(acolyteImage, () => {
        if (acolyteImage) {
          acolyteImage.hidden = true;
        }
        if (acolyteGuidance) {
          acolyteGuidance.textContent = '道童画面暂时无法显示，仍可继续求签';
        }
      }),
      {
        blocking: false,
        failureMessage: '道童画面暂时无法显示，页面已进入降级模式',
      }
    );
    startup.registerTask(
      'fortune-paid-state',
      paidStateReadyPromise,
      {
        blocking: false,
        failureMessage: '求签价格或账户状态暂时无法同步，页面仍可继续使用',
      }
    );
    startup.registerTask(
      'fortune-asr-api',
      window.FortuneAsrBrowser
        && typeof window.FortuneAsrBrowser.createSession === 'function'
        ? Promise.resolve(true)
        : Promise.reject(new Error('fortune ASR module is unavailable')),
      { failureMessage: '语音识别模块未能加载，请重新加载后再试' }
    );
    startup.registerTask(
      'fortune-asr-worklet',
      preloadStartupResource('/realtime-assets/pcm_capture_processor.js'),
      { failureMessage: '语音识别准备资源未能加载，请重新加载后再试' }
    );
    startup.registerTask(
      'fortune-css-layout',
      waitForStartupLayout(page),
      { failureMessage: '求签页面布局未能稳定，请重新加载后再试' }
    );
    startup.registerTask('fortune-ui-initialization', Promise.resolve(true));
    startup.registerTask('fortune-button-bindings', Promise.resolve(true));
  }
  window.addEventListener(
    'companion:account-balance-updated',
    handleAccountBalanceUpdated
  );
  window.addEventListener('keydown', handleFortuneOverlayKeydown);
  window.addEventListener('pagehide', handlePageExit);
  window.addEventListener('beforeunload', handlePageExit);
  window.addEventListener('pageshow', handlePageShow);
})();
