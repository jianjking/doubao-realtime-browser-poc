(function () {
  'use strict';

  const root = document.documentElement;
  const loader = document.querySelector('[data-xianban-loader]');
  const visualViewport = window.visualViewport;
  let viewportUpdateTimer = 0;

  if (window.__xianbanStartupLoaderInitialized) {
    return;
  }

  window.__xianbanStartupLoaderInitialized = true;

  function updateAppHeight() {
    const visualHeight = window.visualViewport
      && Number.isFinite(window.visualViewport.height)
      ? window.visualViewport.height
      : 0;
    const nextHeight = Math.round(visualHeight || window.innerHeight || 0);
    if (nextHeight > 0) {
      root.style.setProperty('--app-height', `${nextHeight}px`);
    }
  }

  function scheduleAppHeightUpdate() {
    window.clearTimeout(viewportUpdateTimer);
    viewportUpdateTimer = window.setTimeout(() => {
      viewportUpdateTimer = 0;
      updateAppHeight();
    }, 120);
  }

  function removeViewportListeners() {
    window.clearTimeout(viewportUpdateTimer);
    viewportUpdateTimer = 0;
    window.removeEventListener('resize', scheduleAppHeightUpdate);
    window.removeEventListener('orientationchange', scheduleAppHeightUpdate);
    if (visualViewport) {
      visualViewport.removeEventListener('resize', scheduleAppHeightUpdate);
    }
  }

  updateAppHeight();
  if (!loader) {
    root.classList.remove('is-xianban-loading');
    return;
  }

  window.addEventListener('resize', scheduleAppHeightUpdate, {
    passive: true,
  });
  window.addEventListener('orientationchange', scheduleAppHeightUpdate, {
    passive: true,
  });
  if (visualViewport) {
    visualViewport.addEventListener(
      'resize',
      scheduleAppHeightUpdate,
      { passive: true }
    );
  }

  const progressBar = loader.querySelector('[data-loader-progress-bar]');
  const progressText = loader.querySelector('[data-loader-progress-text]');
  const statusText = loader.querySelector('[data-loader-status]');
  const reloadButton = loader.querySelector('[data-loader-reload]');
  const criticalImage = document.querySelector(
    '[data-startup-critical-image]'
  );
  const startupApi = window.XianBanStartup || {};
  const startedAt = Number.isFinite(window.__xianbanStartupAt)
    ? window.__xianbanStartupAt
    : window.performance.now();
  const minimumVisibleUntil = startedAt + 550;
  let shownProgress = 12;
  let targetProgress = 18;
  let progressFrame = 0;
  let domReady = false;
  let imageReady = !criticalImage;
  let appReady = document.body.dataset.startupApp === 'static';
  let windowReady = document.readyState === 'complete';
  let hasFailed = false;
  let isFinishing = false;
  let finishTimer = 0;
  let completionTimer = 0;
  let removalTimer = 0;
  let firstSlowNoticeTimer = 0;
  let secondSlowNoticeTimer = 0;

  function handleCriticalImageLoad() {
    imageReady = true;
    refreshMilestone();
  }

  function handleCriticalImageError() {
    failStartup('首屏画面未能加载，请重新加载后再试');
  }

  function handleWindowLoad() {
    windowReady = true;
    refreshMilestone();
  }

  function handleReload() {
    window.location.reload();
  }

  function removeMilestoneListeners() {
    if (criticalImage) {
      criticalImage.removeEventListener('load', handleCriticalImageLoad);
      criticalImage.removeEventListener('error', handleCriticalImageError);
    }
    window.removeEventListener('load', handleWindowLoad);
  }

  function clearLoadingTimers() {
    window.clearTimeout(finishTimer);
    window.clearTimeout(completionTimer);
    window.clearTimeout(firstSlowNoticeTimer);
    window.clearTimeout(secondSlowNoticeTimer);
    finishTimer = 0;
    completionTimer = 0;
    firstSlowNoticeTimer = 0;
    secondSlowNoticeTimer = 0;
  }

  function cleanupPage(event) {
    if (event && event.persisted) {
      return;
    }
    removeViewportListeners();
    removeMilestoneListeners();
    clearLoadingTimers();
    window.clearTimeout(removalTimer);
    removalTimer = 0;
    if (progressFrame) {
      window.cancelAnimationFrame(progressFrame);
      progressFrame = 0;
    }
    if (reloadButton) {
      reloadButton.removeEventListener('click', handleReload);
    }
    window.removeEventListener('pagehide', cleanupPage);
  }

  window.addEventListener('pagehide', cleanupPage);

  function renderProgress(value) {
    const roundedValue = Math.max(0, Math.min(100, Math.round(value)));
    if (progressBar) {
      progressBar.style.width = `${roundedValue}%`;
      progressBar.parentElement.setAttribute('aria-valuenow', roundedValue);
    }
    if (progressText) {
      progressText.textContent = `${roundedValue}%`;
    }
  }

  function animateProgress() {
    const remaining = targetProgress - shownProgress;
    if (remaining > 0.05) {
      const minimumStep = targetProgress === 100 ? 0.4 : 0.18;
      const easingFactor = targetProgress === 100 ? 0.12 : 0.055;
      shownProgress += Math.max(minimumStep, remaining * easingFactor);
      shownProgress = Math.min(shownProgress, targetProgress);
      renderProgress(shownProgress);
    }
    if (shownProgress < targetProgress - 0.05) {
      progressFrame = window.requestAnimationFrame(animateProgress);
      return;
    }
    progressFrame = 0;
    if (targetProgress === 100) {
      renderProgress(100);
      completionTimer = window.setTimeout(() => {
        completionTimer = 0;
        loader.classList.add('is-complete');
        loader.setAttribute('aria-hidden', 'true');
        root.classList.remove('is-xianban-loading');
        removeMilestoneListeners();
        clearLoadingTimers();
        if (reloadButton) {
          reloadButton.removeEventListener('click', handleReload);
        }
        removalTimer = window.setTimeout(() => loader.remove(), 380);
      }, 120);
    }
  }

  function setTargetProgress(value) {
    const cappedValue = isFinishing ? value : Math.min(value, 95);
    targetProgress = Math.max(targetProgress, cappedValue);
    if (!progressFrame) {
      progressFrame = window.requestAnimationFrame(animateProgress);
    }
  }

  function finishWhenAllowed() {
    if (
      hasFailed
      || isFinishing
      || !domReady
      || !imageReady
      || !appReady
      || !windowReady
    ) {
      return;
    }
    const waitTime = Math.max(
      0,
      Math.ceil(minimumVisibleUntil - window.performance.now())
    );
    if (finishTimer) {
      return;
    }
    finishTimer = window.setTimeout(() => {
      finishTimer = 0;
      if (hasFailed || isFinishing) {
        return;
      }
      isFinishing = true;
      setTargetProgress(100);
    }, waitTime);
  }

  function refreshMilestone() {
    if (!domReady) {
      setTargetProgress(18);
      return;
    }
    setTargetProgress(imageReady ? 80 : 70);
    if (imageReady && appReady) {
      setTargetProgress(95);
    }
    finishWhenAllowed();
  }

  function showStatus(message, showReload) {
    if (statusText) {
      statusText.textContent = message;
      statusText.hidden = false;
    }
    if (reloadButton && showReload) {
      reloadButton.hidden = false;
    }
  }

  function failStartup(message) {
    if (hasFailed || isFinishing) {
      return;
    }
    hasFailed = true;
    clearLoadingTimers();
    removeMilestoneListeners();
    setTargetProgress(95);
    showStatus(
      message || '资源加载未完成，请重新加载后再试',
      true
    );
  }

  startupApi.markAppReady = function () {
    if (appReady || hasFailed || isFinishing) {
      return;
    }
    appReady = true;
    refreshMilestone();
  };
  startupApi.fail = failStartup;
  window.XianBanStartup = startupApi;

  if (reloadButton) {
    reloadButton.addEventListener('click', handleReload);
  }

  domReady = true;
  setTargetProgress(38);

  if (criticalImage) {
    if (criticalImage.complete && criticalImage.naturalWidth > 0) {
      imageReady = true;
    } else if (criticalImage.complete) {
      failStartup('首屏画面未能加载，请重新加载后再试');
    } else {
      criticalImage.addEventListener('load', handleCriticalImageLoad, {
        once: true,
      });
      criticalImage.addEventListener('error', handleCriticalImageError, {
        once: true,
      });
    }
  }

  if (!windowReady) {
    window.addEventListener('load', handleWindowLoad, { once: true });
  }

  const firstSlowNoticeDelay = Math.max(
    0,
    Math.ceil(8000 - (window.performance.now() - startedAt))
  );
  const secondSlowNoticeDelay = Math.max(
    0,
    Math.ceil(24000 - (window.performance.now() - startedAt))
  );
  if (!hasFailed) {
    firstSlowNoticeTimer = window.setTimeout(() => {
      if (
        !hasFailed
        && !isFinishing
        && document.documentElement.contains(loader)
      ) {
        showStatus('当前网络较慢，仙伴仍在努力加载', false);
      }
    }, firstSlowNoticeDelay);
    secondSlowNoticeTimer = window.setTimeout(() => {
      if (
        !hasFailed
        && !isFinishing
        && document.documentElement.contains(loader)
      ) {
        showStatus('资源加载时间较长，请继续等待', true);
      }
    }, secondSlowNoticeDelay);
  }

  renderProgress(shownProgress);
  refreshMilestone();
})();
