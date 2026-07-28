'use strict';

(() => {
  const OFFERING_DURATION_MS = 1800;
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
  ) {
    return;
  }

  let interactionState = INTERACTION_STATES.IDLE;
  let activeAsrSession = null;
  let sessionGeneration = 0;
  let currentTranscript = '';
  let transcriptIsFinal = false;
  let pageIsActive = true;

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

  function renderSpeechState() {
    page.classList.remove(
      'is-listening',
      'has-microphone-error',
      'has-asr-error',
      'has-confirmed-wish'
    );
    speakControlButton.hidden = false;
    hideTranscriptActions();
    wishNextStep.hidden = true;

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
    }
  }

  function resetWishPaper() {
    currentTranscript = '';
    transcriptIsFinal = false;
    transcriptStatus.textContent = '等待诉说';
    transcriptText.textContent = '您的话会写在这里。';
    setWishPaperBusy(false);
    hideTranscriptActions();
    wishNextStep.hidden = true;
    page.classList.remove('has-confirmed-wish');
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

  function handlePageExit() {
    pageIsActive = false;
    sessionGeneration += 1;
    closeActiveAsrSession();
    if (
      interactionState === INTERACTION_STATES.REQUESTING_MICROPHONE
      || interactionState === INTERACTION_STATES.CONNECTING_ASR
      || interactionState === INTERACTION_STATES.SPEAKING
      || interactionState === INTERACTION_STATES.FINISHING_ASR
      || interactionState === INTERACTION_STATES.TRANSCRIPT_READY
      || interactionState === INTERACTION_STATES.TRANSCRIPT_CONFIRMED
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
  window.addEventListener('pagehide', handlePageExit);
  window.addEventListener('beforeunload', handlePageExit);
  window.addEventListener('pageshow', handlePageShow);
})();
