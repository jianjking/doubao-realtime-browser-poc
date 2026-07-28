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

  add(...classNames) {
    classNames.forEach((className) => this.classes.add(className));
  }

  remove(...classNames) {
    classNames.forEach((className) => this.classes.delete(className));
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createMicrophoneStream(trackCount = 2) {
  const tracks = Array.from(
    { length: trackCount },
    () => ({
      stopCallCount: 0,
      stop() {
        this.stopCallCount += 1;
      },
    })
  );
  return {
    getTracks() {
      return tracks;
    },
    tracks,
  };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
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
  const speechTitle = new FakeElement({
    textContent: '等待诉说',
  });
  const speechMessage = new FakeElement({
    textContent: '请慢慢说，道童会在殿前听您诉说。',
  });
  const speechDetail = new FakeElement({
    textContent: '本阶段只使用麦克风，不录制或上传音频。',
  });
  const speakControlButton = new FakeElement({
    textContent: '开始诉说',
  });
  const elements = new Map([
    ['.fortune-page', page],
    ['[data-offer-incense]', offerButton],
    ['[data-incense-state]', incenseState],
    ['[data-acolyte-guidance]', acolyteGuidance],
    ['[data-waiting-state]', waitingState],
    ['[data-speech-title]', speechTitle],
    ['[data-speech-message]', speechMessage],
    ['[data-speech-detail]', speechDetail],
    ['[data-speak-control]', speakControlButton],
  ]);
  const timers = [];
  const windowListeners = new Map();
  const microphoneRequests = [];
  const defaultStream = createMicrophoneStream();
  const microphoneHandler = options.getUserMedia
    || (() => Promise.resolve(defaultStream));
  const context = {
    document: {
      querySelector(selector) {
        return elements.get(selector) || null;
      },
    },
    navigator: options.unsupportedMicrophone === true
      ? {}
      : {
        mediaDevices: {
          getUserMedia(constraints) {
            microphoneRequests.push(constraints);
            return microphoneHandler(
              constraints,
              microphoneRequests.length
            );
          },
        },
      },
    window: {
      addEventListener(eventName, handler) {
        if (!windowListeners.has(eventName)) {
          windowListeners.set(eventName, []);
        }
        windowListeners.get(eventName).push(handler);
      },
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
    defaultStream,
    incenseState,
    microphoneRequests,
    offerButton,
    page,
    speakControlButton,
    speechDetail,
    speechMessage,
    speechTitle,
    timers,
    triggerWindow(eventName) {
      for (const handler of windowListeners.get(eventName) || []) {
        handler();
      }
    },
    waitingState,
    windowListeners,
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
    /<button class="speak-control-button" type="button" data-speak-control>开始诉说<\/button>/
  );
  assert.match(
    html,
    /data-speech-message[\s\S]*?>请慢慢说，道童会在殿前听您诉说。<\/p>/
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
  assert.match(
    css,
    /\.speak-control-button\s*\{[\s\S]*?min-height:\s*58px;/
  );
  assert.match(css, /\.is-listening \.waiting-to-speak\s*\{/);

  assert.doesNotMatch(
    html,
    /<(?:input|textarea)\b|contenteditable=|签筒|签文结果|录音波形|心愿纸/
  );
  assert.match(
    js,
    /navigator\.mediaDevices\.getUserMedia\(\{\s*audio:\s*true,\s*\}\)/
  );
  assert.match(
    js,
    /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/
  );
  assert.match(js, /window\.addEventListener\('pagehide'/);
  assert.match(js, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(
    js,
    /localStorage|sessionStorage|document\.cookie|MediaRecorder|SpeechRecognition|WebSocket|fetch\(|AudioContext|enumerateDevices/
  );
  assert.doesNotMatch(
    `${html}\n${js}`,
    /神仙为您解签|神仙正在听您说话|ASR|Realtime|已经保存您的心愿|已经写入心愿纸|正在为您抽签/
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
  assert.equal(runtime.microphoneRequests.length, 0);
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
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(runtime.speakControlButton.textContent, '开始诉说');
  assert.equal(
    runtime.speechMessage.textContent,
    '请慢慢说，道童会在殿前听您诉说。'
  );

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
  assert.equal(refreshedRuntime.microphoneRequests.length, 0);
}

function completeIncenseOffering(runtime) {
  runtime.offerButton.trigger('click');
  if (runtime.timers.length > 0) {
    runtime.timers[0].callback();
  }
}

async function verifyMicrophoneStartStopAndConcurrency() {
  const microphoneDeferred = createDeferred();
  const microphoneStream = createMicrophoneStream(3);
  const runtime = loadFortuneRuntime({
    getUserMedia() {
      return microphoneDeferred.promise;
    },
  });

  runtime.speakControlButton.trigger('click');
  assert.equal(runtime.microphoneRequests.length, 0);

  completeIncenseOffering(runtime);
  runtime.speakControlButton.trigger('click');
  assert.equal(runtime.microphoneRequests.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.microphoneRequests[0])),
    { audio: true }
  );
  assert.equal(runtime.speakControlButton.disabled, true);
  assert.equal(
    runtime.speakControlButton.textContent,
    '正在打开麦克风……'
  );
  assert.equal(runtime.speechMessage.textContent, '请允许使用麦克风。');

  runtime.speakControlButton.trigger('click');
  assert.equal(runtime.microphoneRequests.length, 1);

  microphoneDeferred.resolve(microphoneStream);
  await flushPromises();
  assert.equal(runtime.speechTitle.textContent, '道童正在聆听');
  assert.equal(
    runtime.speechMessage.textContent,
    '道童正在聆听，请慢慢说。'
  );
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(runtime.speakControlButton.textContent, '我说完了');
  assert.equal(runtime.page.classList.contains('is-listening'), true);

  runtime.speakControlButton.trigger('click');
  assert.deepEqual(
    microphoneStream.tracks.map((track) => track.stopCallCount),
    [1, 1, 1]
  );
  assert.equal(runtime.speechTitle.textContent, '诉说已结束');
  assert.equal(runtime.speechMessage.textContent, '您已经说完了。');
  assert.equal(
    runtime.speechDetail.textContent,
    '下一阶段将接入语音转写。'
  );
  assert.equal(runtime.speakControlButton.hidden, true);

  runtime.triggerWindow('pagehide');
  assert.deepEqual(
    microphoneStream.tracks.map((track) => track.stopCallCount),
    [1, 1, 1]
  );
}

async function verifyMicrophoneErrorsAndRetry() {
  const retryStream = createMicrophoneStream();
  let attemptCount = 0;
  const runtime = loadFortuneRuntime({
    getUserMedia() {
      attemptCount += 1;
      if (attemptCount === 1) {
        return Promise.reject({ name: 'NotAllowedError' });
      }
      return Promise.resolve(retryStream);
    },
  });
  completeIncenseOffering(runtime);

  runtime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(runtime.microphoneRequests.length, 1);
  assert.equal(runtime.speechTitle.textContent, '暂时无法使用麦克风');
  assert.equal(
    runtime.speechMessage.textContent,
    '麦克风权限未开启，请允许使用麦克风后重试。'
  );
  assert.equal(runtime.speakControlButton.textContent, '重新尝试');
  assert.equal(runtime.speakControlButton.disabled, false);
  assert.equal(
    runtime.page.classList.contains('is-listening'),
    false
  );

  runtime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(runtime.microphoneRequests.length, 2);
  assert.equal(runtime.speakControlButton.textContent, '我说完了');

  const unsupportedRuntime = loadFortuneRuntime({
    unsupportedMicrophone: true,
  });
  completeIncenseOffering(unsupportedRuntime);
  unsupportedRuntime.speakControlButton.trigger('click');
  assert.equal(unsupportedRuntime.microphoneRequests.length, 0);
  assert.equal(
    unsupportedRuntime.speechMessage.textContent,
    '暂时无法使用麦克风，请检查权限后再试。'
  );
  assert.equal(
    unsupportedRuntime.speakControlButton.textContent,
    '重新尝试'
  );

  const systemErrorRuntime = loadFortuneRuntime({
    getUserMedia() {
      return Promise.reject({ name: 'NotReadableError' });
    },
  });
  completeIncenseOffering(systemErrorRuntime);
  systemErrorRuntime.speakControlButton.trigger('click');
  await flushPromises();
  assert.equal(
    systemErrorRuntime.speechMessage.textContent,
    '暂时无法使用麦克风，请检查权限后再试。'
  );
}

async function verifyPageExitCleanup() {
  const activeStream = createMicrophoneStream(2);
  const activeRuntime = loadFortuneRuntime({
    getUserMedia() {
      return Promise.resolve(activeStream);
    },
  });
  completeIncenseOffering(activeRuntime);
  activeRuntime.speakControlButton.trigger('click');
  await flushPromises();
  activeRuntime.triggerWindow('pagehide');
  assert.deepEqual(
    activeStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  activeRuntime.triggerWindow('beforeunload');
  assert.deepEqual(
    activeStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  activeRuntime.triggerWindow('pageshow');
  assert.equal(activeRuntime.speakControlButton.textContent, '开始诉说');

  const pendingDeferred = createDeferred();
  const lateStream = createMicrophoneStream(2);
  const pendingRuntime = loadFortuneRuntime({
    getUserMedia() {
      return pendingDeferred.promise;
    },
  });
  completeIncenseOffering(pendingRuntime);
  pendingRuntime.speakControlButton.trigger('click');
  pendingRuntime.triggerWindow('pagehide');
  pendingDeferred.resolve(lateStream);
  await flushPromises();
  assert.deepEqual(
    lateStream.tracks.map((track) => track.stopCallCount),
    [1, 1]
  );
  assert.equal(
    pendingRuntime.page.classList.contains('is-listening'),
    false
  );
}

async function main() {
  verifyStaticSceneAndSafety();
  verifySingleOfferingFlow();
  verifyReducedMotionAndRefreshReset();
  await verifyMicrophoneStartStopAndConcurrency();
  await verifyMicrophoneErrorsAndRetry();
  await verifyPageExitCleanup();

  process.stdout.write('fortune_incense_interaction_test: PASS\n');
  process.stdout.write(
    'verified=temple-scene,incense-offering,reduced-motion,'
      + 'microphone-user-gesture,single-request,start-stop,'
      + 'all-tracks-stopped,permission-error,retry,unsupported-api,'
      + 'pagehide-beforeunload,late-stream-cleanup,no-recording-upload\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
