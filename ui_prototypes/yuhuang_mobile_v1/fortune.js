'use strict';

(() => {
  const WISH_OFFERING_FALLBACK_MS = 3400;
  const REDUCED_WISH_OFFERING_FALLBACK_MS = 180;
  const DRAW_SHAKE_DURATION_MS = 1100;
  const DRAW_REVEAL_DURATION_MS = 1250;
  const REDUCED_DRAW_DURATION_MS = 120;
  const FORTUNE_SESSION_API_URL = '/api/fortune-sessions';
  const FORTUNE_DEITY_KEY = 'yuhuang';
  const DEFAULT_FORTUNE_CHARACTER_KEY = 'yuhuang';
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

  const INTERACTION_STATES = Object.freeze({
    READY_TO_SPEAK: 'ready-to-speak',
    REQUESTING_MICROPHONE: 'requesting-microphone',
    CONNECTING_ASR: 'connecting-asr',
    LISTENING: 'listening',
    FINISHING_ASR: 'finishing-asr',
    OFFERING_WISH: 'offering-wish',
    DRAW_READY: 'draw-ready',
    DRAWING_LOT: 'drawing-lot',
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
  const fortuneCharacterUnavailable = document.querySelector(
    '[data-fortune-character-unavailable]'
  );
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
  const drawFortuneButton = document.querySelector(
    '[data-draw-fortune]'
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
    || !drawFortuneButton
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
  ) {
    return;
  }

  let interactionState = INTERACTION_STATES.READY_TO_SPEAK;
  let activeAsrSession = null;
  let activePointerId = null;
  let keyboardPressActive = false;
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

  function renderUnavailableFortuneCharacter() {
    fortuneCharacterImage.hidden = true;
    fortuneCharacterImage.removeAttribute('src');
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
      return;
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
    fortuneCharacterImage.setAttribute('src', imageSrc);
    fortuneCharacterImage.setAttribute(
      'alt',
      usesIntegratedScene
        ? '当前所选神仙的寺庙求签场景'
        : '当前所选神仙角色主视觉'
    );

    fortuneCharacterImage.addEventListener(
      'error',
      renderUnavailableFortuneCharacter,
      { once: true }
    );
  }

  renderFortuneCharacter();

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
    wishOfferingComplete.hidden = true;
    fortuneDrawAnimation.hidden = true;
    fortuneError.hidden = true;
    fortuneResult.hidden = true;
    drawFortuneButton.disabled = true;
    drawFortuneButton.textContent = '开始抽签';
    retryFortuneButton.disabled = true;
    interpretFortuneButton.hidden = true;
    interpretFortuneButton.disabled = true;
    interpretFortuneButton.textContent = '请道童解签';
    interpretationError.hidden = true;
    retryInterpretationButton.disabled = true;
    interpretationResult.hidden = true;
    interpretationAudio.hidden = true;
    wishPaper.hidden = true;
    wishPaper.setAttribute('aria-hidden', 'true');

    if (interactionState === INTERACTION_STATES.READY_TO_SPEAK) {
      speechTitle.hidden = false;
      speechMessage.hidden = false;
      speakControlButton.hidden = false;
      speechTitle.textContent = '静心诉说';
      speechMessage.textContent =
        '按住诉说，松开后心愿将自动敬呈。';
      speechDetail.textContent =
        '按住时使用麦克风实时识别，松开即停止采集。';
      speakControlButton.textContent = '按住诉说';
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
      speechMessage.textContent = '请允许使用麦克风。';
      speakControlButton.textContent = '松开结束';
      speakControlButton.disabled = false;
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
      speechMessage.textContent = '正在准备聆听，请稍候……';
      speakControlButton.textContent = '松开结束';
      speakControlButton.disabled = false;
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
      speechMessage.textContent = '请慢慢说，松开即结束。';
      speakControlButton.textContent = '松开结束';
      speakControlButton.disabled = false;
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
      speechTitle.textContent = '正在整理心愿';
      speechMessage.textContent = '请稍候，正在写定心愿。';
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
      drawFortuneButton.disabled = (
        !transcriptIsFinal
        || currentTranscript.trim() === ''
      );
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
      lotNumber.textContent = String(publicFortuneSession.lot.number);
      lotLevel.textContent = publicFortuneSession.lot.level;
      lotTitle.textContent = publicFortuneSession.lot.title;
      lotVerses.textContent =
        publicFortuneSession.lot.verseLines.join('\n');
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
    transcriptStatus.textContent = '正在聆听';
    transcriptText.textContent = '';
    setWishPaperBusy(false);
    wishOfferingComplete.hidden = true;
    wishPaper.hidden = true;
    wishPaper.setAttribute('aria-hidden', 'true');
    page.classList.remove('has-offered-wish');
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
    speakControlButton.textContent = '按住重新诉说';
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
        activePointerId = null;
        keyboardPressActive = false;
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
    speechMessage.textContent = '没有听清，请按住重新诉说。';
    return true;
  }

  function requestFinishAfterRelease() {
    finishRequested = true;
    if (interactionState === INTERACTION_STATES.LISTENING) {
      finishSpeaking();
    }
  }

  function handleSpeakPointerDown(event) {
    if (
      activePointerId !== null
      || keyboardPressActive
      || (event && event.isPrimary === false)
      || (event && Number.isFinite(event.button) && event.button !== 0)
    ) {
      return;
    }
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const pointerId = event && Number.isFinite(event.pointerId)
      ? event.pointerId
      : 1;
    activePointerId = pointerId;
    if (typeof speakControlButton.setPointerCapture === 'function') {
      try {
        speakControlButton.setPointerCapture(pointerId);
      } catch (error) {
        activePointerId = null;
        return;
      }
    }
    if (!startSpeakingSession()) {
      activePointerId = null;
    }
  }

  function handleSpeakPointerEnd(event) {
    if (
      activePointerId === null
      || (
        event
        && Number.isFinite(event.pointerId)
        && event.pointerId !== activePointerId
      )
    ) {
      return;
    }
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const pointerId = activePointerId;
    activePointerId = null;
    requestFinishAfterRelease();
    if (
      event
      && event.type !== 'lostpointercapture'
      && typeof speakControlButton.releasePointerCapture === 'function'
    ) {
      try {
        speakControlButton.releasePointerCapture(pointerId);
      } catch (error) {
        // The capture may already have been released by the browser.
      }
    }
  }

  function isSpeakKey(event) {
    return event && (event.key === ' ' || event.key === 'Enter');
  }

  function handleSpeakKeyDown(event) {
    if (
      !isSpeakKey(event)
      || event.repeat
      || keyboardPressActive
      || activePointerId !== null
    ) {
      return;
    }
    event.preventDefault();
    keyboardPressActive = true;
    if (!startSpeakingSession()) {
      keyboardPressActive = false;
    }
  }

  function handleSpeakKeyUp(event) {
    if (!isSpeakKey(event) || !keyboardPressActive) {
      return;
    }
    event.preventDefault();
    keyboardPressActive = false;
    requestFinishAfterRelease();
  }

  function handleSpeakBlur() {
    if (activePointerId !== null) {
      const pointerId = activePointerId;
      activePointerId = null;
      requestFinishAfterRelease();
      if (typeof speakControlButton.releasePointerCapture === 'function') {
        try {
          speakControlButton.releasePointerCapture(pointerId);
        } catch (error) {
          // The browser may have released capture while losing focus.
        }
      }
    }
    if (keyboardPressActive) {
      keyboardPressActive = false;
      requestFinishAfterRelease();
    }
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
      )
      || !transcriptIsFinal
      || currentTranscript.trim() === ''
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
          deityKey: FORTUNE_DEITY_KEY,
          situationText: currentTranscript.trim(),
        }),
        signal: fortuneRequestController.signal,
      });
      const responseBody = await response.json();
      if (
        !response.ok
        || !responseBody
        || !isPublicFortuneSession(responseBody.fortuneSession)
      ) {
        throw new Error('Fortune Session request failed');
      }
      if (
        !pageIsActive
        || requestGeneration !== fortuneRequestGeneration
        || interactionState !== INTERACTION_STATES.DRAWING_LOT
      ) {
        return;
      }

      publicFortuneSession = responseBody.fortuneSession;
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
    activePointerId = null;
    keyboardPressActive = false;
    finishRequested = false;
    interactionState = INTERACTION_STATES.READY_TO_SPEAK;
  }

  function handlePageShow() {
    pageIsActive = true;
    if (interactionState === INTERACTION_STATES.READY_TO_SPEAK) {
      resetWishPaper();
      renderSpeechState();
    }
  }

  speakControlButton.addEventListener(
    'pointerdown',
    handleSpeakPointerDown
  );
  speakControlButton.addEventListener('pointerup', handleSpeakPointerEnd);
  speakControlButton.addEventListener(
    'pointercancel',
    handleSpeakPointerEnd
  );
  speakControlButton.addEventListener(
    'lostpointercapture',
    handleSpeakPointerEnd
  );
  speakControlButton.addEventListener('keydown', handleSpeakKeyDown);
  speakControlButton.addEventListener('keyup', handleSpeakKeyUp);
  drawFortuneButton.addEventListener('click', handleFortuneDraw);
  retryFortuneButton.addEventListener('click', handleFortuneDraw);
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
  page.classList.add('has-offered-incense');
  incenseState.textContent = '三柱清香已燃';
  acolyteGuidance.textContent = '按住下方按钮，慢慢诉说您的心愿。';
  resetWishPaper();
  renderSpeechState();
  window.addEventListener('blur', handleSpeakBlur);
  window.addEventListener('pagehide', handlePageExit);
  window.addEventListener('beforeunload', handlePageExit);
  window.addEventListener('pageshow', handlePageShow);
})();
