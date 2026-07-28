'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_DIR = path.resolve(__dirname, '..');
const FORTUNE_HTML_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune.html'
);
const FORTUNE_JS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/fortune.js'
);
const ENTRY_CSS_PATH = path.join(
  PROJECT_DIR,
  'ui_prototypes/yuhuang_mobile_v1/entry.css'
);

class FakeClassList {
  constructor(initialClasses = []) {
    this.classes = new Set(initialClasses);
  }

  add(className) {
    this.classes.add(className);
  }

  remove(className) {
    this.classes.delete(className);
  }

  contains(className) {
    return this.classes.has(className);
  }
}

class FakeElement {
  constructor(options = {}) {
    this.classList = new FakeClassList(options.classes);
    this.disabled = options.disabled === true;
    this.hidden = options.hidden === true;
    this.textContent = options.textContent || '';
    this.listeners = new Map();
  }

  addEventListener(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
  }

  trigger(eventName) {
    for (const handler of this.listeners.get(eventName) || []) {
      handler();
    }
  }
}

function loadFortuneRuntime(options = {}) {
  const page = new FakeElement({ classes: ['fortune-page'] });
  const offerButton = new FakeElement({
    textContent: '敬上一炷香',
  });
  const incenseState = new FakeElement({
    textContent: '香尚未点燃',
  });
  const acolyteGuidance = new FakeElement({
    textContent: '善信请静心，先敬上一炷香。',
  });
  const waitingState = new FakeElement({ hidden: true });
  const elements = new Map([
    ['.fortune-page', page],
    ['[data-offer-incense]', offerButton],
    ['[data-incense-state]', incenseState],
    ['[data-acolyte-guidance]', acolyteGuidance],
    ['[data-waiting-state]', waitingState],
  ]);
  const timers = [];
  const context = {
    document: {
      querySelector(selector) {
        return elements.get(selector) || null;
      },
    },
    window: {
      matchMedia(query) {
        assert.equal(
          query,
          '(prefers-reduced-motion: reduce)'
        );
        return { matches: options.reducedMotion === true };
      },
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
    },
  };

  vm.runInNewContext(
    fs.readFileSync(FORTUNE_JS_PATH, 'utf8'),
    context,
    { filename: FORTUNE_JS_PATH }
  );

  return {
    acolyteGuidance,
    incenseState,
    offerButton,
    page,
    timers,
    waitingState,
  };
}

function verifyStaticSceneAndSafety() {
  const html = fs.readFileSync(FORTUNE_HTML_PATH, 'utf8');
  const css = fs.readFileSync(ENTRY_CSS_PATH, 'utf8');
  const js = fs.readFileSync(FORTUNE_JS_PATH, 'utf8');

  assert.match(
    html,
    /<section class="temple-scene"[\s\S]*?神明高坐庙堂/
  );
  assert.match(
    html,
    /role="img" aria-label="神明高坐神龛，殿内供灯散发柔和金光"/
  );
  assert.match(
    html,
    /<section class="offering-stage"[\s\S]*?香炉与一炷未点燃的香/
  );
  assert.match(
    html,
    /<section class="acolyte-guide"[\s\S]*?<h2 id="acolyte-guide-title">道童引导<\/h2>/
  );
  assert.match(
    html,
    /data-acolyte-guidance[\s\S]*?>善信请静心，先敬上一炷香。<\/p>/
  );
  assert.match(
    html,
    /<button class="offer-incense-button" type="button" data-offer-incense>敬上一炷香<\/button>/
  );
  assert.match(
    html,
    /data-incense-state aria-live="polite">香尚未点燃<\/p>/
  );
  assert.match(
    html,
    /<section class="waiting-to-speak" data-waiting-state[\s\S]*?hidden>/
  );
  assert.match(
    html,
    /<a class="return-choice-button" href="\.\/choice\.html">返回功能选择<\/a>/
  );
  assert.match(html, /<script src="\.\/fortune\.js"><\/script>/);

  assert.match(css, /\.incense-ember\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(css, /\.incense-smoke\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(
    css,
    /\.has-offered-incense \.incense-smoke\s*\{[\s\S]*?animation-play-state:\s*running;/
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.incense-smoke\s*\{[\s\S]*?animation:\s*none !important;/
  );
  assert.match(
    css,
    /\.offer-incense-button\s*\{[\s\S]*?min-height:\s*62px;/
  );

  assert.doesNotMatch(
    html,
    /<(?:input|textarea)\b|contenteditable=|签筒|签文结果|录音波形/
  );
  assert.doesNotMatch(
    js,
    /localStorage|sessionStorage|document\.cookie|mediaDevices|getUserMedia|SpeechRecognition|WebSocket|fetch\(|AudioContext/
  );
  assert.doesNotMatch(
    `${html}\n${js}`,
    /神仙为您解签|神仙正在听您说话|ASR|Realtime/
  );
}

function verifySingleOfferingFlow() {
  const runtime = loadFortuneRuntime();
  assert.equal(
    runtime.offerButton.listeners.get('click').length,
    1
  );
  assert.equal(runtime.offerButton.disabled, false);
  assert.equal(runtime.waitingState.hidden, true);
  assert.equal(
    runtime.page.classList.contains('has-offered-incense'),
    false
  );

  runtime.offerButton.trigger('click');
  assert.equal(runtime.offerButton.disabled, true);
  assert.equal(runtime.offerButton.textContent, '正在敬香……');
  assert.equal(runtime.incenseState.textContent, '香火正在点亮');
  assert.equal(
    runtime.page.classList.contains('is-offering-incense'),
    true
  );
  assert.equal(runtime.timers.length, 1);
  assert.equal(runtime.timers[0].delay, 1800);

  runtime.offerButton.trigger('click');
  assert.equal(runtime.timers.length, 1);

  runtime.timers[0].callback();
  assert.equal(
    runtime.page.classList.contains('is-offering-incense'),
    false
  );
  assert.equal(
    runtime.page.classList.contains('has-offered-incense'),
    true
  );
  assert.equal(runtime.offerButton.disabled, true);
  assert.equal(runtime.offerButton.textContent, '香火已敬');
  assert.equal(runtime.incenseState.textContent, '香火已起');
  assert.equal(
    runtime.acolyteGuidance.textContent,
    '香火已起，请慢慢说说您的处境。'
  );
  assert.equal(runtime.waitingState.hidden, false);

  runtime.offerButton.trigger('click');
  assert.equal(runtime.timers.length, 1);
}

function verifyReducedMotionAndRefreshReset() {
  const reducedRuntime = loadFortuneRuntime({
    reducedMotion: true,
  });
  reducedRuntime.offerButton.trigger('click');
  assert.equal(reducedRuntime.timers.length, 0);
  assert.equal(
    reducedRuntime.page.classList.contains('has-offered-incense'),
    true
  );
  assert.equal(reducedRuntime.waitingState.hidden, false);

  const refreshedRuntime = loadFortuneRuntime();
  assert.equal(refreshedRuntime.offerButton.disabled, false);
  assert.equal(refreshedRuntime.offerButton.textContent, '敬上一炷香');
  assert.equal(refreshedRuntime.incenseState.textContent, '香尚未点燃');
  assert.equal(refreshedRuntime.waitingState.hidden, true);
}

verifyStaticSceneAndSafety();
verifySingleOfferingFlow();
verifyReducedMotionAndRefreshReset();

process.stdout.write('fortune_incense_interaction_test: PASS\n');
process.stdout.write(
  'verified=temple-scene,incense-burner,acolyte-guide,'
    + 'single-offering,locked-button,ember-smoke,waiting-state,'
    + 'reduced-motion,refresh-reset,no-mic-no-storage\n'
);
