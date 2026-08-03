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

function requestJson(port, {
  method = 'GET',
  path,
  cookie = '',
  body,
} = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(payload === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        }),
      },
    }, (response) => {
      let responseText = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseText += chunk;
      });
      response.on('end', () => {
        let responseBody = null;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = null;
        }
        resolve({
          body: responseBody,
          headers: response.headers,
          statusCode: response.statusCode,
        });
      });
    });
    request.on('error', reject);
    if (payload !== null) {
      request.write(payload);
    }
    request.end();
  });
}

async function startHarness({
  mode = 'mock',
  mockConfirmationEnabled = true,
  nodeEnv = 'test',
} = {}) {
  const stores = createBusinessStores({ databasePath: ':memory:' });
  const app = createApp({
    businessStores: stores,
    ...createMockSmsTestOptions(),
    paymentRuntimeConfig: {
      mode,
      mockConfirmationEnabled,
      nodeEnv,
    },
  });
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => {
      resolve(listeningServer);
    });
  });
  return {
    port: server.address().port,
    stores,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      stores.close();
    },
  };
}

async function login(port, phone) {
  const { challengeId } = await requestSmsChallenge(port, phone);
  const response = await requestJson(port, {
    method: 'POST',
    path: '/api/auth/login',
    body: { phone, challengeId, code: TEST_SMS_CODE },
  });
  assert.equal(response.statusCode, 200);
  const rawCookie = response.headers['set-cookie'][0];
  return {
    cookie: rawCookie.split(';', 1)[0],
    userId: response.body.principal.id,
  };
}

async function createOrder(port, cookie, {
  provider = 'wechat',
  amountCents = 1000,
  clientRequestId = '11111111-1111-4111-8111-111111111111',
} = {}) {
  return requestJson(port, {
    method: 'POST',
    path: '/api/payment-orders',
    cookie,
    body: { provider, amountCents, clientRequestId },
  });
}

test('payment routes gate guests and never expose dev recharge', async () => {
  const harness = await startHarness();
  try {
    const anonymous = await createOrder(harness.port, '');
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.body.error.code, 'AUTH_REQUIRED');

    const guestSession = await requestJson(harness.port, {
      method: 'POST',
      path: '/api/auth/guest',
    });
    const guestCookie = guestSession.headers['set-cookie'][0].split(';', 1)[0];
    const guestCreate = await createOrder(harness.port, guestCookie);
    assert.equal(guestCreate.statusCode, 403);
    assert.equal(guestCreate.body.error.code, 'USER_LOGIN_REQUIRED');

    const user = await login(harness.port, '13800000000');
    const oldRecharge = await requestJson(harness.port, {
      method: 'POST',
      path: '/api/dev/recharge',
      cookie: user.cookie,
      body: { amountCents: 1000 },
    });
    assert.equal(oldRecharge.statusCode, 404);
  } finally {
    await harness.close();
  }
});

test('payment APIs create, query, reject tampering, and complete idempotently', async () => {
  const harness = await startHarness();
  try {
    const user = await login(harness.port, '13800000000');
    const first = await createOrder(harness.port, user.cookie);
    assert.equal(first.statusCode, 201);
    assert.equal(first.body.order.status, 'pending');
    assert.equal(first.body.checkout.kind, 'mock');
    assert.deepEqual(
      Object.keys(first.body.order).sort(),
      [
        'amountCents',
        'closedAt',
        'createdAt',
        'creditedAt',
        'currency',
        'expiresAt',
        'failureCode',
        'id',
        'paidAt',
        'provider',
        'requestedScene',
        'status',
      ]
    );

    const repeatedCreate = await createOrder(harness.port, user.cookie, {
      provider: 'alipay',
      amountCents: 2000,
    });
    assert.equal(repeatedCreate.statusCode, 200);
    assert.equal(repeatedCreate.body.order.id, first.body.order.id);
    assert.equal(repeatedCreate.body.order.provider, 'wechat');
    assert.equal(repeatedCreate.body.order.amountCents, 1000);

    const forgedComplete = await requestJson(harness.port, {
      method: 'POST',
      path: `/api/payment-orders/${first.body.order.id}/mock-complete`,
      cookie: user.cookie,
      body: { amountCents: 999999 },
    });
    assert.equal(forgedComplete.statusCode, 400);
    assert.equal(forgedComplete.body.error.code, 'INVALID_PAYMENT_REQUEST');
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      1250
    );

    const completed = await requestJson(harness.port, {
      method: 'POST',
      path: `/api/payment-orders/${first.body.order.id}/mock-complete`,
      cookie: user.cookie,
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.body.order.status, 'credited');
    assert.equal(completed.body.account.balanceCents, 2250);
    assert.equal(completed.body.alreadyProcessed, false);

    const repeatedComplete = await requestJson(harness.port, {
      method: 'POST',
      path: `/api/payment-orders/${first.body.order.id}/mock-complete`,
      cookie: user.cookie,
    });
    assert.equal(repeatedComplete.statusCode, 200);
    assert.equal(repeatedComplete.body.alreadyProcessed, true);
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId(user.userId).length,
      1
    );
    assert.equal(
      harness.stores.paymentNotificationStore.findByPaymentOrderId(
        first.body.order.id
      ).length,
      1
    );

    const query = await requestJson(harness.port, {
      path: `/api/payment-orders/${first.body.order.id}`,
      cookie: user.cookie,
    });
    assert.equal(query.statusCode, 200);
    assert.equal(query.body.order.status, 'credited');
  } finally {
    await harness.close();
  }
});

test('cross-user access is hidden and ten HTTP completions credit once', async () => {
  const harness = await startHarness();
  try {
    const userA = await login(harness.port, '13800000000');
    const userB = await login(harness.port, '13900000000');
    const created = await createOrder(harness.port, userA.cookie, {
      provider: 'alipay',
      amountCents: 2301,
      clientRequestId: '22222222-2222-4222-8222-222222222222',
    });
    assert.equal(created.statusCode, 201);
    const orderPath = `/api/payment-orders/${created.body.order.id}`;

    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/mock-complete'],
      ['POST', '/close'],
    ]) {
      const response = await requestJson(harness.port, {
        method,
        path: `${orderPath}${suffix}`,
        cookie: userB.cookie,
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error.code, 'PAYMENT_ORDER_NOT_FOUND');
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, () => requestJson(harness.port, {
        method: 'POST',
        path: `${orderPath}/mock-complete`,
        cookie: userA.cookie,
      }))
    );
    assert.equal(results.every((response) => response.statusCode === 200), true);
    assert.equal(
      results.filter((response) => !response.body.alreadyProcessed).length,
      1
    );
    assert.equal(
      harness.stores.accountStore.findByUserId(userA.userId).balanceCents,
      3551
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId(userA.userId).length,
      1
    );
    assert.equal(
      harness.stores.accountStore.findByUserId(userB.userId).balanceCents,
      1250
    );
  } finally {
    await harness.close();
  }
});

test('invalid amounts and disabled mock confirmation fail safely', async () => {
  const harness = await startHarness({ mockConfirmationEnabled: false });
  try {
    const user = await login(harness.port, '13800000000');
    for (const amountCents of [0, -1, 1.5, '1000', 100001]) {
      const response = await createOrder(harness.port, user.cookie, {
        amountCents,
        clientRequestId: '33333333-3333-4333-8333-333333333333',
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error.code, 'INVALID_PAYMENT_AMOUNT');
    }
    const created = await createOrder(harness.port, user.cookie, {
      clientRequestId: '44444444-4444-4444-8444-444444444444',
    });
    const completion = await requestJson(harness.port, {
      method: 'POST',
      path: `/api/payment-orders/${created.body.order.id}/mock-complete`,
      cookie: user.cookie,
    });
    assert.equal(completion.statusCode, 403);
    assert.equal(
      completion.body.error.code,
      'PAYMENT_MOCK_CONFIRMATION_DISABLED'
    );
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      1250
    );
  } finally {
    await harness.close();
  }
});
