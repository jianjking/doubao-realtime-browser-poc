'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
    server.listen(0, '127.0.0.1');
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function startApp(options = {}) {
  const stores = createBusinessStores({ databasePath: ':memory:' });
  let nextFortuneId = 1;
  let nextPurchaseId = 1;
  const server = http.createServer(createApp({
    businessStores: stores,
    ...createMockSmsTestOptions(),
    fortuneDrawPriceCents: 200,
    fortuneRandomInt: () => 0,
    fortuneSessionIdGenerator: () => `fortune-route-paid-${nextFortuneId++}`,
    fortunePurchaseIdGenerator: () => `purchase-route-paid-${nextPurchaseId++}`,
    fortuneInterpretationClient: {
      async generateInterpretation() {
        return { text: '道童文字解签不会再次扣费。' };
      },
    },
    fortuneTtsClient: {
      async synthesize() {
        return {
          contentType: 'audio/mpeg',
          audioBuffer: Buffer.from([0x49, 0x44, 0x33]),
        };
      },
    },
    ...options,
  }));
  await listen(server);
  return { port: server.address().port, server, stores };
}

function request({ port, path, method = 'GET', cookie, json }) {
  const body = json === undefined ? undefined : JSON.stringify(json);
  const headers = { Accept: 'application/json' };
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const client = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    client.once('error', reject);
    client.end(body);
  });
}

function parseJson(response) {
  return JSON.parse(response.body.toString('utf8'));
}

async function login(port, phone) {
  const { challengeId } = await requestSmsChallenge(port, phone);
  const response = await request({
    port,
    path: '/api/auth/login',
    method: 'POST',
    json: { phone, challengeId, code: TEST_SMS_CODE },
  });
  assert.equal(response.statusCode, 200);
  return {
    cookie: response.headers['set-cookie'][0].split(';', 1)[0],
    userId: parseJson(response).principal.id,
  };
}

function drawRequest(clientRequestId) {
  return {
    clientRequestId,
    characterKey: 'guanyin',
    situationText: '路由测试心愿',
  };
}

test('public Fortune config is safe and guests or invalid sessions cannot draw', async () => {
  const app = await startApp();
  try {
    const config = await request({
      port: app.port,
      path: '/api/fortune-config',
    });
    assert.equal(config.statusCode, 200);
    assert.equal(config.headers['cache-control'], 'no-store');
    assert.deepEqual(parseJson(config), {
      drawPriceCents: 200,
      currency: 'CNY',
      chargeTiming: 'fortune_session_created',
    });

    for (const cookie of [undefined, 'companion_session=expired']) {
      const denied = await request({
        port: app.port,
        path: '/api/fortune-sessions',
        method: 'POST',
        cookie,
        json: drawRequest('a1111111-1111-4111-8111-111111111111'),
      });
      assert.equal(denied.statusCode, 401);
      assert.equal(parseJson(denied).error.code, 'USER_LOGIN_REQUIRED');
    }

    const guest = await request({
      port: app.port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const guestDenied = await request({
      port: app.port,
      path: '/api/fortune-sessions',
      method: 'POST',
      cookie: guest.headers['set-cookie'][0].split(';', 1)[0],
      json: drawRequest('a2222222-2222-4222-8222-222222222222'),
    });
    assert.equal(guestDenied.statusCode, 401);
    assert.equal(parseJson(guestDenied).error.code, 'USER_LOGIN_REQUIRED');
  } finally {
    await close(app.server);
    app.stores.close();
  }
});

test('owner can retry draw, interpretation, audio and recovery without another charge', async () => {
  const app = await startApp();
  try {
    const owner = await login(app.port, '13800138000');
    const other = await login(app.port, '13900139000');
    const requestId = 'b1111111-1111-4111-8111-111111111111';
    const first = await request({
      port: app.port,
      path: '/api/fortune-sessions',
      method: 'POST',
      cookie: owner.cookie,
      json: drawRequest(requestId),
    });
    assert.equal(first.statusCode, 201);
    const firstBody = parseJson(first);
    assert.equal(firstBody.charge.alreadyProcessed, false);
    assert.equal(firstBody.charge.balanceAfterCents, 1050);

    const retries = await Promise.all(Array.from({ length: 10 }, () => request({
      port: app.port,
      path: '/api/fortune-sessions',
      method: 'POST',
      cookie: owner.cookie,
      json: drawRequest(requestId),
    })));
    assert.ok(retries.every((response) => response.statusCode === 200));
    assert.ok(retries.every((response) => {
      const body = parseJson(response);
      return body.fortuneSession.id === firstBody.fortuneSession.id
        && body.charge.alreadyProcessed === true;
    }));

    const sessionPath = `/api/fortune-sessions/${firstBody.fortuneSession.id}`;
    for (const suffix of ['', '/interpretation', '/interpretation-audio']) {
      const denied = await request({
        port: app.port,
        path: `${sessionPath}${suffix}`,
        method: suffix === '' ? 'GET' : 'POST',
        cookie: other.cookie,
      });
      assert.equal(denied.statusCode, 404);
      assert.equal(
        parseJson(denied).error.code,
        'FORTUNE_SESSION_ACCESS_DENIED'
      );
    }

    const recovered = await request({
      port: app.port,
      path: sessionPath,
      cookie: owner.cookie,
    });
    assert.equal(recovered.statusCode, 200);
    assert.equal(parseJson(recovered).charge.alreadyProcessed, true);
    for (let index = 0; index < 2; index += 1) {
      const interpretation = await request({
        port: app.port,
        path: `${sessionPath}/interpretation`,
        method: 'POST',
        cookie: owner.cookie,
      });
      assert.equal(interpretation.statusCode, 200);
      const audio = await request({
        port: app.port,
        path: `${sessionPath}/interpretation-audio`,
        method: 'POST',
        cookie: owner.cookie,
      });
      assert.equal(audio.statusCode, 200);
      assert.equal(audio.headers['content-type'], 'audio/mpeg');
    }
    assert.equal(
      app.stores.accountStore.findByUserId(owner.userId).balanceCents,
      1050
    );
    assert.ok(
      app.stores.fortunePurchaseStore.findByUserAndClientRequestId(
        owner.userId,
        requestId
      )
    );
  } finally {
    await close(app.server);
    app.stores.close();
  }
});

test('insufficient balance stays unchanged and recharge retry uses the same request once', async () => {
  const app = await startApp({ initialBalanceCents: 199 });
  try {
    const owner = await login(app.port, '13700137000');
    const requestId = 'c1111111-1111-4111-8111-111111111111';
    const first = await request({
      port: app.port,
      path: '/api/fortune-sessions',
      method: 'POST',
      cookie: owner.cookie,
      json: drawRequest(requestId),
    });
    assert.equal(first.statusCode, 409);
    assert.deepEqual(parseJson(first).error, {
      code: 'INSUFFICIENT_ACCOUNT_BALANCE',
      message: 'Account balance is insufficient for this Fortune drawing',
      priceCents: 200,
      balanceCents: 199,
      shortfallCents: 1,
    });
    assert.equal(
      app.stores.fortunePurchaseStore.findByUserAndClientRequestId(
        owner.userId,
        requestId
      ),
      null
    );

    const account = app.stores.accountStore.findByUserId(owner.userId);
    app.stores.accountStore.replace({
      ...account,
      balanceCents: account.balanceCents + 1000,
      updatedAt: '2026-08-03T10:00:00.000Z',
    });
    const paid = await request({
      port: app.port,
      path: '/api/fortune-sessions',
      method: 'POST',
      cookie: owner.cookie,
      json: drawRequest(requestId),
    });
    assert.equal(paid.statusCode, 201);
    assert.equal(parseJson(paid).charge.balanceAfterCents, 999);
    const duplicate = await request({
      port: app.port,
      path: '/api/fortune-sessions',
      method: 'POST',
      cookie: owner.cookie,
      json: drawRequest(requestId),
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(parseJson(duplicate).charge.alreadyProcessed, true);
    assert.equal(
      app.stores.accountStore.findByUserId(owner.userId).balanceCents,
      999
    );
  } finally {
    await close(app.server);
    app.stores.close();
  }
});
