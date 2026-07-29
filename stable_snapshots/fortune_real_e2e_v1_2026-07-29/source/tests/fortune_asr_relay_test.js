'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_MAX_PCM_CHUNK_BYTES,
  FORTUNE_ASR_RELAY_STATES,
  FORTUNE_ASR_WEBSOCKET_PATH,
  createFortuneAsrClientFactoryFromEnv,
  createFortuneAsrRelayConnectionHandler,
  isFortuneAsrEnabled,
} = require('../fortune_asr_relay');

const PROJECT_DIR = path.resolve(__dirname, '..');
const VALID_START = Object.freeze({
  type: 'fortune.asr.start',
  audio: Object.freeze({
    format: 'pcm_s16le',
    sampleRate: 16000,
    bitsPerSample: 16,
    channels: 1,
  }),
});

class FakeBrowserSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.closeCalls = [];
    this.sendError = null;
  }

  send(serialized, callback) {
    this.sent.push(JSON.parse(serialized));
    callback(this.sendError);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason: String(reason) });
    this.readyState = 3;
  }

  emitText(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }

  emitRawText(text) {
    this.emit('message', Buffer.from(text), false);
  }

  emitBinary(buffer) {
    this.emit('message', buffer, true);
  }

  disconnect(code = 1000) {
    this.readyState = 3;
    this.emit('close', code);
  }
}

class FakeAsrClient extends EventEmitter {
  constructor() {
    super();
    this.connectCalls = 0;
    this.pcmChunks = [];
    this.finishCalls = 0;
    this.closeCalls = 0;
  }

  connect() {
    this.connectCalls += 1;
    return Promise.resolve(this);
  }

  sendPcmChunk(buffer) {
    this.pcmChunks.push(Buffer.from(buffer));
  }

  finish() {
    this.finishCalls += 1;
    return true;
  }

  close() {
    this.closeCalls += 1;
    return this.closeCalls === 1;
  }
}

function createHarness({ limits, logger } = {}) {
  const clients = [];
  let factoryCalls = 0;
  const handler = createFortuneAsrRelayConnectionHandler({
    asrClientFactory() {
      factoryCalls += 1;
      const client = new FakeAsrClient();
      clients.push(client);
      return client;
    },
    limits,
    logger,
  });
  const browser = new FakeBrowserSocket();
  const controller = handler(browser);
  return {
    browser,
    clients,
    controller,
    get factoryCalls() {
      return factoryCalls;
    },
  };
}

function latestMessage(browser) {
  return browser.sent.at(-1);
}

function assertError(browser, code) {
  const message = latestMessage(browser);
  assert.deepEqual(message, {
    type: 'fortune.asr.error',
    error: {
      code,
      message: message.error.message,
    },
  });
  assert.equal(typeof message.error.message, 'string');
  assert.equal(Object.hasOwn(message.error, 'rawResult'), false);
}

test('feature flag defaults off and server routes the optional path on the existing upgrade listener', () => {
  assert.equal(isFortuneAsrEnabled({}), false);
  assert.equal(isFortuneAsrEnabled({ DOUBAO_ENABLE_FORTUNE_ASR: 'true' }), false);
  assert.equal(isFortuneAsrEnabled({ DOUBAO_ENABLE_FORTUNE_ASR: '01' }), false);
  assert.equal(isFortuneAsrEnabled({ DOUBAO_ENABLE_FORTUNE_ASR: '1' }), true);
  assert.equal(FORTUNE_ASR_WEBSOCKET_PATH, '/fortune-asr');

  const serverSource = fs.readFileSync(
    path.join(PROJECT_DIR, 'server_doubao_realtime.js'),
    'utf8'
  );
  assert.match(
    serverSource,
    /const PORT = 3001;[\s\S]*const WEBSOCKET_PATH = '\/realtime';/
  );
  assert.match(
    serverSource,
    /const FORTUNE_ASR_WEBSOCKET_PATH = '\/fortune-asr';/
  );
  assert.match(
    serverSource,
    /env\[FORTUNE_ASR_ENABLE_ENV_NAME\] === '1'/
  );
  assert.match(serverSource, /server\.on\('upgrade'/);
  assert.match(
    serverSource,
    /pathname === WEBSOCKET_PATH[\s\S]*fortuneAsrWebSocketServer/
  );
  assert.match(
    serverSource,
    /if \(fortuneAsrEnabled\) \{[\s\S]*require\('\.\/fortune_asr_relay'\)/
  );
});

test('ready, start, PCM, result mapping, final dedupe and finish follow the protocol', () => {
  const harness = createHarness();
  assert.deepEqual(harness.browser.sent, [{ type: 'fortune.asr.ready' }]);
  assert.equal(harness.controller.state, FORTUNE_ASR_RELAY_STATES.WAITING_START);

  harness.browser.emitText(VALID_START);
  assert.equal(harness.factoryCalls, 1);
  assert.equal(harness.clients[0].connectCalls, 1);
  assert.equal(
    harness.controller.state,
    FORTUNE_ASR_RELAY_STATES.CONNECTING_UPSTREAM
  );
  assert.equal(
    harness.browser.sent.some((message) => (
      message.type === 'fortune.asr.started'
    )),
    false
  );

  harness.clients[0].emit('ready', { requestId: 'safe-request-id' });
  assert.deepEqual(latestMessage(harness.browser), {
    type: 'fortune.asr.started',
  });

  const pcm = Buffer.alloc(6400, 1);
  harness.browser.emitBinary(pcm);
  assert.equal(harness.clients[0].pcmChunks.length, 1);
  assert.deepEqual(harness.clients[0].pcmChunks[0], pcm);

  harness.clients[0].emit('partial', {
    text: '正在识别',
    rawResult: { secret: 'must-not-cross-boundary' },
  });
  assert.deepEqual(latestMessage(harness.browser), {
    type: 'fortune.asr.partial',
    text: '正在识别',
  });

  harness.clients[0].emit('final', {
    text: '心愿已记录',
    rawResult: { internal: true },
  });
  harness.clients[0].emit('final', {
    text: '心愿已记录',
    rawResult: { internal: false },
  });
  assert.equal(
    harness.browser.sent.filter((message) => (
      message.type === 'fortune.asr.final'
    )).length,
    1
  );
  assert.deepEqual(latestMessage(harness.browser), {
    type: 'fortune.asr.final',
    text: '心愿已记录',
  });

  harness.browser.emitText({ type: 'fortune.asr.finish' });
  assert.equal(harness.clients[0].finishCalls, 1);
  assert.equal(harness.controller.state, FORTUNE_ASR_RELAY_STATES.FINISHING);

  harness.clients[0].emit('final', { text: '心愿已记录' });
  assert.equal(harness.controller.state, FORTUNE_ASR_RELAY_STATES.FINISHED);
  assert.equal(
    harness.browser.sent.filter((message) => (
      message.type === 'fortune.asr.final'
    )).length,
    1
  );

  harness.browser.emitBinary(Buffer.alloc(2));
  assertError(harness.browser, 'PCM_NOT_ALLOWED');
  assert.equal(harness.clients[0].finishCalls, 1);
  assert.equal(harness.clients[0].closeCalls, 1);
});

test('invalid or duplicate start never creates a second upstream client', () => {
  const invalidStarts = [
    {},
    { type: 'wrong' },
    {
      type: 'fortune.asr.start',
      audio: { ...VALID_START.audio, sampleRate: 48000 },
    },
  ];

  for (const invalidStart of invalidStarts) {
    const harness = createHarness();
    harness.browser.emitText(invalidStart);
    assert.equal(harness.factoryCalls, 0);
    assertError(harness.browser, 'INVALID_START');
  }

  const harness = createHarness();
  harness.browser.emitText(VALID_START);
  harness.browser.emitText(VALID_START);
  assert.equal(harness.factoryCalls, 1);
  assertError(harness.browser, 'DUPLICATE_START');
  assert.equal(harness.clients[0].closeCalls, 1);
});

test('PCM before start or while connecting is rejected without forwarding', () => {
  const beforeStart = createHarness();
  beforeStart.browser.emitBinary(Buffer.alloc(2));
  assert.equal(beforeStart.factoryCalls, 0);
  assertError(beforeStart.browser, 'PCM_NOT_ALLOWED');

  const connecting = createHarness();
  connecting.browser.emitText(VALID_START);
  connecting.browser.emitBinary(Buffer.alloc(2));
  assert.equal(connecting.clients[0].pcmChunks.length, 0);
  assertError(connecting.browser, 'PCM_NOT_ALLOWED');
  assert.equal(connecting.clients[0].closeCalls, 1);
});

test('non-buffer, empty, odd and oversized PCM chunks are rejected and never forwarded', () => {
  const invalidChunks = [
    new Uint8Array([1, 2]),
    Buffer.alloc(0),
    Buffer.alloc(3),
    Buffer.alloc(DEFAULT_MAX_PCM_CHUNK_BYTES + 2),
  ];

  for (const chunk of invalidChunks) {
    const harness = createHarness();
    harness.browser.emitText(VALID_START);
    harness.clients[0].emit('ready');
    harness.browser.emitBinary(chunk);
    assert.equal(harness.clients[0].pcmChunks.length, 0);
    assertError(harness.browser, 'INVALID_PCM_CHUNK');
    assert.equal(harness.clients[0].closeCalls, 1);
  }
});

test('duplicate finish and PCM after finish are protocol errors and finish is sent once', () => {
  const duplicateFinish = createHarness();
  duplicateFinish.browser.emitText(VALID_START);
  duplicateFinish.clients[0].emit('ready');
  duplicateFinish.browser.emitText({ type: 'fortune.asr.finish' });
  duplicateFinish.browser.emitText({ type: 'fortune.asr.finish' });
  assert.equal(duplicateFinish.clients[0].finishCalls, 1);
  assertError(duplicateFinish.browser, 'INVALID_FINISH');

  const pcmAfterFinish = createHarness();
  pcmAfterFinish.browser.emitText(VALID_START);
  pcmAfterFinish.clients[0].emit('ready');
  pcmAfterFinish.browser.emitText({ type: 'fortune.asr.finish' });
  pcmAfterFinish.browser.emitBinary(Buffer.alloc(2));
  assert.equal(pcmAfterFinish.clients[0].pcmChunks.length, 0);
  assert.equal(pcmAfterFinish.clients[0].finishCalls, 1);
  assertError(pcmAfterFinish.browser, 'PCM_NOT_ALLOWED');
});

test('upstream failures are stable and sanitized, with no reconnect', () => {
  const logs = [];
  const harness = createHarness({
    logger(message) {
      logs.push(message);
    },
  });
  harness.browser.emitText(VALID_START);
  harness.clients[0].emit(
    'error',
    new Error('credential=fake-api-key raw upstream details')
  );

  assert.equal(harness.factoryCalls, 1);
  assertError(harness.browser, 'UPSTREAM_ASR_ERROR');
  assert.equal(
    JSON.stringify(harness.browser.sent).includes('fake-api-key'),
    false
  );
  assert.equal(logs.join('\n').includes('fake-api-key'), false);
  assert.equal(harness.clients[0].closeCalls, 1);
});

test('browser and upstream closure paths clean up once and suppress late events', () => {
  const browserClosed = createHarness();
  browserClosed.browser.emitText(VALID_START);
  browserClosed.browser.disconnect(1006);
  browserClosed.browser.disconnect(1006);
  assert.equal(browserClosed.clients[0].closeCalls, 1);
  assert.equal(browserClosed.clients[0].listenerCount('ready'), 0);
  assert.equal(browserClosed.clients[0].listenerCount('partial'), 0);
  assert.equal(browserClosed.clients[0].listenerCount('final'), 0);
  assert.equal(browserClosed.clients[0].listenerCount('error'), 0);
  assert.equal(browserClosed.clients[0].listenerCount('closed'), 0);
  assert.equal(browserClosed.controller.state, FORTUNE_ASR_RELAY_STATES.CLOSED);
  browserClosed.clients[0].emit('ready');
  assert.equal(
    browserClosed.browser.sent.some((message) => (
      message.type === 'fortune.asr.started'
    )),
    false
  );

  const upstreamClosed = createHarness();
  upstreamClosed.browser.emitText(VALID_START);
  upstreamClosed.clients[0].emit('ready');
  upstreamClosed.clients[0].emit('closed', {
    code: 1000,
    reason: 'done',
    abnormal: false,
  });
  assert.deepEqual(upstreamClosed.browser.sent.at(-1), {
    type: 'fortune.asr.closed',
  });
  assert.equal(upstreamClosed.browser.closeCalls.length, 1);
  assert.equal(upstreamClosed.clients[0].closeCalls, 0);
});

test('browser send failure closes the upstream client', () => {
  const harness = createHarness();
  harness.browser.emitText(VALID_START);
  harness.browser.sendError = new Error('fake send failure');
  harness.clients[0].emit('ready');
  assert.equal(harness.clients[0].closeCalls, 1);
  assert.equal(harness.controller.state, FORTUNE_ASR_RELAY_STATES.CLOSED);
});

test('multiple browser clients keep independent ASR state and audio', () => {
  const clients = [];
  const handler = createFortuneAsrRelayConnectionHandler({
    asrClientFactory() {
      const client = new FakeAsrClient();
      clients.push(client);
      return client;
    },
  });
  const firstBrowser = new FakeBrowserSocket();
  const secondBrowser = new FakeBrowserSocket();
  handler(firstBrowser);
  handler(secondBrowser);

  firstBrowser.emitText(VALID_START);
  secondBrowser.emitText(VALID_START);
  clients[0].emit('ready');
  clients[1].emit('ready');
  firstBrowser.emitBinary(Buffer.from([1, 2]));
  secondBrowser.emitBinary(Buffer.from([3, 4]));

  assert.equal(clients.length, 2);
  assert.deepEqual(clients[0].pcmChunks, [Buffer.from([1, 2])]);
  assert.deepEqual(clients[1].pcmChunks, [Buffer.from([3, 4])]);
  firstBrowser.disconnect();
  assert.equal(clients[0].closeCalls, 1);
  assert.equal(clients[1].closeCalls, 0);
});

test('environment factory keeps credentials server-side and uses current ASR resource', () => {
  const calls = [];
  const apiKey = 'fake-server-only-api-key';
  const factory = createFortuneAsrClientFactoryFromEnv({
    env: {
      DOUBAO_ASR_API_KEY: apiKey,
      DOUBAO_ASR_RESOURCE_ID: 'volc.seedasr.sauc.duration',
    },
    clientFactory(options) {
      calls.push(options);
      return { marker: true };
    },
  });

  assert.deepEqual(factory(), { marker: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.apiKey, apiKey);
  assert.equal(
    calls[0].config.resourceId,
    'volc.seedasr.sauc.duration'
  );

  const relaySource = fs.readFileSync(
    path.join(PROJECT_DIR, 'fortune_asr_relay.js'),
    'utf8'
  );
  assert.doesNotMatch(relaySource, /businessCallId|CallLifecycle|markConnecting/);
  assert.doesNotMatch(
    JSON.stringify(VALID_START),
    /API_KEY|fake-server-only-api-key/
  );
});

test('missing enabled ASR configuration produces a sanitized browser error', () => {
  const handler = createFortuneAsrRelayConnectionHandler({
    asrClientFactory: createFortuneAsrClientFactoryFromEnv({
      env: {},
    }),
  });
  const browser = new FakeBrowserSocket();
  handler(browser);
  browser.emitText(VALID_START);

  assertError(browser, 'ASR_CONFIGURATION_ERROR');
  assert.equal(
    JSON.stringify(browser.sent).includes('DOUBAO_ASR_API_KEY'),
    false
  );
});
