'use strict';

(() => {
  const OFFERING_DURATION_MS = 1800;
  const INTERACTION_STATES = Object.freeze({
    IDLE: 'idle',
    OFFERING_INCENSE: 'offering-incense',
    WAITING_TO_SPEAK: 'waiting-to-speak',
    REQUESTING_MICROPHONE: 'requesting-microphone',
    SPEAKING: 'speaking',
    SPEECH_ENDED: 'speech-ended',
    MICROPHONE_ERROR: 'microphone-error',
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
  ) {
    return;
  }

  let interactionState = INTERACTION_STATES.IDLE;
  let activeMicrophoneStream = null;
  let microphoneRequestSequence = 0;
  let pageIsActive = true;

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function renderSpeechState() {
    page.classList.remove('is-listening', 'has-microphone-error');
    speakControlButton.hidden = false;

    if (interactionState === INTERACTION_STATES.WAITING_TO_SPEAK) {
      speechTitle.textContent = '等待诉说';
      speechMessage.textContent =
        '请慢慢说，道童会在殿前听您诉说。';
      speechDetail.textContent =
        '本阶段只使用麦克风，不录制或上传音频。';
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
        '授权后，道童会在殿前听您诉说。';
      speakControlButton.textContent = '正在打开麦克风……';
      speakControlButton.disabled = true;
      return;
    }

    if (interactionState === INTERACTION_STATES.SPEAKING) {
      page.classList.add('is-listening');
      speechTitle.textContent = '道童正在聆听';
      speechMessage.textContent = '道童正在聆听，请慢慢说。';
      speechDetail.textContent =
        '当前只使用麦克风流，不会录制或上传音频。';
      speakControlButton.textContent = '我说完了';
      speakControlButton.disabled = false;
      return;
    }

    if (interactionState === INTERACTION_STATES.SPEECH_ENDED) {
      speechTitle.textContent = '诉说已结束';
      speechMessage.textContent = '您已经说完了。';
      speechDetail.textContent = '下一阶段将接入语音转写。';
      speakControlButton.textContent = '诉说已结束';
      speakControlButton.disabled = true;
      speakControlButton.hidden = true;
    }
  }

  function renderMicrophoneError(permissionDenied) {
    page.classList.remove('is-listening');
    page.classList.add('has-microphone-error');
    speechTitle.textContent = '暂时无法使用麦克风';
    speechMessage.textContent = permissionDenied
      ? '麦克风权限未开启，请允许使用麦克风后重试。'
      : '暂时无法使用麦克风，请检查权限后再试。';
    speechDetail.textContent =
      '请检查浏览器或系统的麦克风权限。';
    speakControlButton.textContent = '重新尝试';
    speakControlButton.disabled = false;
    speakControlButton.hidden = false;
  }

  function stopMicrophoneStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') {
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
  }

  function releaseActiveMicrophone() {
    if (!activeMicrophoneStream) {
      return;
    }
    stopMicrophoneStream(activeMicrophoneStream);
    activeMicrophoneStream = null;
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

  async function requestMicrophone() {
    if (
      !navigator.mediaDevices
      || typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      interactionState = INTERACTION_STATES.MICROPHONE_ERROR;
      renderMicrophoneError(false);
      return;
    }

    interactionState = INTERACTION_STATES.REQUESTING_MICROPHONE;
    const requestSequence = ++microphoneRequestSequence;
    renderSpeechState();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (
        !pageIsActive
        || interactionState
          !== INTERACTION_STATES.REQUESTING_MICROPHONE
        || requestSequence !== microphoneRequestSequence
      ) {
        stopMicrophoneStream(stream);
        return;
      }

      activeMicrophoneStream = stream;
      interactionState = INTERACTION_STATES.SPEAKING;
      renderSpeechState();
    } catch (error) {
      if (
        !pageIsActive
        || requestSequence !== microphoneRequestSequence
      ) {
        return;
      }

      interactionState = INTERACTION_STATES.MICROPHONE_ERROR;
      const permissionDenied = Boolean(
        error
        && (
          error.name === 'NotAllowedError'
          || error.name === 'SecurityError'
        )
      );
      renderMicrophoneError(permissionDenied);
    }
  }

  function finishSpeaking() {
    if (interactionState !== INTERACTION_STATES.SPEAKING) {
      return;
    }
    releaseActiveMicrophone();
    interactionState = INTERACTION_STATES.SPEECH_ENDED;
    renderSpeechState();
  }

  function handleSpeakControl() {
    if (
      interactionState === INTERACTION_STATES.WAITING_TO_SPEAK
      || interactionState === INTERACTION_STATES.MICROPHONE_ERROR
    ) {
      requestMicrophone();
      return;
    }
    if (interactionState === INTERACTION_STATES.SPEAKING) {
      finishSpeaking();
    }
  }

  function handlePageExit() {
    pageIsActive = false;
    microphoneRequestSequence += 1;
    releaseActiveMicrophone();
    if (
      interactionState === INTERACTION_STATES.REQUESTING_MICROPHONE
      || interactionState === INTERACTION_STATES.SPEAKING
    ) {
      interactionState = INTERACTION_STATES.WAITING_TO_SPEAK;
    }
  }

  function handlePageShow() {
    pageIsActive = true;
    if (interactionState === INTERACTION_STATES.WAITING_TO_SPEAK) {
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
