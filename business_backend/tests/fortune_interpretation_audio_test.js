'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const {
  FORTUNE_CATALOG_VERSION,
  FORTUNE_LOTS,
} = require('../config/fortune_lots');
const {
  createFortuneService,
} = require('../services/fortune_service');
const {
  MemoryFortuneSessionStore,
} = require('../stores/memory_fortune_session_store');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

const VALID_INTERPRETATION = Object.freeze({
  text: '先安住心绪，再看眼前可做之事。这份牵挂值得被看见，也可以慢慢理清，今天先完成一件力所能及的小事。',
});
const TEST_AUDIO = Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00,
]);
const cookiesByPort = new Map();

function cloneLots() {
  return FORTUNE_LOTS.map((lot) => ({
    ...lot,
    verseLines: [...lot.verseLines],
  }));
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

class FakeInterpretationClient {
  constructor() {
    this.calls = [];
  }

  async generateInterpretation(input) {
    this.calls.push(input);
    return { ...VALID_INTERPRETATION };
  }
}

class FakeTtsClient {
  constructor(handler = async () => ({
    audioBuffer: Buffer.from(TEST_AUDIO),
    contentType: 'audio/mpeg',
  })) {
    this.calls = [];
    this.handler = handler;
  }

  async synthesize(input) {
    this.calls.push({ ...input });
    return this.handler(input, this.calls.length);
  }
}

function createHarness({
  interpretationClient = new FakeInterpretationClient(),
  sessionId = 'fortune-audio-test',
  ttsClient = new FakeTtsClient(),
} = {}) {
  const store = new MemoryFortuneSessionStore();
  let now = Date.parse('2026-07-29T08:00:00.000Z');
  const service = createFortuneService({
    fortuneSessionStore: store,
    catalogVersion: FORTUNE_CATALOG_VERSION,
    lots: cloneLots(),
    clock: () => {
      now += 1000;
      return now;
    },
    idGenerator: () => sessionId,
    randomInt: () => 1,
    interpretationClient,
    ttsClient,
  });
  const publicSession = service.createDrawnSession({
    deityKey: 'yuhuang',
    situationText: '希望把眼前的小事慢慢理清。',
  });
  return {
    interpretationClient,
    publicSession,
    service,
    store,
    ttsClient,
  };
}

async function completeInterpretation(harness) {
  return harness.service.interpretSession(
    harness.publicSession.id
  );
}

function listenOnTemporaryPort(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startApp(options = {}) {
  const clock = options.clock || Date.now;
  const server = http.createServer(createApp({
    ...createMockSmsTestOptions({ clock }),
    ...options,
  }));
  await listenOnTemporaryPort(server);
  const port = server.address().port;
  const { challengeId } = await requestSmsChallenge(
    port,
    '13800138000'
  );
  const login = await requestJson({
    port,
    path: '/api/auth/login',
    value: {
      phone: '13800138000',
      challengeId,
      code: TEST_SMS_CODE,
    },
  });
  assert.equal(login.statusCode, 200);
  cookiesByPort.set(
    port,
    login.headers['set-cookie'][0].split(';', 1)[0]
  );
  return {
    server,
    port,
  };
}

function request({
  port,
  path,
  body,
  contentType,
}) {
  const headers = {};
  const cookie = cookiesByPort.get(port);
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers['Content-Length'] = Buffer.byteLength(body);
    if (contentType !== undefined) {
      headers['Content-Type'] = contentType;
    }
  }
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end(body);
  });
}

function requestJson({ port, path, value }) {
  const body = JSON.stringify(value);
  return request({
    port,
    path,
    body,
    contentType: 'application/json',
  });
}

function parseJson(response) {
  return JSON.parse(response.body.toString('utf8'));
}

test('service validates the configured TTS client shape', () => {
  assert.throws(() => {
    createFortuneService({
      fortuneSessionStore: new MemoryFortuneSessionStore(),
      catalogVersion: FORTUNE_CATALOG_VERSION,
      lots: cloneLots(),
      ttsClient: {},
    });
  }, /ttsClient must provide synthesize/);
});

test('audio requires a completed interpretation and configured client', async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.synthesizeInterpretationAudio('bad id'),
    (error) => (
      error.statusCode === 400
      && error.code
        === 'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST'
    )
  );
  await assert.rejects(
    harness.service.synthesizeInterpretationAudio(
      'fortune-audio-missing'
    ),
    (error) => (
      error.statusCode === 404
      && error.code === 'FORTUNE_SESSION_NOT_FOUND'
    )
  );
  await assert.rejects(
    harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    ),
    (error) => (
      error.statusCode === 409
      && error.code === 'FORTUNE_INTERPRETATION_NOT_READY'
    )
  );
  assert.equal(harness.ttsClient.calls.length, 0);
  assert.equal(
    harness.store.findById(
      harness.publicSession.id
    ).interpretationAudio,
    null
  );

  const unconfigured = createHarness({ ttsClient: null });
  await completeInterpretation(unconfigured);
  await assert.rejects(
    unconfigured.service.synthesizeInterpretationAudio(
      unconfigured.publicSession.id
    ),
    (error) => (
      error.statusCode === 503
      && error.code === 'FORTUNE_TTS_UNAVAILABLE'
    )
  );
  const stored = unconfigured.store.findById(
    unconfigured.publicSession.id
  );
  assert.equal(stored.interpretationStatus, 'completed');
  assert.equal(stored.interpretationAudioStatus, 'not_requested');
  assert.equal(stored.interpretationAudio, null);
});

test('normal and repeated audio generation stores one isolated snapshot', async () => {
  const sourceBuffer = Buffer.from(TEST_AUDIO);
  const ttsClient = new FakeTtsClient(async () => ({
    audioBuffer: sourceBuffer,
    contentType: 'audio/mpeg',
    rawProviderResponse: 'must not be stored',
  }));
  const harness = createHarness({ ttsClient });
  await completeInterpretation(harness);

  const first =
    await harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    );
  assert.equal(ttsClient.calls.length, 1);
  assert.deepEqual(ttsClient.calls[0], {
    text: VALID_INTERPRETATION.text,
  });
  assert.doesNotMatch(
    ttsClient.calls[0].text,
    /签意概括|道童解读|眼下可做的小事|温馨提示|仅供参考/
  );
  assert.equal(
    ttsClient.calls[0].text.includes(
      '签文与解读仅作传统文化体验及情绪陪伴参考。'
    ),
    false
  );
  assert.equal(first.contentType, 'audio/mpeg');
  assert.deepEqual(first.audioBuffer, TEST_AUDIO);

  sourceBuffer.fill(0);
  first.audioBuffer.fill(1);
  let stored = harness.store.findById(harness.publicSession.id);
  assert.equal(stored.interpretationAudioStatus, 'completed');
  assert.equal(
    'rawProviderResponse' in stored.interpretationAudio,
    false
  );
  assert.deepEqual(
    stored.interpretationAudio.audioBuffer,
    TEST_AUDIO
  );

  stored.interpretationAudio.audioBuffer.fill(2);
  assert.deepEqual(
    harness.store.findById(
      harness.publicSession.id
    ).interpretationAudio.audioBuffer,
    TEST_AUDIO
  );

  const repeated =
    await harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    );
  assert.equal(ttsClient.calls.length, 1);
  assert.equal(repeated.contentType, first.contentType);
  assert.deepEqual(repeated.audioBuffer, TEST_AUDIO);
  repeated.audioBuffer.fill(3);
  assert.deepEqual(
    harness.store.findById(
      harness.publicSession.id
    ).interpretationAudio.audioBuffer,
    TEST_AUDIO
  );
});

test('concurrent audio requests share one in-flight synthesis', async () => {
  const deferred = createDeferred();
  const ttsClient = new FakeTtsClient(() => deferred.promise);
  const harness = createHarness({ ttsClient });
  await completeInterpretation(harness);

  const firstPromise =
    harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    );
  const secondPromise =
    harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    );
  assert.equal(ttsClient.calls.length, 1);
  assert.equal(
    harness.store.findById(
      harness.publicSession.id
    ).interpretationAudioStatus,
    'generating'
  );

  deferred.resolve({
    audioBuffer: Buffer.from(TEST_AUDIO),
    contentType: 'audio/mpeg',
  });
  const [first, second] = await Promise.all([
    firstPromise,
    secondPromise,
  ]);
  assert.equal(ttsClient.calls.length, 1);
  assert.deepEqual(first.audioBuffer, TEST_AUDIO);
  assert.deepEqual(second.audioBuffer, TEST_AUDIO);
  first.audioBuffer.fill(0);
  assert.deepEqual(second.audioBuffer, TEST_AUDIO);
  assert.deepEqual(
    harness.store.findById(
      harness.publicSession.id
    ).interpretationAudio.audioBuffer,
    TEST_AUDIO
  );
});

test('failed audio synthesis clears state and can be retried', async () => {
  const ttsClient = new FakeTtsClient(
    async (_input, callCount) => {
      if (callCount === 1) {
        throw new Error('private-provider-tts-error');
      }
      return {
        audioBuffer: Buffer.from(TEST_AUDIO),
        contentType: 'audio/mpeg',
      };
    }
  );
  const harness = createHarness({ ttsClient });
  await completeInterpretation(harness);

  await assert.rejects(
    harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    ),
    (error) => (
      error.statusCode === 502
      && error.code === 'FORTUNE_TTS_FAILED'
      && !error.message.includes('private-provider-tts-error')
    )
  );
  let stored = harness.store.findById(harness.publicSession.id);
  assert.equal(stored.interpretationAudioStatus, 'not_requested');
  assert.equal(stored.interpretationAudio, null);

  const result =
    await harness.service.synthesizeInterpretationAudio(
      harness.publicSession.id
    );
  assert.equal(ttsClient.calls.length, 2);
  assert.deepEqual(result.audioBuffer, TEST_AUDIO);
  stored = harness.store.findById(harness.publicSession.id);
  assert.equal(stored.interpretationAudioStatus, 'completed');
});

test('invalid TTS results are rejected without a snapshot', async () => {
  const invalidResults = [
    {
      audioBuffer: Buffer.alloc(0),
      contentType: 'audio/mpeg',
    },
    {
      audioBuffer: new Uint8Array(TEST_AUDIO),
      contentType: 'audio/mpeg',
    },
    {
      audioBuffer: Buffer.from(TEST_AUDIO),
      contentType: '',
    },
    {
      audioBuffer: Buffer.from(TEST_AUDIO),
      contentType: 'text/html',
    },
  ];

  for (let index = 0; index < invalidResults.length; index += 1) {
    const ttsClient = new FakeTtsClient(
      async () => invalidResults[index]
    );
    const harness = createHarness({
      sessionId: `fortune-invalid-audio-${index}`,
      ttsClient,
    });
    await completeInterpretation(harness);

    await assert.rejects(
      harness.service.synthesizeInterpretationAudio(
        harness.publicSession.id
      ),
      (error) => (
        error.statusCode === 502
        && error.code === 'FORTUNE_TTS_FAILED'
      )
    );
    const stored = harness.store.findById(
      harness.publicSession.id
    );
    assert.equal(stored.interpretationAudioStatus, 'not_requested');
    assert.equal(stored.interpretationAudio, null);
  }
});

test('memory store copies audio buffers on write and read', () => {
  const store = new MemoryFortuneSessionStore();
  const originalAudio = Buffer.from(TEST_AUDIO);
  store.save({
    id: 'fortune-store-audio',
    status: 'drawn',
    deityKey: 'yuhuang',
    situationText: '测试处境',
    catalogVersion: FORTUNE_CATALOG_VERSION,
    lotSnapshot: {
      ...FORTUNE_LOTS[0],
      verseLines: [...FORTUNE_LOTS[0].verseLines],
    },
    ownerType: 'anonymous',
    ownerId: null,
    createdAt: '2026-07-29T08:00:00.000Z',
    drawnAt: '2026-07-29T08:00:00.000Z',
    interpretationStatus: 'completed',
    interpretation: {
      schemaVersion: 'fortune-interpretation-v2',
      ...VALID_INTERPRETATION,
      generatedAt: '2026-07-29T08:00:01.000Z',
    },
    interpretationAudioStatus: 'completed',
    interpretationAudio: {
      contentType: 'audio/mpeg',
      audioBuffer: originalAudio,
    },
  });

  originalAudio.fill(0);
  const firstRead = store.findById('fortune-store-audio');
  assert.deepEqual(
    firstRead.interpretationAudio.audioBuffer,
    TEST_AUDIO
  );
  firstRead.interpretationAudio.audioBuffer.fill(1);
  assert.deepEqual(
    store.findById(
      'fortune-store-audio'
    ).interpretationAudio.audioBuffer,
    TEST_AUDIO
  );
});

test('HTTP route accepts only session ID and returns binary audio', async () => {
  const interpretationClient = new FakeInterpretationClient();
  const ttsClient = new FakeTtsClient();
  const app = await startApp({
    fortuneInterpretationClient: interpretationClient,
    fortuneTtsClient: ttsClient,
    fortuneSessionIdGenerator: () => 'fortune-audio-route',
    fortuneRandomInt: () => 0,
  });

  try {
    const draw = await requestJson({
      port: app.port,
      path: '/api/fortune-sessions',
      value: {
        clientRequestId: '71111111-1111-4111-8111-111111111111',
        characterKey: 'guanyin',
        situationText: '希望先安静下来。',
      },
    });
    assert.equal(draw.statusCode, 201);

    const invalidSessionId = await request({
      port: app.port,
      path: '/api/fortune-sessions/bad!/interpretation-audio',
    });
    assert.equal(invalidSessionId.statusCode, 400);
    assert.equal(
      parseJson(invalidSessionId).error.code,
      'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST'
    );

    const missing = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-missing/interpretation-audio',
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(
      parseJson(missing).error.code,
      'FORTUNE_SESSION_ACCESS_DENIED'
    );

    const notReady = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-route/interpretation-audio',
    });
    assert.equal(notReady.statusCode, 409);
    assert.equal(
      parseJson(notReady).error.code,
      'FORTUNE_INTERPRETATION_NOT_READY'
    );

    for (const value of [
      { text: '客户端伪造文字' },
      { interpretation: VALID_INTERPRETATION },
    ]) {
      const forged = await requestJson({
        port: app.port,
        path:
          '/api/fortune-sessions/fortune-audio-route/interpretation-audio',
        value,
      });
      assert.equal(forged.statusCode, 400);
      assert.equal(
        parseJson(forged).error.code,
        'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST'
      );
    }
    const malformed = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-route/interpretation-audio',
      body: '{"text":',
      contentType: 'application/json',
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(
      parseJson(malformed).error.code,
      'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST'
    );
    const unparsedBody = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-route/interpretation-audio',
      body: 'client supplied narration',
      contentType: 'text/plain',
    });
    assert.equal(unparsedBody.statusCode, 400);
    assert.equal(
      parseJson(unparsedBody).error.code,
      'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST'
    );
    assert.equal(ttsClient.calls.length, 0);

    const interpretation = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-route/interpretation',
    });
    assert.equal(interpretation.statusCode, 200);
    assert.equal(interpretationClient.calls.length, 1);

    const first = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-route/interpretation-audio',
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['content-type'], 'audio/mpeg');
    assert.equal(
      first.headers['content-length'],
      String(TEST_AUDIO.length)
    );
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.deepEqual(first.body, TEST_AUDIO);
    assert.equal(ttsClient.calls.length, 1);
    assert.deepEqual(ttsClient.calls[0], {
      text: VALID_INTERPRETATION.text,
    });

    const repeated = await requestJson({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-route/interpretation-audio',
      value: {},
    });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.headers['content-type'], 'audio/mpeg');
    assert.equal(repeated.headers['cache-control'], 'no-store');
    assert.deepEqual(repeated.body, TEST_AUDIO);
    assert.equal(ttsClient.calls.length, 1);
  } finally {
    await closeServer(app.server);
  }
});

test('unconfigured HTTP audio route remains retryable', async () => {
  const app = await startApp({
    fortuneInterpretationClient: new FakeInterpretationClient(),
    fortuneSessionIdGenerator: () => 'fortune-audio-unconfigured',
    fortuneRandomInt: () => 0,
  });

  try {
    const draw = await requestJson({
      port: app.port,
      path: '/api/fortune-sessions',
      value: {
        clientRequestId: '72222222-2222-4222-8222-222222222222',
        characterKey: 'guanyin',
        situationText: '希望稳步处理眼前的事。',
      },
    });
    assert.equal(draw.statusCode, 201);
    const interpretation = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-unconfigured/interpretation',
    });
    assert.equal(interpretation.statusCode, 200);

    const audio = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-unconfigured/interpretation-audio',
    });
    assert.equal(audio.statusCode, 503);
    assert.deepEqual(parseJson(audio), {
      error: {
        code: 'FORTUNE_TTS_UNAVAILABLE',
        message:
          'Fortune interpretation audio is temporarily unavailable',
      },
    });
  } finally {
    await closeServer(app.server);
  }
});

test('HTTP audio failure is sanitized and an explicit retry succeeds', async () => {
  const ttsClient = new FakeTtsClient(
    async (_input, callCount) => {
      if (callCount === 1) {
        throw new Error('private-http-tts-error');
      }
      return {
        audioBuffer: Buffer.from(TEST_AUDIO),
        contentType: 'audio/mpeg',
      };
    }
  );
  const app = await startApp({
    fortuneInterpretationClient: new FakeInterpretationClient(),
    fortuneTtsClient: ttsClient,
    fortuneSessionIdGenerator: () => 'fortune-audio-http-retry',
    fortuneRandomInt: () => 0,
  });

  try {
    const draw = await requestJson({
      port: app.port,
      path: '/api/fortune-sessions',
      value: {
        clientRequestId: '73333333-3333-4333-8333-333333333333',
        characterKey: 'guanyin',
        situationText: '希望先完成眼前的一件小事。',
      },
    });
    assert.equal(draw.statusCode, 201);
    const interpretation = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-http-retry/interpretation',
    });
    assert.equal(interpretation.statusCode, 200);

    const failed = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-http-retry/interpretation-audio',
    });
    assert.equal(failed.statusCode, 502);
    assert.deepEqual(parseJson(failed), {
      error: {
        code: 'FORTUNE_TTS_FAILED',
        message:
          'Fortune interpretation audio could not be generated',
      },
    });
    assert.equal(
      failed.body.includes(Buffer.from('private-http-tts-error')),
      false
    );

    const succeeded = await request({
      port: app.port,
      path:
        '/api/fortune-sessions/fortune-audio-http-retry/interpretation-audio',
    });
    assert.equal(succeeded.statusCode, 200);
    assert.equal(succeeded.headers['content-type'], 'audio/mpeg');
    assert.deepEqual(succeeded.body, TEST_AUDIO);
    assert.equal(ttsClient.calls.length, 2);
  } finally {
    await closeServer(app.server);
  }
});
