'use strict';

(() => {
  const OFFERING_DURATION_MS = 1800;
  const WISH_OFFERING_FALLBACK_MS = 3400;
  const REDUCED_WISH_OFFERING_FALLBACK_MS = 60;
  const FORTUNE_SESSION_API_URL = '/api/fortune-sessions';
  const FORTUNE_DEITY_KEY = 'yuhuang';
  const INTERACTION_STATES = Object.freeze({
    IDLE: 'idle',
    OFFERING_INCENSE: 'offering-incense',
    WAITING_TO_SPEAK: 'waiting-to-speak',
    REQUESTING_MICROPHONE: 'requesting-microphone',
    CONNECTING_ASR: 'connecting-asr',
    SPEAKING: 'speaking',
    FINISHING_ASR: 'finishing-asr',
    TRANSCRIPT_READY: 'transcript-ready',
    TRANSCRIPT_CONFIRMED: 'transcript-confirmed',
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
  const page = document.querySelector('.fortune-page');
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
  const transcriptActions = document.querySelector(
    '[data-transcript-actions]'
  );
  const confirmTranscriptButton = document.querySelector(
    '[data-confirm-transcript]'
  );
  const retryTranscriptButton = document.querySelector(
    '[data-retry-transcript]'
  );
  const wishNextStep = document.querySelector(
    '[data-wish-next-step]'
  );
  const offerWishButton = document.querySelector(
    '[data-offer-wish]'
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
  const interpretationSummary = document.querySelector(
    '[data-interpretation-summary]'
  );
  const interpretationReflection = document.querySelector(
    '[data-interpretation-reflection]'
  );
  const interpretationAction = document.querySelector(
    '[data-interpretation-action]'
  );
  const interpretationSafety = document.querySelector(
    '[data-interpretation-safety]'
  );

  if (
    !page
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
    || !transcriptActions
    || !confirmTranscriptButton
    || !retryTranscriptButton
    || !wishNextStep
    || !offerWishButton
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
    || !interpretationSummary
    || !interpretationReflection
    || !interpretationAction
    || !interpretationSafety
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
  let fortuneRequestController = null;
  let fortuneRequestGeneration = 0;
  let publicFortuneSession = null;
  let interpretationRequestController = null;
  let interpretationRequestGeneration = 0;
  let publicInterpretation = null;

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setWishPaperBusy(isBusy) {
    wishPaper.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  function hideTranscriptActions() {
    transcriptActions.hidden = true;
    confirmTranscriptButton.disabled = true;
    retryTranscriptButton.disabled = true;
  }

  function clearWishOfferingResources() {
    if (wishOfferingTimer !== null) {
      window.clearTimeout(wishOfferingTimer);
      wishOfferingTimer = null;
    }
    wishPaper.removeEventListener(
      'animationend',
      handleWishOfferingAnimationEnd
    );
    page.classList.remove('is-wish-offering');
  }

  function renderSpeechState() {
    page.classList.remove(
      'is-listening',
      'has-microphone-error',
      'has-asr-error',
      'has-confirmed-wish',
      'has-offered-wish'
    );
    speakControlButton.hidden = false;
    hideTranscriptActions();
    wishNextStep.hidden = true;
    offerWishButton.disabled = true;
    offerWishButton.textContent = '奉入香炉';
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

    if (interactionState === INTERACTION_STATES.TRANSCRIPT_READY) {
      speechTitle.textContent = '识别完成';
      speechMessage.textContent = '识别完成';
      speechDetail.textContent =
        '这些话仅保留在当前页面，请确认是否准确。';
      speakControlButton.textContent = '识别完成';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
      transcriptStatus.textContent = '这些话，正是您想说的吗？';
      setWishPaperBusy(false);
      transcriptActions.hidden = false;
      confirmTranscriptButton.disabled = false;
      retryTranscriptButton.disabled = false;
      return;
    }

    if (
      interactionState === INTERACTION_STATES.TRANSCRIPT_CONFIRMED
    ) {
      page.classList.add('has-confirmed-wish');
      speechTitle.textContent = '心愿已确认';
      speechMessage.textContent =
        '心愿已确认，下一步将敬呈殿前。';
      speechDetail.textContent = '这些话仅保留在当前页面。';
      speakControlButton.textContent = '心愿已确认';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
      transcriptStatus.textContent = '心愿已确认';
      setWishPaperBusy(false);
      wishNextStep.hidden = false;
      offerWishButton.disabled = false;
      return;
    }

    if (interactionState === INTERACTION_STATES.WISH_OFFERING) {
      page.classList.add('is-wish-offering');
      speechTitle.textContent = '正在奉入香炉';
      speechMessage.textContent = '正在奉入香炉……';
      speechDetail.textContent = '请稍候，心愿纸正在殿前化作轻烟。';
      speakControlButton.textContent = '正在呈愿';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
      transcriptStatus.textContent = '正在奉入香炉……';
      setWishPaperBusy(true);
      wishPaper.setAttribute('aria-hidden', 'true');
      wishNextStep.hidden = false;
      offerWishButton.disabled = true;
      offerWishButton.textContent = '正在奉入香炉……';
      return;
    }

    if (interactionState === INTERACTION_STATES.WISH_OFFERED) {
      page.classList.add('has-offered-wish');
      speechTitle.textContent = '心愿已呈';
      speechMessage.textContent = '心意已达殿前，请静候求签。';
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
        interpretationSummary.textContent =
          publicInterpretation.summary;
        interpretationReflection.textContent =
          publicInterpretation.situationReflection;
        interpretationAction.textContent =
          publicInterpretation.smallAction;
        interpretationSafety.textContent =
          publicInterpretation.safetyNote;
      }
    }
  }

  function resetWishPaper() {
    currentTranscript = '';
    transcriptIsFinal = false;
    publicFortuneSession = null;
    publicInterpretation = null;
    transcriptStatus.textContent = '等待诉说';
    transcriptText.textContent = '您的话会写在这里。';
    setWishPaperBusy(false);
    hideTranscriptActions();
    wishNextStep.hidden = true;
    wishOfferingComplete.hidden = true;
    wishPaper.hidden = false;
    wishPaper.removeAttribute('aria-hidden');
    page.classList.remove('has-confirmed-wish');
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
    const fields = [
      'summary',
      'situationReflection',
      'smallAction',
      'safetyNote',
    ];
    return Object.keys(value.interpretation).length === fields.length
      && fields.every(
        (field) => (
          typeof value.interpretation[field] === 'string'
          && value.interpretation[field].trim() !== ''
        )
      );
  }

  function updateWishPaper(text, isFinal) {
    if (typeof text !== 'string' || text.trim() === '') {
      return false;
    }
    if (!isFinal && text === currentTranscript) {
      return false;
    }
    currentTranscript = text;
    transcriptIsFinal = isFinal;
    transcriptStatus.textContent = isFinal
      ? '这些话，正是您想说的吗？'
      : '道童正在代您记下……';
    transcriptText.textContent = text;
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
    hideTranscriptActions();
    wishNextStep.hidden = true;
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
          interactionState = INTERACTION_STATES.TRANSCRIPT_READY;
          renderSpeechState();
        }
      },
      onTranscriptReady() {
        if (!isCurrentSession() || !transcriptIsFinal) {
          return;
        }
        interactionState = INTERACTION_STATES.TRANSCRIPT_READY;
        renderSpeechState();
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
          || interactionState === INTERACTION_STATES.TRANSCRIPT_READY
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

  function handleTranscriptConfirm() {
    if (
      interactionState !== INTERACTION_STATES.TRANSCRIPT_READY
      || !transcriptIsFinal
      || currentTranscript.trim() === ''
    ) {
      return;
    }
    interactionState = INTERACTION_STATES.TRANSCRIPT_CONFIRMED;
    closeActiveAsrSession();
    renderSpeechState();
  }

  function handleTranscriptRetry() {
    if (interactionState !== INTERACTION_STATES.TRANSCRIPT_READY) {
      return;
    }
    startSpeakingSession();
  }

  function completeWishOffering() {
    if (interactionState !== INTERACTION_STATES.WISH_OFFERING) {
      return;
    }
    clearWishOfferingResources();
    interactionState = INTERACTION_STATES.WISH_OFFERED;
    renderSpeechState();
    if (typeof wishOfferingComplete.focus === 'function') {
      wishOfferingComplete.focus();
    }
  }

  function handleWishOfferingAnimationEnd(event) {
    if (event && event.target !== wishPaper) {
      return;
    }
    if (
      event
      && event.animationName
      && event.animationName !== 'wish-paper-offering'
      && event.animationName !== 'wish-paper-offering-reduced'
    ) {
      return;
    }
    completeWishOffering();
  }

  function handleWishOffering() {
    if (
      interactionState !== INTERACTION_STATES.TRANSCRIPT_CONFIRMED
      || !transcriptIsFinal
      || currentTranscript.trim() === ''
    ) {
      return;
    }
    interactionState = INTERACTION_STATES.WISH_OFFERING;
    renderSpeechState();
    wishPaper.addEventListener(
      'animationend',
      handleWishOfferingAnimationEnd
    );
    wishOfferingTimer = window.setTimeout(
      completeWishOffering,
      prefersReducedMotion()
        ? REDUCED_WISH_OFFERING_FALLBACK_MS
        : WISH_OFFERING_FALLBACK_MS
    );
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
        summary: responseBody.interpretation.summary,
        situationReflection:
          responseBody.interpretation.situationReflection,
        smallAction: responseBody.interpretation.smallAction,
        safetyNote: responseBody.interpretation.safetyNote,
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
    closeActiveAsrSession();
    clearWishOfferingResources();
    if (
      interactionState === INTERACTION_STATES.REQUESTING_MICROPHONE
      || interactionState === INTERACTION_STATES.CONNECTING_ASR
      || interactionState === INTERACTION_STATES.SPEAKING
      || interactionState === INTERACTION_STATES.FINISHING_ASR
      || interactionState === INTERACTION_STATES.TRANSCRIPT_READY
      || interactionState === INTERACTION_STATES.TRANSCRIPT_CONFIRMED
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
  confirmTranscriptButton.addEventListener(
    'click',
    handleTranscriptConfirm
  );
  retryTranscriptButton.addEventListener(
    'click',
    handleTranscriptRetry
  );
  offerWishButton.addEventListener('click', handleWishOffering);
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
  window.addEventListener('pagehide', handlePageExit);
  window.addEventListener('beforeunload', handlePageExit);
  window.addEventListener('pageshow', handlePageShow);
})();
