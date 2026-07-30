'use strict';

(() => {
  const OFFERING_DURATION_MS = 1800;
  const WISH_OFFERING_FALLBACK_MS = 3400;
  const REDUCED_WISH_OFFERING_FALLBACK_MS = 180;
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
  const INTERACTION_STATES = Object.freeze({
    IDLE: 'idle',
    OFFERING_INCENSE: 'offering-incense',
    WAITING_TO_SPEAK: 'waiting-to-speak',
    REQUESTING_MICROPHONE: 'requesting-microphone',
    CONNECTING_ASR: 'connecting-asr',
    SPEAKING: 'speaking',
    FINISHING_ASR: 'finishing-asr',
    WISH_OFFERING: 'wish-offering',
    WISH_OFFERED: 'wish-offered',
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
  const offerIncenseButton = document.querySelector(
    '[data-offer-incense]'
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
    || !offerIncenseButton
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

  let interactionState = INTERACTION_STATES.IDLE;
  let activeAsrSession = null;
  let sessionGeneration = 0;
  let currentTranscript = '';
  let transcriptIsFinal = false;
  let pageIsActive = true;
  let wishOfferingTimer = null;
  let wishOfferingAnimationHandler = null;
  let wishOfferingGeneration = null;
  let fortuneRequestController = null;
  let fortuneRequestGeneration = 0;
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
    const version = characterKey === 'sunwukong' ? 'v2' : 'v1';
    return `./assets/characters/${characterKey}/${characterKey}-home-hero-${version}.png`;
  }

  function renderUnavailableFortuneCharacter() {
    fortuneCharacterImage.hidden = true;
    fortuneCharacterImage.removeAttribute('src');
    fortuneCharacterImage.setAttribute('alt', '');
    fortuneCharacterUnavailable.hidden = false;
    page.dataset.fortuneCharacterKey = 'unavailable';
  }

  function renderFortuneCharacter() {
    const characterKey = resolveRequestedCharacterKey();
    const imageSrc = resolveFortuneCharacterImageSrc(characterKey);
    if (imageSrc === null) {
      renderUnavailableFortuneCharacter();
      return;
    }

    page.dataset.fortuneCharacterKey = characterKey;
    fortuneCharacterUnavailable.hidden = true;
    fortuneCharacterImage.hidden = false;
    fortuneCharacterImage.dataset.characterKey = characterKey;
    fortuneCharacterImage.setAttribute('src', imageSrc);
    fortuneCharacterImage.setAttribute(
      'alt',
      '当前所选神仙角色主视觉'
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
    interpretationAudioControl.disabled = false;
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.LOADING) {
      interpretationAudioStatus.textContent =
        '正在准备解签语音，请稍候。';
      interpretationAudioControl.textContent = '正在准备语音……';
      interpretationAudioControl.disabled = true;
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.READY) {
      interpretationAudioStatus.textContent =
        '语音已准备好，请点击播放。';
      interpretationAudioControl.textContent = '播放解签语音';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.STARTING) {
      interpretationAudioStatus.textContent =
        '正在开始播放解签语音。';
      interpretationAudioControl.textContent = '正在播放……';
      interpretationAudioControl.disabled = true;
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.PLAYING) {
      interpretationAudioStatus.textContent = '正在播放解签语音。';
      interpretationAudioControl.textContent = '暂停解签语音';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.PAUSED) {
      interpretationAudioStatus.textContent = '已暂停，可继续播放。';
      interpretationAudioControl.textContent = '继续播放';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.ENDED) {
      interpretationAudioStatus.textContent = '播放完毕，可重新播放。';
      interpretationAudioControl.textContent = '重新播放';
      return;
    }
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.ERROR) {
      interpretationAudioStatus.textContent =
        '解签语音暂时无法播放，请稍后重试。';
      interpretationAudioControl.textContent = interpretationAudioElement
        ? '再次播放'
        : '重新获取解签语音';
      return;
    }
    interpretationAudioStatus.textContent =
      '需要时，可请道童为您读出这份解签。';
    interpretationAudioControl.textContent = '听道童解签';
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

  function renderSpeechState() {
    page.classList.remove(
      'is-listening',
      'has-microphone-error',
      'has-asr-error',
      'has-offered-wish'
    );
    speakControlButton.hidden = false;
    wishOfferingComplete.hidden = true;
    fortuneError.hidden = true;
    fortuneResult.hidden = true;
    drawFortuneButton.disabled = true;
    drawFortuneButton.textContent = '诚心求一签';
    retryFortuneButton.disabled = true;
    interpretFortuneButton.hidden = true;
    interpretFortuneButton.disabled = true;
    interpretFortuneButton.textContent = '请道童解签';
    interpretationError.hidden = true;
    retryInterpretationButton.disabled = true;
    interpretationResult.hidden = true;
    interpretationAudio.hidden = true;
    wishPaper.hidden = false;
    wishPaper.removeAttribute('aria-hidden');

    if (interactionState === INTERACTION_STATES.WAITING_TO_SPEAK) {
      speechTitle.textContent = '等待诉说';
      speechMessage.textContent =
        '请慢慢说，道童会在殿前听您诉说。';
      speechDetail.textContent =
        '语音只用于当前识别，不会录制为音频文件。';
      speakControlButton.textContent = '开始诉说';
      speakControlButton.disabled = false;
      setWishPaperBusy(false);
      return;
    }

    if (
      interactionState === INTERACTION_STATES.REQUESTING_MICROPHONE
    ) {
      speechTitle.textContent = '请求麦克风权限';
      speechMessage.textContent = '请允许使用麦克风。';
      speechDetail.textContent =
        '授权后将连接语音识别服务。';
      speakControlButton.textContent = '正在打开麦克风……';
      speakControlButton.disabled = true;
      setWishPaperBusy(false);
      return;
    }

    if (interactionState === INTERACTION_STATES.CONNECTING_ASR) {
      speechTitle.textContent = '正在准备聆听';
      speechMessage.textContent = '正在准备聆听，请稍候……';
      speechDetail.textContent =
        '连接完成后再开始诉说，以免遗漏开头。';
      speakControlButton.textContent = '正在准备……';
      speakControlButton.disabled = true;
      transcriptStatus.textContent = '准备代您记录';
      setWishPaperBusy(true);
      return;
    }

    if (interactionState === INTERACTION_STATES.SPEAKING) {
      page.classList.add('is-listening');
      speechTitle.textContent = '道童正在聆听';
      speechMessage.textContent = '道童正在聆听，请慢慢说。';
      speechDetail.textContent =
        '语音正用于实时识别，不会录制为音频文件。';
      speakControlButton.textContent = '我说完了';
      speakControlButton.disabled = false;
      if (currentTranscript === '') {
        transcriptStatus.textContent = '道童正在代您记下……';
      }
      setWishPaperBusy(true);
      return;
    }

    if (interactionState === INTERACTION_STATES.FINISHING_ASR) {
      speechTitle.textContent = '正在整理您的话';
      speechMessage.textContent = '正在整理您的话……';
      speechDetail.textContent = '请稍候，正在等待最终识别结果。';
      speakControlButton.textContent = '正在识别……';
      speakControlButton.disabled = true;
      transcriptStatus.textContent = '正在整理您的话……';
      setWishPaperBusy(true);
      return;
    }

    if (interactionState === INTERACTION_STATES.WISH_OFFERING) {
      page.classList.add('is-wish-offering');
      speechTitle.textContent = '心愿已记下';
      speechMessage.textContent =
        '心愿已记下，正在投入焚愿炉……';
      speechDetail.textContent =
        '心愿纸进入炉口后，将焚化为轻烟敬呈。';
      speakControlButton.textContent = '正在呈愿';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
      transcriptStatus.textContent = '正在呈愿';
      setWishPaperBusy(true);
      wishPaper.setAttribute('aria-hidden', 'true');
      return;
    }

    if (interactionState === INTERACTION_STATES.WISH_OFFERED) {
      page.classList.add('has-offered-wish');
      speechTitle.textContent = '心愿已呈';
      speechMessage.textContent = '呈愿完成，可以求签。';
      speechDetail.textContent = '下一步将为您诚心求取一签。';
      speakControlButton.textContent = '心愿已呈';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
      setWishPaperBusy(false);
      wishPaper.setAttribute('aria-hidden', 'true');
      wishPaper.hidden = true;
      wishOfferingComplete.hidden = false;
      drawFortuneButton.disabled = (
        !transcriptIsFinal
        || currentTranscript.trim() === ''
      );
      return;
    }

    if (interactionState === INTERACTION_STATES.DRAWING_LOT) {
      page.classList.add('has-offered-wish');
      wishPaper.hidden = true;
      wishPaper.setAttribute('aria-hidden', 'true');
      wishOfferingComplete.hidden = false;
      drawFortuneButton.disabled = true;
      drawFortuneButton.textContent = '正在请签……';
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
      page.classList.add('has-offered-wish');
      wishPaper.hidden = true;
      wishPaper.setAttribute('aria-hidden', 'true');
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
    wishOfferingGeneration = null;
    currentTranscript = '';
    transcriptIsFinal = false;
    publicFortuneSession = null;
    publicInterpretation = null;
    transcriptStatus.textContent = '等待诉说';
    transcriptText.textContent = '您的话会写在这里。';
    setWishPaperBusy(false);
    wishOfferingComplete.hidden = true;
    wishPaper.hidden = false;
    wishPaper.removeAttribute('aria-hidden');
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

  async function requestInterpretationAudio() {
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
      await requestInterpretationAudio();
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
    if (interpretationAudioState === INTERPRETATION_AUDIO_STATES.ENDED) {
      audioElement.currentTime = 0;
    }

    interpretationAudioState = INTERPRETATION_AUDIO_STATES.STARTING;
    renderInterpretationAudioState();
    try {
      const playResult = audioElement.play();
      if (playResult && typeof playResult.then === 'function') {
        await playResult;
      }
      if (
        interpretationAudioElement === audioElement
        && interpretationAudioSessionId === publicFortuneSession.id
        && interpretationAudioState === INTERPRETATION_AUDIO_STATES.STARTING
      ) {
        interpretationAudioState = INTERPRETATION_AUDIO_STATES.PLAYING;
        renderInterpretationAudioState();
      }
    } catch (error) {
      if (interpretationAudioElement !== audioElement) {
        return;
      }
      interpretationAudioState = INTERPRETATION_AUDIO_STATES.ERROR;
      renderInterpretationAudioState();
    }
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
    speechMessage.textContent = message;
    speakControlButton.textContent = '重新诉说';
    speakControlButton.disabled = false;
    speakControlButton.hidden = false;
    setWishPaperBusy(false);
  }

  function completeIncenseOffering() {
    if (interactionState !== INTERACTION_STATES.OFFERING_INCENSE) {
      return;
    }

    interactionState = INTERACTION_STATES.WAITING_TO_SPEAK;
    page.classList.remove('is-offering-incense');
    page.classList.add('has-offered-incense');
    offerIncenseButton.disabled = true;
    offerIncenseButton.textContent = '香火已敬';
    incenseState.textContent = '香火已起';
    acolyteGuidance.textContent =
      '香火已起，请慢慢说说您的处境。';
    waitingState.hidden = false;
    renderSpeechState();
  }

  function handleIncenseOffering() {
    if (interactionState !== INTERACTION_STATES.IDLE) {
      return;
    }

    interactionState = INTERACTION_STATES.OFFERING_INCENSE;
    offerIncenseButton.disabled = true;
    offerIncenseButton.textContent = '正在敬香……';
    incenseState.textContent = '香火正在点亮';
    page.classList.add('is-offering-incense');

    if (prefersReducedMotion()) {
      completeIncenseOffering();
      return;
    }

    window.setTimeout(
      completeIncenseOffering,
      OFFERING_DURATION_MS
    );
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
      !window.FortuneAsrBrowser
      || typeof window.FortuneAsrBrowser.createSession !== 'function'
    ) {
      interactionState = INTERACTION_STATES.ASR_ERROR;
      renderInteractionError(
        'asr',
        '当前页面暂时无法启动语音识别，请重新诉说。'
      );
      return;
    }

    closeActiveAsrSession();
    resetWishPaper();
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
        interactionState = INTERACTION_STATES.SPEAKING;
        renderSpeechState();
      },
      onPartial(text) {
        if (
          !isCurrentSession()
          || (
            interactionState !== INTERACTION_STATES.SPEAKING
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
            interactionState !== INTERACTION_STATES.SPEAKING
            && interactionState !== INTERACTION_STATES.FINISHING_ASR
          )
        ) {
          return;
        }
        const finalUpdated = updateWishPaper(text, true);
        if (completesSession && finalUpdated) {
          startAutomaticWishOffering(generation, session);
        }
      },
      onTranscriptReady() {
        if (!isCurrentSession() || !transcriptIsFinal) {
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
            && interactionState !== INTERACTION_STATES.SPEAKING
            && interactionState !== INTERACTION_STATES.FINISHING_ASR
          )
        ) {
          return;
        }
        activeAsrSession = null;
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
  }

  function finishSpeaking() {
    if (
      interactionState !== INTERACTION_STATES.SPEAKING
      || !activeAsrSession
    ) {
      return;
    }
    activeAsrSession.finish();
  }

  function handleSpeakControl() {
    if (
      interactionState === INTERACTION_STATES.WAITING_TO_SPEAK
      || interactionState === INTERACTION_STATES.MICROPHONE_ERROR
      || interactionState === INTERACTION_STATES.ASR_ERROR
    ) {
      startSpeakingSession();
      return;
    }
    if (interactionState === INTERACTION_STATES.SPEAKING) {
      finishSpeaking();
    }
  }

  function completeWishOffering(generation) {
    if (
      !pageIsActive
      || generation !== sessionGeneration
      || generation !== wishOfferingGeneration
      || interactionState !== INTERACTION_STATES.WISH_OFFERING
    ) {
      return false;
    }
    clearWishOfferingResources();
    interactionState = INTERACTION_STATES.WISH_OFFERED;
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
    interactionState = INTERACTION_STATES.WISH_OFFERING;
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
        interactionState !== INTERACTION_STATES.WISH_OFFERED
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
    renderSpeechState();
    fortuneRequestGeneration += 1;
    const requestGeneration = fortuneRequestGeneration;
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
      interactionState = INTERACTION_STATES.LOT_DRAWN;
      renderSpeechState();
      if (typeof fortuneResult.focus === 'function') {
        fortuneResult.focus();
      }
    } catch (error) {
      if (
        !pageIsActive
        || requestGeneration !== fortuneRequestGeneration
        || interactionState !== INTERACTION_STATES.DRAWING_LOT
      ) {
        return;
      }
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
    if (
      interactionState === INTERACTION_STATES.REQUESTING_MICROPHONE
      || interactionState === INTERACTION_STATES.CONNECTING_ASR
      || interactionState === INTERACTION_STATES.SPEAKING
      || interactionState === INTERACTION_STATES.FINISHING_ASR
      || interactionState === INTERACTION_STATES.WISH_OFFERING
      || interactionState === INTERACTION_STATES.WISH_OFFERED
      || interactionState === INTERACTION_STATES.DRAWING_LOT
      || interactionState === INTERACTION_STATES.LOT_DRAWN
      || interactionState === INTERACTION_STATES.LOT_ERROR
      || interactionState === INTERACTION_STATES.INTERPRETING_LOT
      || interactionState === INTERACTION_STATES.LOT_INTERPRETED
      || interactionState === INTERACTION_STATES.INTERPRETATION_ERROR
      || interactionState === INTERACTION_STATES.MICROPHONE_ERROR
      || interactionState === INTERACTION_STATES.ASR_ERROR
    ) {
      interactionState = INTERACTION_STATES.WAITING_TO_SPEAK;
    }
  }

  function handlePageShow() {
    pageIsActive = true;
    if (interactionState === INTERACTION_STATES.WAITING_TO_SPEAK) {
      resetWishPaper();
      renderSpeechState();
    }
  }

  offerIncenseButton.addEventListener(
    'click',
    handleIncenseOffering
  );
  speakControlButton.addEventListener('click', handleSpeakControl);
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
  window.addEventListener('pagehide', handlePageExit);
  window.addEventListener('beforeunload', handlePageExit);
  window.addEventListener('pageshow', handlePageShow);
})();
