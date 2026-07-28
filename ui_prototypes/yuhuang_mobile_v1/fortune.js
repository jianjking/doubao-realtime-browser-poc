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

  function renderSpeechState() {
    page.classList.remove(
      'is-listening',
      'has-microphone-error',
      'has-asr-error'
    );
    speakControlButton.hidden = false;

    if (interactionState === INTERACTION_STATES.WAITING_TO_SPEAK) {
      speechTitle.textContent = '等待诉说';
      speechMessage.textContent =
        '请慢慢说，道童会在殿前听您诉说。';
      speechDetail.textContent =
        '语音只用于当前识别，不会录制为音频文件。';
      speakControlButton.textContent = '开始诉说';
      speakControlButton.disabled = false;
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
      return;
    }

    if (interactionState === INTERACTION_STATES.CONNECTING_ASR) {
      speechTitle.textContent = '正在准备聆听';
      speechMessage.textContent = '正在准备聆听，请稍候……';
      speechDetail.textContent =
        '连接完成后再开始诉说，以免遗漏开头。';
      speakControlButton.textContent = '正在准备……';
      speakControlButton.disabled = true;
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
      return;
    }

    if (interactionState === INTERACTION_STATES.FINISHING_ASR) {
      speechTitle.textContent = '正在整理您的话';
      speechMessage.textContent = '正在整理您的话……';
      speechDetail.textContent = '请稍候，正在等待最终识别结果。';
      speakControlButton.textContent = '正在识别……';
      speakControlButton.disabled = true;
      return;
    }

    if (interactionState === INTERACTION_STATES.TRANSCRIPT_READY) {
      speechTitle.textContent = '识别完成';
      speechMessage.textContent = '识别完成';
      speechDetail.textContent =
        '识别文字仅保留在当前页面的预览区域。';
      speakControlButton.textContent = '识别完成';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
    }
  }

  function resetTranscriptPreview() {
    currentTranscript = '';
    transcriptIsFinal = false;
    transcriptStatus.textContent = '等待开始';
    transcriptText.textContent = '您的话会在这里显示。';
  }

  function updateTranscriptPreview(text, isFinal) {
    if (typeof text !== 'string' || text.trim() === '') {
      return;
    }
    currentTranscript = text;
    transcriptIsFinal = isFinal;
    transcriptStatus.textContent = isFinal
      ? '识别完成'
      : '正在识别';
    transcriptText.textContent = text;
  }

  function renderInteractionError(kind, message) {
    page.classList.remove('is-listening');
    page.classList.remove('has-microphone-error', 'has-asr-error');
    if (kind === 'microphone') {
      page.classList.add('has-microphone-error');
      speechTitle.textContent = '暂时无法使用麦克风';
      speechDetail.textContent =
        '请检查浏览器或系统的麦克风权限。';
    } else {
      page.classList.add('has-asr-error');
      speechTitle.textContent = '语音识别暂时不可用';
      speechDetail.textContent =
        '请检查 Relay 是否开启求签语音识别后再试。';
    }
    speechMessage.textContent = message;
    speakControlButton.textContent = '重新诉说';
    speakControlButton.disabled = false;
    speakControlButton.hidden = false;
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
    resetTranscriptPreview();
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
        if (!isCurrentSession()) {
          return;
        }
        updateTranscriptPreview(text, false);
      },
      onFinal(text, completesSession) {
        if (!isCurrentSession()) {
          return;
        }
        updateTranscriptPreview(text, true);
        if (completesSession) {
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
        const microphoneError = error.kind === 'microphone';
        interactionState = microphoneError
          ? INTERACTION_STATES.MICROPHONE_ERROR
          : INTERACTION_STATES.ASR_ERROR;
        renderInteractionError(
          microphoneError ? 'microphone' : 'asr',
          error.message
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
      interactionState = INTERACTION_STATES.ASR_ERROR;
      renderInteractionError(
        'asr',
        '语音识别暂时不可用，请重新诉说。'
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
      || interactionState === INTERACTION_STATES.MICROPHONE_ERROR
      || interactionState === INTERACTION_STATES.ASR_ERROR
    ) {
      interactionState = INTERACTION_STATES.WAITING_TO_SPEAK;
    }
  }

  function handlePageShow() {
    pageIsActive = true;
    if (interactionState === INTERACTION_STATES.WAITING_TO_SPEAK) {
      resetTranscriptPreview();
      renderSpeechState();
    }
  }

  offerIncenseButton.addEventListener(
    'click',
    handleIncenseOffering
  );
  speakControlButton.addEventListener('click', handleSpeakControl);
  window.addEventListener('pagehide', handlePageExit);
  window.addEventListener('beforeunload', handlePageExit);
  window.addEventListener('pageshow', handlePageShow);
})();
