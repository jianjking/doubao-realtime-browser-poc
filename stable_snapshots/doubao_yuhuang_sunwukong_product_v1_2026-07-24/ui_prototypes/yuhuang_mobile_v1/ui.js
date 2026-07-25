'use strict';

(() => {
  const REALTIME_PAGE_URL = 'http://127.0.0.1:3001/';
  const REALTIME_URLS_BY_CHARACTER_KEY = Object.freeze({
    yuhuang: REALTIME_PAGE_URL,
    sunwukong: `${REALTIME_PAGE_URL}?characterKey=sunwukong`,
  });
  const TOAST_DURATION_MS = 3200;
  const CUSTOM_AMOUNT_RANGE_ERROR = '请输入1至999元之间的金额';
  const CUSTOM_AMOUNT_PRECISION_ERROR = '充值金额最多保留两位小数';
  const CUSTOM_AMOUNT_SUMMARY_ERROR = '请输入有效的充值金额';
  const SWIPE_MIN_DISTANCE_PX = 40;
  const SWIPE_DIRECTION_RATIO = 1.1;

  const characters = [
    {
      key: 'yuhuang',
      name: '玉皇大帝',
      imageSrc: './assets/characters/yuhuang/yuhuang-home-hero-v1.png',
      imageAlt: '玉皇大帝角色主视觉',
      motto: '端坐凌霄，听您慢慢说',
      readyText: '玉帝已准备好，轻触下方即可通话',
      statusDetail: '启用后，您只管开口，无需按住',
      pickerText: '庄重温和，陪您慢慢通话',
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
      pickerText: '活泼亲切，陪您轻松聊聊',
      voiceReady: true,
      unavailableText: '',
      realtimeCharacterKey: 'sunwukong',
    },
  ];
  const charactersByKey = new Map(
    characters.map((character) => [character.key, character])
  );
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
  let selectedRechargeAmount = 10;
  let selectedRechargeAmountDisplay = '10';
  let selectedPaymentMethod = 'wechat';
  let selectedPaymentName = '微信支付';
  let prototypeCreditBalance = 12.50;

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
  const characterSwitch = document.querySelector('.character-switch');
  const currentCharacterName = characterSwitch
    ? characterSwitch.querySelector('.character-switch-copy strong')
    : null;
  const rechargeEntry = document.querySelector('.time-recharge-entry');
  const characterPicker = document.querySelector('.character-picker');
  const rechargePanel = document.querySelector('.recharge-panel');
  const toast = document.querySelector('.ui-toast');
  const callControl = document.querySelector('.call-control');
  const callButton = document.querySelector('.call-button');
  const callButtonLabel = document.querySelector('.call-button-label');
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

    if (activeOverlayTrigger) {
      activeOverlayTrigger.setAttribute('aria-expanded', 'true');
    }

    const closeButton = overlay.querySelector('[data-close-overlay]');
    if (closeButton) {
      closeButton.focus();
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

  function renderCharacterOptions() {
    document.querySelectorAll('.role-card').forEach((roleButton) => {
      const character = charactersByKey.get(
        roleButton.dataset.characterKey
      );
      if (!character) {
        roleButton.disabled = true;
        return;
      }

      const name = roleButton.querySelector('.role-copy strong');
      const description = roleButton.querySelector('.role-copy > span');
      if (name) {
        name.textContent = character.name;
      }
      if (description) {
        description.textContent = character.pickerText;
      }
      roleButton.setAttribute('aria-label', `选择${character.name}`);
    });
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
      homeTitle.textContent = `${character.name} · 传统文化智慧陪伴`;
    }
    document.title = `${character.name} · 传统文化智慧陪伴`;
    if (currentCharacterName) {
      currentCharacterName.textContent = character.name;
    }
    if (characterSwitch) {
      characterSwitch.setAttribute(
        'aria-label',
        `切换陪伴角色，当前仙伴${character.name}`
      );
    }
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

    document.querySelectorAll('.role-card').forEach((roleButton) => {
      const isCurrent = roleButton.dataset.characterKey === character.key;
      const status = roleButton.querySelector('.role-status');
      roleButton.classList.toggle('is-current', isCurrent);

      if (isCurrent) {
        roleButton.setAttribute('aria-current', 'true');
      } else {
        roleButton.removeAttribute('aria-current');
      }

      if (status) {
        status.textContent = isCurrent ? '当前仙伴' : '可相伴';
      }
    });
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

  function warmCharacterImages() {
    characters.forEach((character) => {
      if (character.key !== currentCharacterKey) {
        preloadCharacterImage(character).catch(() => {});
      }
    });
  }

  async function selectCharacter(characterKey, source) {
    const character = charactersByKey.get(characterKey);
    if (!character) {
      return false;
    }
    const requestId = ++characterSelectionRequestId;
    if (character.key === currentCharacterKey) {
      renderCharacter(character);
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

    currentCharacterKey = character.key;
    renderCharacter(character);
    if (source === 'swipe-left'
      || source === 'swipe-right'
      || source === 'character-panel') {
      showToast(`已切换为${character.name}`);
    }
    return true;
  }

  async function handleCharacterOptionClick(event) {
    const selectedButton = event.currentTarget;
    const selectedKey = selectedButton.dataset.characterKey;
    if (!selectedKey || selectedButton.disabled) {
      return;
    }

    await selectCharacter(selectedKey, 'character-panel');
    closeActiveOverlay();
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

  function parseCustomRechargeAmount(rawValue) {
    const normalizedValue = String(rawValue).trim();
    if (/^\d+\.\d{3,}$/.test(normalizedValue)) {
      return {
        amount: null,
        displayAmount: '',
        errorMessage: CUSTOM_AMOUNT_PRECISION_ERROR,
      };
    }

    const formatMatch = normalizedValue.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!formatMatch) {
      return {
        amount: null,
        displayAmount: '',
        errorMessage: CUSTOM_AMOUNT_RANGE_ERROR,
      };
    }

    const amount = Number(normalizedValue);
    if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
      return {
        amount: null,
        displayAmount: '',
        errorMessage: CUSTOM_AMOUNT_RANGE_ERROR,
      };
    }

    const decimalPlaces = formatMatch[2] ? formatMatch[2].length : 0;
    return {
      amount,
      displayAmount: decimalPlaces > 0
        ? amount.toFixed(decimalPlaces)
        : String(amount),
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
    rechargeSelectionSummary.textContent = Number.isFinite(
      selectedRechargeAmount
    ) && selectedRechargeAmount >= 1
      && selectedRechargeAmount <= 999
      && selectedRechargeAmountDisplay
      && selectedPaymentName
      ? `本次充值：${selectedRechargeAmountDisplay}元 · ${selectedPaymentName}（演示）`
      : CUSTOM_AMOUNT_SUMMARY_ERROR;
  }

  function renderCreditBalance() {
    const formattedBalance = prototypeCreditBalance.toFixed(2);
    document.querySelectorAll('[data-current-credit]').forEach((element) => {
      element.textContent = `${formattedBalance}元`;
    });
    if (rechargeEntry) {
      rechargeEntry.setAttribute(
        'aria-label',
        `当前话费${formattedBalance}元，进入话费充值`
      );
    }
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
      selectedRechargeAmount = isValidAmount
        ? parsedAmount.amount
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

    const amount = Number(selectedButton.dataset.packageValue);
    if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
      showToast('请选择有效的充值金额。');
      return;
    }

    selectedAmountMode = 'preset';
    selectedRechargeAmount = amount;
    selectedRechargeAmountDisplay = String(amount);
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
    selectedRechargeAmount = isValidAmount
      ? parsedAmount.amount
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

  function handleRechargeConfirmation() {
    if (selectedAmountMode === 'custom') {
      const parsedAmount = customAmountInput
        ? parseCustomRechargeAmount(customAmountInput.value)
        : parseCustomRechargeAmount('');
      if (parsedAmount.errorMessage) {
        selectedRechargeAmount = null;
        selectedRechargeAmountDisplay = '';
        renderCustomAmountError(parsedAmount.errorMessage);
        updateRechargeSelectionSummary();
        showToast(parsedAmount.errorMessage);
        if (customAmountInput) {
          customAmountInput.focus();
        }
        return;
      }
      selectedRechargeAmount = parsedAmount.amount;
      selectedRechargeAmountDisplay = parsedAmount.displayAmount;
      renderCustomAmountError();
    }

    if (!Number.isFinite(selectedRechargeAmount)
      || selectedRechargeAmount < 1
      || selectedRechargeAmount > 999) {
      showToast(CUSTOM_AMOUNT_RANGE_ERROR);
      return;
    }
    if (!selectedPaymentMethod || !selectedPaymentName) {
      showToast('请先选择支付方式。');
      return;
    }

    prototypeCreditBalance += selectedRechargeAmount;
    renderCreditBalance();
    if (rechargeResult) {
      rechargeResult.textContent = `充值演示完成：已为本机原型增加`
        + `${selectedRechargeAmountDisplay}元话费，当前话费`
        + `${prototypeCreditBalance.toFixed(2)}元。不会产生真实扣款。`;
      rechargeResult.hidden = false;
    }
    showToast('充值演示完成，不会产生真实扣款。');
  }

  function handleAuxiliaryAction(event) {
    const message = auxiliaryMessages[event.currentTarget.dataset.action];
    if (message) {
      showToast(message);
    }
  }

  function handleStartConversation() {
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
      return;
    }

    window.location.assign(realtimeUrl);
  }

  function initializeUi() {
    renderCharacterOptions();
    renderCharacter(charactersByKey.get(currentCharacterKey));

    if (characterSwitch && characterPicker) {
      characterSwitch.addEventListener('click', () => {
        openOverlay(characterPicker, characterSwitch);
      });
    }

    if (rechargeEntry && rechargePanel) {
      rechargeEntry.addEventListener('click', () => {
        openOverlay(rechargePanel, rechargeEntry);
      });
    }

    document.querySelectorAll('.prototype-overlay').forEach((overlay) => {
      overlay.addEventListener('click', handleOverlayBackdropClick);
    });

    document.querySelectorAll('[data-close-overlay]').forEach((button) => {
      button.addEventListener('click', () => {
        closeOverlay(button.closest('.prototype-overlay'), true);
      });
    });

    document.querySelectorAll('.role-card:not(:disabled)').forEach((button) => {
      button.addEventListener('click', handleCharacterOptionClick);
    });

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
    renderCreditBalance();
    updateRechargeSelectionSummary();
    warmCharacterImages();
  }

  initializeUi();
})();
