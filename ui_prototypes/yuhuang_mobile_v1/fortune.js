'use strict';

(() => {
  const OFFERING_DURATION_MS = 1800;
  const page = document.querySelector('.fortune-page');
  const offerIncenseButton = document.querySelector(
    '[data-offer-incense]'
  );
  const incenseState = document.querySelector('[data-incense-state]');
  const acolyteGuidance = document.querySelector(
    '[data-acolyte-guidance]'
  );
  const waitingState = document.querySelector('[data-waiting-state]');

  if (
    !page
    || !offerIncenseButton
    || !incenseState
    || !acolyteGuidance
    || !waitingState
  ) {
    return;
  }

  let hasOfferedIncense = false;
  let isOfferingIncense = false;

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function completeIncenseOffering() {
    if (!isOfferingIncense || hasOfferedIncense) {
      return;
    }

    isOfferingIncense = false;
    hasOfferedIncense = true;
    page.classList.remove('is-offering-incense');
    page.classList.add('has-offered-incense');
    offerIncenseButton.disabled = true;
    offerIncenseButton.textContent = '香火已敬';
    incenseState.textContent = '香火已起';
    acolyteGuidance.textContent =
      '香火已起，请慢慢说说您的处境。';
    waitingState.hidden = false;
  }

  function handleIncenseOffering() {
    if (hasOfferedIncense || isOfferingIncense) {
      return;
    }

    isOfferingIncense = true;
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

  offerIncenseButton.addEventListener(
    'click',
    handleIncenseOffering
  );
})();
