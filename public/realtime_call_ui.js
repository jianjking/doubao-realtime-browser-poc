'use strict';

(() => {
  const HOME_PATH = '/ui_prototypes/yuhuang_mobile_v1/home.html';
  const IDENTITY_ENTRY_PATH = '/ui_prototypes/yuhuang_mobile_v1/index.html';
  const RETURN_NAVIGATION_ERROR =
    '无法确定首页地址，请从首页重新进入通话';
  const CALL_COMPONENT_LOAD_ERROR =
    '通话功能暂时没有加载成功，请重新加载或返回功能选择';
  const DEFAULT_CALL_CHARACTER_KEY = 'yuhuang';
  const CALL_API_URL = '/api/calls';
  const BUSINESS_CALL_ID_MAX_LENGTH = 128;
  const CALL_ADMISSION_REQUIRED =
    '请先使用手机号登录，并从功能选择页重新进入通话';

  function validateReturnHomeUrl(rawReturnUrl) {
    if (typeof rawReturnUrl !== 'string' || rawReturnUrl === '') {
      return null;
    }

    let returnHomeUrl;
    try {
      returnHomeUrl = new URL(rawReturnUrl);
    } catch {
      return null;
    }

    if (!['http:', 'https:'].includes(returnHomeUrl.protocol)
      || returnHomeUrl.username !== ''
      || returnHomeUrl.password !== ''
      || returnHomeUrl.hostname !== window.location.hostname
      || returnHomeUrl.pathname !== HOME_PATH
      || returnHomeUrl.search !== ''
      || returnHomeUrl.hash !== '') {
      return null;
    }

    return returnHomeUrl;
  }

  function resolveReturnHomeUrl(searchParams) {
    const rawReturnUrl = searchParams.get('returnUrl');
    if (rawReturnUrl !== null) {
      return validateReturnHomeUrl(rawReturnUrl);
    }

    if (!document.referrer) {
      return null;
    }

    let referrerUrl;
    try {
      referrerUrl = new URL(document.referrer);
    } catch {
      return null;
    }

    if (!['http:', 'https:'].includes(referrerUrl.protocol)
      || referrerUrl.username !== ''
      || referrerUrl.password !== ''
      || referrerUrl.hostname !== window.location.hostname) {
      return null;
    }

    return validateReturnHomeUrl(
      new URL(HOME_PATH, referrerUrl.origin).href
    );
  }

  function buildIdentityEntryUrl(origin) {
    return new URL(IDENTITY_ENTRY_PATH, origin).href;
  }
  const CALL_CHARACTER_CONFIGS = Object.freeze({
    yuhuang: Object.freeze({
      key: 'yuhuang',
      name: '玉皇大帝',
      locationText: '凌霄宝殿 · 实时陪伴',
      motto: '端坐凌霄，听您慢慢说',
      imageSrc: './assets/characters/yuhuang/yuhuang-home-hero-v1.png',
      imageAlt: '玉皇大帝角色主视觉',
      idleStatus: '玉帝已准备好，轻触下方即可通话',
      connectingStatus: '正在接通玉帝，请稍候',
      sessionReadyStatus: '玉帝已接通，正在准备通话',
      listeningStatus: '玉帝正在听',
      userSpeakingStatus: '玉帝正在听您说',
      thinkingStatus: '玉帝正在思考',
      speakingStatus: '玉帝正在回应',
      debugConnectText: '接通玉帝',
    }),
    sunwukong: Object.freeze({
      key: 'sunwukong',
      name: '孙悟空',
      locationText: '花果山 · 实时陪伴',
      motto: '火眼金睛，陪您轻松聊聊',
      imageSrc:
        './assets/characters/sunwukong/sunwukong-call-hero-v2.png',
      imageAlt: '孙悟空手持金箍棒站在云海天宫间的角色主视觉',
      idleStatus: '孙悟空已准备好，轻触下方即可通话',
      connectingStatus: '正在接通孙悟空，请稍候',
      sessionReadyStatus: '孙悟空已接通，正在准备通话',
      listeningStatus: '孙悟空正在听',
      userSpeakingStatus: '孙悟空正在听您说',
      thinkingStatus: '孙悟空正在思考',
      speakingStatus: '孙悟空正在回应',
      debugConnectText: '接通孙悟空',
    }),
    guanyin: Object.freeze({
      key: 'guanyin',
      name: '观音菩萨',
      locationText: '南海莲台 · 实时陪伴',
      motto: '慈心静听，陪您安心说',
      imageSrc: './assets/characters/guanyin/guanyin-call-hero-v1.png',
      imageAlt: '观音菩萨手持杨柳枝端坐莲台的角色主视觉',
      idleStatus: '观音已准备好',
      connectingStatus: '正在接通观音',
      sessionReadyStatus: '观音已接通',
      listeningStatus: '观音正在听',
      userSpeakingStatus: '观音正在听您说',
      thinkingStatus: '观音正在思考',
      speakingStatus: '观音正在回应',
      debugConnectText: '接通观音',
    }),
    caishen: Object.freeze({
      key: 'caishen',
      name: '财神爷',
      locationText: '迎祥宝殿 · 实时陪伴',
      motto: '笑迎福气，陪您聊聊家常',
      imageSrc: './assets/characters/caishen/caishen-call-hero-v1.png',
      imageAlt: '财神爷手捧金元宝站在祥云间的角色主视觉',
      idleStatus: '财神爷已准备好',
      connectingStatus: '正在接通财神爷',
      sessionReadyStatus: '财神爷已接通',
      listeningStatus: '财神爷正在听',
      userSpeakingStatus: '财神爷正在听您说',
      thinkingStatus: '财神爷正在思考',
      speakingStatus: '财神爷正在回应',
      debugConnectText: '接通财神爷',
    }),
    rulai: Object.freeze({
      key: 'rulai',
      name: '如来佛祖',
      locationText: '灵山宝殿 · 实时陪伴',
      motto: '心平气和，听您慢慢说',
      imageSrc: './assets/characters/rulai/rulai-call-hero-v1.png',
      imageAlt: '如来佛祖端坐金色莲台的角色主视觉',
      idleStatus: '如来佛祖已准备好',
      connectingStatus: '正在接通如来佛祖',
      sessionReadyStatus: '如来佛祖已接通',
      listeningStatus: '如来佛祖正在听',
      userSpeakingStatus: '如来佛祖正在听您说',
      thinkingStatus: '如来佛祖正在思考',
      speakingStatus: '如来佛祖正在回应',
      debugConnectText: '接通如来佛祖',
    }),
    zhubajie: Object.freeze({
      key: 'zhubajie',
      name: '猪八戒',
      locationText: '高老庄 · 实时陪伴',
      motto: '乐呵相伴，陪您说说笑笑',
      imageSrc:
        './assets/characters/zhubajie/zhubajie-call-hero-v1.png',
      imageAlt: '猪八戒肩扛九齿钉耙站在高老庄云海间的角色主视觉',
      idleStatus: '猪八戒已准备好',
      connectingStatus: '正在接通猪八戒',
      sessionReadyStatus: '猪八戒已接通',
      listeningStatus: '猪八戒正在听',
      userSpeakingStatus: '猪八戒正在听您说',
      thinkingStatus: '猪八戒正在思考',
      speakingStatus: '猪八戒正在回应',
      debugConnectText: '接通猪八戒',
    }),
    shawujing: Object.freeze({
      key: 'shawujing',
      name: '沙悟净',
      locationText: '流沙河畔 · 实时陪伴',
      motto: '踏实守候，陪您慢慢聊',
      imageSrc:
        './assets/characters/shawujing/shawujing-call-hero-v1.png',
      imageAlt: '沙悟净手持月牙铲站在流沙河畔的角色主视觉',
      idleStatus: '沙悟净已准备好',
      connectingStatus: '正在接通沙悟净',
      sessionReadyStatus: '沙悟净已接通',
      listeningStatus: '沙悟净正在听',
      userSpeakingStatus: '沙悟净正在听您说',
      thinkingStatus: '沙悟净正在思考',
      speakingStatus: '沙悟净正在回应',
      debugConnectText: '接通沙悟净',
    }),
    tangseng: Object.freeze({
      key: 'tangseng',
      name: '唐僧',
      locationText: '大唐禅院 · 实时陪伴',
      motto: '温和耐心，陪您安心说',
      imageSrc:
        './assets/characters/tangseng/tangseng-call-hero-v1.png',
      imageAlt: '唐僧身披袈裟手持锡杖站在大唐圣地的角色主视觉',
      idleStatus: '唐僧已准备好',
      connectingStatus: '正在接通唐僧',
      sessionReadyStatus: '唐僧已接通',
      listeningStatus: '唐僧正在听',
      userSpeakingStatus: '唐僧正在听您说',
      thinkingStatus: '唐僧正在思考',
      speakingStatus: '唐僧正在回应',
      debugConnectText: '接通唐僧',
    }),
  });

  const callStatusText = document.getElementById('callStatusText');
  const callReturnButton = document.getElementById('callReturnButton');
  const callIdentityEntry = document.getElementById('callIdentityEntry');
  if (!callStatusText || !callReturnButton || !callIdentityEntry) {
    return;
  }

  function initializeReturnNavigation(searchParams) {
    const returnHomeUrl = resolveReturnHomeUrl(searchParams);
    callIdentityEntry.setAttribute(
      'href',
      buildIdentityEntryUrl(window.location.origin)
    );
    callIdentityEntry.removeAttribute('aria-disabled');
    callIdentityEntry.removeAttribute('tabindex');
    if (returnHomeUrl) {
      callReturnButton.setAttribute('href', returnHomeUrl.href);
      callReturnButton.removeAttribute('aria-disabled');
      callReturnButton.removeAttribute('tabindex');
      return returnHomeUrl;
    }

    callReturnButton.removeAttribute('href');
    callReturnButton.setAttribute('aria-disabled', 'true');
    callReturnButton.setAttribute('tabindex', '-1');
    callStatusText.textContent = RETURN_NAVIGATION_ERROR;

    const blockInvalidNavigation = (event) => {
      event.preventDefault();
      callStatusText.textContent = RETURN_NAVIGATION_ERROR;
    };
    callReturnButton.addEventListener('click', blockInvalidNavigation);
    return null;
  }

  function resolveBusinessCallId(searchParams) {
    const values = searchParams.getAll('callId');
    if (
      values.length !== 1
      || typeof values[0] !== 'string'
      || values[0].length < 1
      || values[0].length > BUSINESS_CALL_ID_MAX_LENGTH
      || values[0].trim() !== values[0]
      || /[\u0000-\u001f\u007f-\u009f]/.test(values[0])
    ) {
      return null;
    }
    return values[0];
  }

  const query = new URLSearchParams(window.location.search);
  const returnHomeUrl = initializeReturnNavigation(query);
  const businessCallId = resolveBusinessCallId(query);
  const api = window.DoubaoRealtimeCall;
  const pageShell = document.querySelector('.page-shell');
  const characterImage = document.querySelector(
    '[data-call-character-image]'
  );
  const characterHeading = document.querySelector(
    '[data-call-character-heading]'
  );
  const characterLocation = document.querySelector(
    '[data-call-character-location]'
  );
  const characterName = document.querySelector(
    '[data-call-character-name]'
  );
  const characterMotto = document.querySelector(
    '[data-call-character-motto]'
  );
  const characterControls = document.querySelector(
    '[data-call-character-controls]'
  );
  const callDuration = document.getElementById('callDuration');
  const callPrimaryButton = document.getElementById('callPrimaryButton');
  const debugPanel = document.getElementById('debugPanel');
  const debugConnectButton = document.getElementById('connectButton');
  const debugStartMicrophoneButton = document.getElementById(
    'startMicrophoneButton'
  );

  function renderStartupFailure() {
    if (typeof window.showCallStartupFallback === 'function') {
      window.showCallStartupFallback();
    }
    if (pageShell) {
      pageShell.dataset.callState = 'startup-failed';
    }
    if (characterControls) {
      characterControls.hidden = true;
    }
    if (callPrimaryButton) {
      callPrimaryButton.disabled = true;
    }
    callStatusText.textContent = CALL_COMPONENT_LOAD_ERROR;
  }

  if (!api
    || typeof api.connect !== 'function'
    || typeof api.disconnect !== 'function'
    || typeof api.startAudio !== 'function'
    || typeof api.subscribe !== 'function'
    || typeof api.warmupPlayback !== 'function') {
    renderStartupFailure();
    return;
  }

  if (!pageShell
    || !characterImage
    || !characterHeading
    || !characterLocation
    || !characterName
    || !characterMotto
    || !characterControls
    || !callDuration
    || !callPrimaryButton
    || !debugPanel) {
    return;
  }

  if (query.get('debug') === '1') {
    debugPanel.hidden = false;
    document.body.classList.add('debug-mode');
  }

  const requestedCharacterKey = query.has('characterKey')
    ? query.get('characterKey')
    : DEFAULT_CALL_CHARACTER_KEY;
  const callCharacter = typeof requestedCharacterKey === 'string'
    && Object.hasOwn(CALL_CHARACTER_CONFIGS, requestedCharacterKey)
    ? CALL_CHARACTER_CONFIGS[requestedCharacterKey]
    : null;

  function renderUnavailableCharacter() {
    document.title = '角色不可用 · 实时通话';
    pageShell.dataset.callCharacterKey = 'unavailable';
    pageShell.setAttribute('aria-label', '角色不可用的实时通话页面');
    characterImage.removeAttribute('src');
    characterImage.setAttribute('alt', '');
    characterImage.style.display = 'none';
    characterHeading.setAttribute('aria-label', '角色不可用');
    characterLocation.textContent = '实时陪伴';
    characterName.textContent = '角色不可用';
    characterMotto.textContent = '请返回首页重新选择角色';
    characterControls.setAttribute('aria-label', '角色不可用');
    callStatusText.textContent = '角色不可用，请返回首页重新选择';
    callPrimaryButton.textContent = '开始通话';
    callPrimaryButton.setAttribute(
      'aria-label',
      '当前角色不可用，无法开始通话'
    );
    callPrimaryButton.disabled = true;
  }

  function renderCallCharacter(character) {
    document.title = `${character.name} · 实时通话`;
    pageShell.dataset.callCharacterKey = character.key;
    pageShell.setAttribute(
      'aria-label',
      `${character.name}实时通话页面`
    );
    characterImage.style.removeProperty('display');
    characterImage.setAttribute('src', character.imageSrc);
    characterImage.setAttribute('alt', character.imageAlt);
    characterHeading.setAttribute(
      'aria-label',
      `${character.name}角色信息`
    );
    characterLocation.textContent = character.locationText;
    characterName.textContent = character.name;
    characterMotto.textContent = character.motto;
    characterControls.setAttribute(
      'aria-label',
      `与${character.name}实时通话控制`
    );
    if (debugConnectButton) {
      debugConnectButton.textContent = character.debugConnectText;
    }
    if (debugStartMicrophoneButton) {
      debugStartMicrophoneButton.setAttribute(
        'aria-label',
        `开始与${character.name}通话`
      );
    }
  }

  if (!callCharacter) {
    renderUnavailableCharacter();
    return;
  }

  renderCallCharacter(callCharacter);

  const statePresentation = {
    idle: {
      buttonText: '开始通话',
      buttonLabel: `开始与${callCharacter.name}通话`,
      statusText: callCharacter.idleStatus,
      disabled: false,
    },
    checking: {
      buttonText: '正在核验',
      buttonLabel: '正在核验通话资格',
      statusText: '正在核验登录状态和账户话费',
      disabled: true,
    },
    connecting: {
      buttonText: '正在接通',
      buttonLabel: `正在接通${callCharacter.name}`,
      statusText: callCharacter.connectingStatus,
      disabled: true,
    },
    active: {
      buttonText: '结束通话',
      buttonLabel: `结束与${callCharacter.name}通话`,
      statusText: callCharacter.listeningStatus,
      disabled: false,
    },
    stopping: {
      buttonText: '正在结束',
      buttonLabel: `正在结束与${callCharacter.name}的通话`,
      statusText: '正在结束通话',
      disabled: true,
    },
    ended: {
      buttonText: '重新通话',
      buttonLabel: `重新与${callCharacter.name}通话`,
      statusText: '本次通话已结束',
      disabled: false,
    },
    failed: {
      buttonText: '重新接通',
      buttonLabel: `重新接通${callCharacter.name}`,
      statusText: '暂时未能接通，请稍后重试',
      disabled: false,
    },
  };

  let productState = 'idle';
  let productOperationId = 0;
  let callStartedAt = null;
  let durationTimerId = null;
  let endingPromise = null;
  let pendingNavigation = false;
  let navigationStarted = false;
  let currentCallId = null;
  let startupRecoveryPending = false;

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:`
      + `${String(seconds).padStart(2, '0')}`;
  }

  function renderDuration() {
    const elapsed = callStartedAt === null
      ? 0
      : Date.now() - callStartedAt;
    const displayValue = formatDuration(elapsed);
    callDuration.textContent = displayValue;
    callDuration.dateTime = `PT${Math.floor(elapsed / 1000)}S`;
  }

  function clearDurationTimer(options = {}) {
    if (durationTimerId !== null) {
      window.clearInterval(durationTimerId);
      durationTimerId = null;
    }
    if (options.reset === true) {
      callStartedAt = null;
      renderDuration();
    } else if (callStartedAt !== null) {
      renderDuration();
    }
  }

  function startDurationTimer() {
    if (callStartedAt !== null || durationTimerId !== null) {
      return;
    }
    clearDurationTimer({ reset: true });
    callStartedAt = Date.now();
    renderDuration();
    durationTimerId = window.setInterval(renderDuration, 500);
  }

  function renderProductState(state) {
    const presentation = statePresentation[state];
    if (!presentation) {
      return;
    }
    productState = state;
    pageShell.dataset.callState = state;
    callStatusText.textContent = presentation.statusText;
    callPrimaryButton.textContent = presentation.buttonText;
    callPrimaryButton.setAttribute('aria-label', presentation.buttonLabel);
    callPrimaryButton.disabled = presentation.disabled;
  }

  function setStatusText(text) {
    callStatusText.textContent = text;
  }

  renderProductState('idle');
  if (businessCallId === null) {
    callStatusText.textContent = CALL_ADMISSION_REQUIRED;
  } else if (!returnHomeUrl) {
    callStatusText.textContent = RETURN_NAVIGATION_ERROR;
  }

  async function validateCallAdmission() {
    if (businessCallId === null) {
      callStatusText.textContent = CALL_ADMISSION_REQUIRED;
      window.location.assign(buildIdentityEntryUrl(window.location.origin));
      return false;
    }

    let response;
    let responseBody = null;
    try {
      response = await window.fetch(
        `${CALL_API_URL}/${encodeURIComponent(businessCallId)}/admission`,
        {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        }
      );
      try {
        responseBody = await response.json();
      } catch {
        responseBody = null;
      }
    } catch {
      renderProductState('idle');
      callStatusText.textContent = '网络连接失败，未启动通话，请稍后重试';
      return false;
    }

    const errorCode = responseBody
      && responseBody.error
      && responseBody.error.code;
    if (response.status === 401 || response.status === 403) {
      renderProductState('idle');
      callStatusText.textContent = '登录状态已失效，请重新使用手机号登录';
      window.location.assign(buildIdentityEntryUrl(window.location.origin));
      return false;
    }
    if (response.status === 409 && errorCode === 'INSUFFICIENT_BALANCE') {
      renderProductState('idle');
      callStatusText.textContent = '账户话费不足，未启动通话，请返回充值';
      return false;
    }

    const call = responseBody && responseBody.call;
    if (
      response.status !== 200
      || !call
      || call.id !== businessCallId
      || call.status !== 'pending'
      || !call.role
      || call.role.slug !== callCharacter.key
    ) {
      renderProductState('idle');
      callStatusText.textContent = '通话信息已失效，请返回首页重新开始';
      return false;
    }
    return true;
  }

  function navigateHomeOnce() {
    if (!pendingNavigation || navigationStarted) {
      return;
    }
    if (!returnHomeUrl) {
      callStatusText.textContent = RETURN_NAVIGATION_ERROR;
      return;
    }
    navigationStarted = true;
    clearDurationTimer();
    window.location.assign(returnHomeUrl.href);
  }

  function handleRealtimeCallSnapshot(snapshot) {
    if (Number.isSafeInteger(snapshot.callId)) {
      if (snapshot.state === 'connecting') {
        currentCallId = snapshot.callId;
      } else if (currentCallId !== null
        && snapshot.callId !== currentCallId) {
        return;
      }
    }

    switch (snapshot.state) {
      case 'idle':
        if (productState === 'idle') {
          renderProductState('idle');
          if (businessCallId === null) {
            callStatusText.textContent = CALL_ADMISSION_REQUIRED;
          } else if (!returnHomeUrl) {
            callStatusText.textContent = RETURN_NAVIGATION_ERROR;
          }
        }
        break;
      case 'connecting':
        if (productState !== 'stopping') {
          renderProductState('connecting');
        }
        break;
      case 'session-ready':
        if (productState === 'connecting') {
          setStatusText(callCharacter.sessionReadyStatus);
        }
        break;
      case 'audio-active':
        if (productState !== 'active') {
          renderProductState('active');
        }
        if (callStartedAt === null) {
          startDurationTimer();
        }
        break;
      case 'listening':
        if (productState === 'active') {
          setStatusText(snapshot.detail.userSpeaking === true
            ? callCharacter.userSpeakingStatus
            : callCharacter.listeningStatus);
        }
        break;
      case 'waiting-response':
        if (productState === 'active') {
          setStatusText(callCharacter.thinkingStatus);
        }
        break;
      case 'assistant-speaking':
        if (productState === 'active') {
          setStatusText(callCharacter.speakingStatus);
        }
        break;
      case 'stopping':
        clearDurationTimer();
        renderProductState('stopping');
        break;
      case 'ended':
        if (startupRecoveryPending
          && snapshot.detail.cleanupComplete !== true) {
          renderProductState('stopping');
          break;
        }
        clearDurationTimer();
        startupRecoveryPending = false;
        renderProductState('ended');
        currentCallId = null;
        navigateHomeOnce();
        break;
      case 'failed':
        if (startupRecoveryPending
          && snapshot.detail.cleanupComplete !== true) {
          renderProductState('stopping');
          break;
        }
        clearDurationTimer();
        startupRecoveryPending = false;
        renderProductState('failed');
        currentCallId = null;
        break;
      default:
        break;
    }
  }

  async function startCall() {
    const operationId = productOperationId + 1;
    productOperationId = operationId;
    pendingNavigation = false;
    navigationStarted = false;
    startupRecoveryPending = false;
    clearDurationTimer({ reset: true });
    renderProductState('checking');

    try {
      const admitted = await validateCallAdmission();
      if (!admitted || operationId !== productOperationId) {
        return;
      }
      renderProductState('connecting');
      const playbackWarmupPromise = api.warmupPlayback();
      const sessionReadyPromise = api.connect();
      await Promise.all([
        sessionReadyPromise,
        playbackWarmupPromise,
      ]);

      if (operationId !== productOperationId) {
        return;
      }

      await api.startAudio();
    } catch (error) {
      if (operationId !== productOperationId) {
        return;
      }
      startupRecoveryPending = true;
      clearDurationTimer();
      renderProductState('stopping');
      try {
        const cleanupResult = await api.disconnect({
          finalState: 'failed',
          message: error.message,
        });
        if (cleanupResult
          && cleanupResult.pending === true) {
          return;
        }
      } catch {
        // 失败后的清理结果不覆盖原始启动失败状态。
      }
      if (operationId === productOperationId) {
        startupRecoveryPending = false;
        renderProductState('failed');
        currentCallId = null;
      }
    }
  }

  function waitWithTimeout(promise, timeoutMilliseconds) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = window.setTimeout(() => {
        resolve({
          timedOut: true,
        });
      }, timeoutMilliseconds);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      window.clearTimeout(timeoutId);
    });
  }

  function endCall(shouldNavigate) {
    if (shouldNavigate) {
      pendingNavigation = true;
    }
    if (endingPromise) {
      return endingPromise;
    }

    productOperationId += 1;
    startupRecoveryPending = false;
    clearDurationTimer();
    renderProductState('stopping');

    endingPromise = (async () => {
      let cleanupStillPending = false;
      try {
        const result = await waitWithTimeout(api.disconnect(), 6000);
        if (result
          && (result.pending === true || result.timedOut === true)) {
          cleanupStillPending = true;
          renderProductState('stopping');
        } else if (productState === 'stopping') {
          renderProductState('ended');
        }
      } catch {
        renderProductState('failed');
      } finally {
        endingPromise = null;
        if (!cleanupStillPending) {
          navigateHomeOnce();
        }
      }
    })();
    return endingPromise;
  }

  try {
    api.subscribe(handleRealtimeCallSnapshot);
  } catch {
    renderStartupFailure();
    return;
  }

  callPrimaryButton.addEventListener('click', () => {
    if (productState === 'idle'
      || productState === 'ended'
      || productState === 'failed') {
      void startCall();
      return;
    }
    if (productState === 'active') {
      void endCall(false);
    }
  });

  callReturnButton.addEventListener('click', (event) => {
    if (!returnHomeUrl) {
      return;
    }
    if (productState === 'idle'
      || productState === 'ended'
      || productState === 'failed') {
      return;
    }
    event.preventDefault();
    void endCall(true);
  });

  window.addEventListener('beforeunload', () => {
    clearDurationTimer();
  });
})();
