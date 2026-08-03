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
  MAX_INTERPRETATION_TEXT_LENGTH,
  createFortuneService,
} = require('../services/fortune_service');
const {
  MemoryFortuneSessionStore,
} = require('../stores/memory_fortune_session_store');

const VALID_INTERPRETATION = Object.freeze({
  text: '这支签提醒您先稳住心绪，再辨明方向。眼下的担忧值得被看见，可先把可控之事理清，今天写下一件最需要核实的小事，慢慢去做。',
});

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
  constructor(handler = async () => ({ ...VALID_INTERPRETATION })) {
    this.calls = [];
    this.handler = handler;
  }

  async generateInterpretation(input) {
    this.calls.push(input);
    return this.handler(input, this.calls.length);
  }
}

function createHarness({
  client = new FakeInterpretationClient(),
  clock,
  sessionId = 'fortune-interpretation-test',
} = {}) {
  const store = new MemoryFortuneSessionStore();
  let now = Date.parse('2026-07-28T08:00:00.000Z');
  const service = createFortuneService({
    fortuneSessionStore: store,
    catalogVersion: FORTUNE_CATALOG_VERSION,
    lots: cloneLots(),
    clock: clock || (() => {
      now += 1000;
      return now;
    }),
    idGenerator: () => sessionId,
    randomInt: () => 1,
    interpretationClient: client,
  });
  const publicSession = service.createDrawnSession({
    deityKey: 'yuhuang',
    situationText: '  最近担心家人的身体，也担心工作安排  ',
    ownerType: 'guest',
    ownerId: 'guest-interpretation',
  });
  return {
    client,
    publicSession,
    service,
    store,
  };
}

test('normal generation uses authoritative data and stores a copy', async () => {
  const client = new FakeInterpretationClient(async (input) => {
    input.lot.title = 'fake mutation';
    input.lot.verseLines[0] = 'fake verse mutation';
    return { text: `  ${VALID_INTERPRETATION.text}  ` };
  });
  const { publicSession, service, store } = createHarness({ client });

  const result = await service.interpretSession(publicSession.id);
  assert.deepEqual(result, {
    sessionId: publicSession.id,
    interpretation: VALID_INTERPRETATION,
  });
  assert.equal(client.calls.length, 1);
  assert.equal(
    client.calls[0].situationText,
    '最近担心家人的身体，也担心工作安排'
  );
  assert.equal(client.calls[0].deityKey, 'yuhuang');
  assert.equal(client.calls[0].catalogVersion, 'prototype-v1');
  assert.equal(client.calls[0].lot.id, 'prototype-002');

  const stored = store.findById(publicSession.id);
  assert.equal(stored.interpretationStatus, 'completed');
  assert.equal(
    stored.interpretation.schemaVersion,
    'fortune-interpretation-v2'
  );
  assert.equal(
    stored.lotSnapshot.title,
    FORTUNE_LOTS[1].title
  );
  assert.equal(
    stored.lotSnapshot.verseLines[0],
    FORTUNE_LOTS[1].verseLines[0]
  );
  result.interpretation.text = 'mutated public response';
  stored.interpretation.text = 'mutated store copy';
  assert.equal(
    store.findById(publicSession.id).interpretation.text,
    VALID_INTERPRETATION.text
  );
});

test('completed interpretation is returned without regeneration', async () => {
  const { client, publicSession, service, store } = createHarness();
  const first = await service.interpretSession(publicSession.id);
  const generatedAt = store.findById(
    publicSession.id
  ).interpretation.generatedAt;
  const second = await service.interpretSession(publicSession.id);

  assert.deepEqual(second, first);
  assert.equal(client.calls.length, 1);
  assert.equal(
    store.findById(publicSession.id).interpretation.generatedAt,
    generatedAt
  );
});

test('concurrent requests share one in-flight model call', async () => {
  const deferred = createDeferred();
  const client = new FakeInterpretationClient(
    () => deferred.promise
  );
  const { publicSession, service, store } = createHarness({ client });

  const firstPromise = service.interpretSession(publicSession.id);
  const secondPromise = service.interpretSession(publicSession.id);
  assert.equal(client.calls.length, 1);
  assert.equal(
    store.findById(publicSession.id).interpretationStatus,
    'generating'
  );
  deferred.resolve({ ...VALID_INTERPRETATION });
  const [first, second] = await Promise.all([
    firstPromise,
    secondPromise,
  ]);
  assert.deepEqual(second, first);
  assert.equal(client.calls.length, 1);
  assert.equal(
    store.findById(publicSession.id).interpretationStatus,
    'completed'
  );
});

test('model failure resets state and one explicit retry can succeed', async () => {
  const client = new FakeInterpretationClient(
    async (_input, callCount) => {
      if (callCount === 1) {
        throw new Error('provider-private-error');
      }
      return { ...VALID_INTERPRETATION };
    }
  );
  const { publicSession, service, store } = createHarness({ client });

  await assert.rejects(
    service.interpretSession(publicSession.id),
    (error) => (
      error.statusCode === 502
      && error.code === 'FORTUNE_MODEL_FAILED'
      && !error.message.includes('provider-private-error')
    )
  );
  let stored = store.findById(publicSession.id);
  assert.equal(stored.interpretationStatus, 'not_requested');
  assert.equal(stored.interpretation, null);

  const result = await service.interpretSession(publicSession.id);
  assert.deepEqual(result.interpretation, VALID_INTERPRETATION);
  assert.equal(client.calls.length, 2);
  stored = store.findById(publicSession.id);
  assert.equal(stored.interpretationStatus, 'completed');
});

test('every invalid or unsafe candidate is rejected without a snapshot', async () => {
  const enumerableSymbolCandidate = { ...VALID_INTERPRETATION };
  enumerableSymbolCandidate[Symbol('extra')] = 'not allowed';
  const candidates = [
    null,
    [],
    '正文',
    {},
    { text: undefined },
    { text: 123 },
    { text: '   ' },
    { text: '字'.repeat(MAX_INTERPRETATION_TEXT_LENGTH + 1) },
    { ...VALID_INTERPRETATION, extra: 'not allowed' },
    enumerableSymbolCandidate,
    {
      summary: '旧结构',
      situationReflection: '旧结构',
      smallAction: '旧结构',
      safetyNote: '旧结构',
    },
    {
      text: '<img src=x onerror=alert(1)>',
    },
    { text: '签意概括：先稳住心绪。' },
    { text: '道童解读：慢慢理清眼前的事。' },
    { text: '眼下可做的小事：先写下一件事。' },
    { text: '温馨提示：仅供参考。' },
    { text: '安全免责声明：内容仅作文化体验参考。' },
    { text: '这件事一定会成功' },
    { text: '停止服药等待转机' },
    { text: '确定买入这项投资' },
    { text: '实施伤害他人的计划' },
  ];
  let currentCandidate;
  const client = new FakeInterpretationClient(
    async () => currentCandidate
  );
  const { publicSession, service, store } = createHarness({ client });

  for (const candidate of candidates) {
    currentCandidate = candidate;
    await assert.rejects(
      service.interpretSession(publicSession.id),
      (error) => (
        error.statusCode === 502
        && (
          error.code === 'FORTUNE_MODEL_INVALID_OUTPUT'
          || error.code === 'FORTUNE_MODEL_UNSAFE_OUTPUT'
        )
      )
    );
    const stored = store.findById(publicSession.id);
    assert.equal(stored.interpretationStatus, 'not_requested');
    assert.equal(stored.interpretation, null);
  }
  assert.equal(client.calls.length, candidates.length);
});

test('missing and undrawn sessions do not invoke the model', async () => {
  const { client, service, store } = createHarness();
  await assert.rejects(
    service.interpretSession('fortune-missing'),
    (error) => (
      error.statusCode === 404
      && error.code === 'FORTUNE_SESSION_NOT_FOUND'
    )
  );

  store.save({
    id: 'fortune-pending',
    status: 'pending',
    deityKey: 'yuhuang',
    situationText: '等待抽签',
    catalogVersion: 'prototype-v1',
    lotSnapshot: null,
    ownerType: 'anonymous',
    ownerId: null,
    createdAt: '2026-07-28T08:00:00.000Z',
    drawnAt: null,
    interpretationStatus: 'not_requested',
    interpretation: null,
  });
  await assert.rejects(
    service.interpretSession('fortune-pending'),
    (error) => (
      error.statusCode === 409
      && error.code === 'FORTUNE_SESSION_NOT_DRAWN'
    )
  );
  assert.equal(client.calls.length, 0);
});

test('orphaned generating state is safely recovered once', async () => {
  const { client, publicSession, service, store } = createHarness();
  const stored = store.findById(publicSession.id);
  store.replace({
    ...stored,
    interpretationStatus: 'generating',
    interpretation: null,
  });

  const result = await service.interpretSession(publicSession.id);
  assert.deepEqual(result.interpretation, VALID_INTERPRETATION);
  assert.equal(client.calls.length, 1);
});

test('unconfigured client returns a retryable 503 without locking', async () => {
  const { publicSession, service, store } = createHarness({
    client: null,
  });
  await assert.rejects(
    service.interpretSession(publicSession.id),
    (error) => (
      error.statusCode === 503
      && error.code === 'FORTUNE_MODEL_UNAVAILABLE'
    )
  );
  const stored = store.findById(publicSession.id);
  assert.equal(stored.interpretationStatus, 'not_requested');
  assert.equal(stored.interpretation, null);
});

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

function request({
  port,
  path,
  body,
  contentType = 'application/json',
  cookie,
}) {
  const headers = {};
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers['Content-Type'] = contentType;
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers,
    }, (response) => {
      response.setEncoding('utf8');
      let responseBody = '';
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: JSON.parse(responseBody),
        });
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end(body);
  });
}

async function loginUser(port) {
  const response = await request({
    port,
    path: '/api/auth/login',
    body: JSON.stringify({
      phone: '13800138000',
      code: '123456',
    }),
  });
  assert.equal(response.statusCode, 200);
  return response.headers['set-cookie'][0].split(';', 1)[0];
}

test('HTTP route accepts only sessionId and returns a private projection', async () => {
  const modelClient = new FakeInterpretationClient();
  const app = createApp({
    fortuneInterpretationClient: modelClient,
    fortuneSessionIdGenerator: () => 'fortune-route-test',
    fortuneRandomInt: () => 0,
  });
  const server = http.createServer(app);
  await listenOnTemporaryPort(server);
  const port = server.address().port;

  try {
    const cookie = await loginUser(port);
    const drawResponse = await request({
      port,
      path: '/api/fortune-sessions',
      cookie,
      body: JSON.stringify({
        clientRequestId: '61111111-1111-4111-8111-111111111111',
        characterKey: 'guanyin',
        situationText: '权威处境',
      }),
    });
    assert.equal(drawResponse.statusCode, 201);

    const forgedResponse = await request({
      port,
      path: '/api/fortune-sessions/fortune-route-test/interpretation',
      cookie,
      body: JSON.stringify({
        situationText: '伪造处境',
        deityKey: 'forged',
        lot: { number: 99 },
      }),
    });
    assert.equal(forgedResponse.statusCode, 400);
    assert.equal(
      forgedResponse.body.error.code,
      'INVALID_FORTUNE_INTERPRETATION_REQUEST'
    );
    assert.equal(modelClient.calls.length, 0);

    const response = await request({
      port,
      path: '/api/fortune-sessions/fortune-route-test/interpretation',
      cookie,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      sessionId: 'fortune-route-test',
      interpretation: VALID_INTERPRETATION,
    });
    assert.equal(modelClient.calls.length, 1);
    assert.equal(modelClient.calls[0].situationText, '权威处境');
    const serialized = JSON.stringify(response.body);
    for (const privateField of [
      'situationText',
      'ownerId',
      'prompt',
      'rawResponse',
      'Authorization',
      'apiKey',
      'internalRandomIndex',
      'generatedAt',
      'schemaVersion',
    ]) {
      assert.equal(serialized.includes(privateField), false);
    }

    const repeated = await request({
      port,
      path: '/api/fortune-sessions/fortune-route-test/interpretation',
      cookie,
      body: '{}',
    });
    assert.equal(repeated.statusCode, 200);
    assert.deepEqual(repeated.body, response.body);
    assert.equal(modelClient.calls.length, 1);

    const malformed = await request({
      port,
      path: '/api/fortune-sessions/fortune-route-test/interpretation',
      cookie,
      body: '{"forged":',
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(
      malformed.body.error.code,
      'INVALID_FORTUNE_INTERPRETATION_REQUEST'
    );
  } finally {
    await closeServer(server);
  }
});

test('HTTP route keeps model failure diagnostics out of the public 502', async () => {
  const modelClient = new FakeInterpretationClient(async () => {
    const error = new Error(
      'provider-private-error Authorization: Bearer private-token'
    );
    error.httpStatus = 401;
    error.upstreamErrorCode = 'invalid_api_key';
    error.stack = 'private-stack';
    throw error;
  });
  const app = createApp({
    fortuneInterpretationClient: modelClient,
    fortuneSessionIdGenerator: () => 'fortune-route-failure',
    fortuneRandomInt: () => 0,
  });
  const server = http.createServer(app);
  await listenOnTemporaryPort(server);
  const port = server.address().port;

  try {
    const cookie = await loginUser(port);
    const drawResponse = await request({
      port,
      path: '/api/fortune-sessions',
      cookie,
      body: JSON.stringify({
        clientRequestId: '62222222-2222-4222-8222-222222222222',
        characterKey: 'guanyin',
        situationText: 'route-private-situation',
      }),
    });
    assert.equal(drawResponse.statusCode, 201);

    const response = await request({
      port,
      path:
        '/api/fortune-sessions/fortune-route-failure/interpretation',
      cookie,
    });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      error: {
        code: 'FORTUNE_MODEL_FAILED',
        message: 'Fortune interpretation could not be generated',
      },
    });
    const serialized = JSON.stringify(response.body);
    for (const privateValue of [
      'provider-private-error',
      'Authorization',
      'private-token',
      'private-stack',
      'route-private-situation',
      'httpStatus',
      'upstreamErrorCode',
      'invalid_api_key',
    ]) {
      assert.equal(serialized.includes(privateValue), false);
    }
  } finally {
    await closeServer(server);
  }
});

test('HTTP route reports unconfigured text model as 503', async () => {
  const app = createApp({
    fortuneSessionIdGenerator: () => 'fortune-unconfigured',
    fortuneRandomInt: () => 0,
  });
  const server = http.createServer(app);
  await listenOnTemporaryPort(server);
  const port = server.address().port;

  try {
    const cookie = await loginUser(port);
    const drawResponse = await request({
      port,
      path: '/api/fortune-sessions',
      cookie,
      body: JSON.stringify({
        clientRequestId: '63333333-3333-4333-8333-333333333333',
        characterKey: 'guanyin',
        situationText: '等待解签',
      }),
    });
    assert.equal(drawResponse.statusCode, 201);
    const response = await request({
      port,
      path:
        '/api/fortune-sessions/fortune-unconfigured/interpretation',
      cookie,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'FORTUNE_MODEL_UNAVAILABLE',
        message: 'Fortune interpretation is temporarily unavailable',
      },
    });
  } finally {
    await closeServer(server);
  }
});
