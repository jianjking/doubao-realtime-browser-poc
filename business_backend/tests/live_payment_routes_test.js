'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { AlipayPaymentProvider } = require('../payments/alipay_payment_provider');
const {
  createPaymentProviderRegistry,
} = require('../payments/payment_provider_registry');
const { WeChatPaymentProvider } = require('../payments/wechat_payment_provider');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');
const {
  createAlipayNotification,
  createTemporaryPaymentKeys,
  createTestAlipayConfig,
  createTestWechatConfig,
  createWechatNotification,
  startFakePaymentPlatform,
} = require('./payment_live_test_helpers');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

function request(port, {
  method = 'GET',
  path,
  cookie = '',
  body,
  contentType,
  headers = {},
} = {}) {
  const payload = body === undefined
    ? null
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(String(body), 'utf8');
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        Accept: 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(payload === null ? {} : { 'Content-Length': payload.length }),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(rawBody);
        } catch {
          // Provider acknowledgements intentionally use plain text.
        }
        resolve({
          body: json,
          headers: response.headers,
          rawBody,
          statusCode: response.statusCode,
        });
      });
    });
    outgoing.on('error', reject);
    if (payload !== null) {
      outgoing.write(payload);
    }
    outgoing.end();
  });
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function login(port, phone = '13800000000') {
  const { challengeId } = await requestSmsChallenge(port, phone);
  const response = await request(port, {
    method: 'POST',
    path: '/api/auth/login',
    contentType: 'application/json',
    body: JSON.stringify({ phone, challengeId, code: TEST_SMS_CODE }),
  });
  assert.equal(response.statusCode, 200);
  return {
    cookie: response.headers['set-cookie'][0].split(';', 1)[0],
    userId: response.body.principal.id,
  };
}

async function createOrder(port, cookie, {
  provider,
  amountCents,
  clientRequestId,
  userAgent = 'Offline payment acceptance test',
}) {
  return request(port, {
    method: 'POST',
    path: '/api/payment-orders',
    cookie,
    contentType: 'application/json',
    headers: { 'User-Agent': userAgent },
    body: JSON.stringify({ provider, amountCents, clientRequestId }),
  });
}

async function startLiveHarness(mode = 'live') {
  const keys = createTemporaryPaymentKeys();
  const platform = await startFakePaymentPlatform(keys);
  const stores = createBusinessStores({ databasePath: ':memory:' });
  const wechatProvider = new WeChatPaymentProvider({
    config: createTestWechatConfig(keys),
    apiBaseUrl: platform.origin,
    allowTestUrls: true,
  });
  const alipayProvider = new AlipayPaymentProvider({
    config: createTestAlipayConfig(keys, platform.gatewayUrl),
    gatewayUrl: platform.gatewayUrl,
    allowTestUrls: true,
  });
  const providerRegistry = createPaymentProviderRegistry({
    mode,
    wechatProvider,
    alipayProvider,
    publicEntryEnabled: true,
  });
  const app = createApp({
    businessStores: stores,
    ...createMockSmsTestOptions(),
    paymentProviderRegistry: providerRegistry,
    paymentRuntimeConfig: {
      alipay: { configured: true, enabled: true },
      mode,
      mockConfirmationEnabled: false,
      nodeEnv: 'test',
      publicEntryEnabled: true,
      wechat: { configured: true, enabled: true },
    },
  });
  const server = await listen(app);
  return {
    keys,
    platform,
    port: server.port,
    stores,
    async close() {
      await server.close();
      stores.close();
      await platform.close();
      keys.cleanup();
    },
  };
}

function getStoredOrder(stores, publicOrder) {
  const order = stores.paymentOrderStore.findById(publicOrder.id);
  assert.ok(order);
  return order;
}

test('live callback routes need no session and credit WeChat exactly once', async (t) => {
  const harness = await startLiveHarness();
  try {
    const anonymousOrder = await createOrder(harness.port, '', {
      provider: 'wechat',
      amountCents: 1000,
      clientRequestId: '30000000-0000-4000-8000-000000000001',
    });
    assert.equal(anonymousOrder.statusCode, 401);

    const user = await login(harness.port);
    const created = await createOrder(harness.port, user.cookie, {
      provider: 'wechat',
      amountCents: 1000,
      clientRequestId: '30000000-0000-4000-8000-000000000002',
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.checkout.kind, 'wechat_h5');
    const order = getStoredOrder(harness.stores, created.body.order);
    const notification = createWechatNotification(harness.keys, {
      appid: 'wxTESTAPPID001',
      mchid: '0000000000',
      out_trade_no: order.merchantOrderNo,
      transaction_id: `WX_ROUTE_${order.merchantOrderNo}`,
      trade_state: 'SUCCESS',
      trade_type: 'MWEB',
      amount: { total: 1000, payer_total: 1000, currency: 'CNY' },
      success_time: '2026-08-02T08:00:00.000Z',
    }, { eventId: 'WX_ROUTE_NOTICE_1' });

    const responses = await Promise.all(Array.from({ length: 10 }, () => (
      request(harness.port, {
        method: 'POST',
        path: '/api/payment-notifications/wechat',
        contentType: 'application/json',
        headers: notification.headers,
        body: notification.rawBody,
      })
    )));
    assert.ok(responses.every((response) => response.statusCode === 204));
    const account = harness.stores.accountStore.findByUserId(user.userId);
    assert.equal(account.balanceCents, 2250);
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId(user.userId).length,
      1
    );
    assert.equal(
      harness.stores.paymentNotificationStore
        .findByPaymentOrderId(order.id).length,
      1
    );
    t.diagnostic(`fake platform HTTP requests: ${harness.platform.requests.length}; real-domain requests: 0`);
  } finally {
    await harness.close();
  }
});

test('Alipay raw form callback is strict, unauthenticated, and idempotent', async () => {
  const harness = await startLiveHarness();
  try {
    const user = await login(harness.port);
    const created = await createOrder(harness.port, user.cookie, {
      provider: 'alipay',
      amountCents: 2301,
      clientRequestId: '30000000-0000-4000-8000-000000000003',
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.checkout.kind, 'alipay_wap');
    const order = getStoredOrder(harness.stores, created.body.order);
    const returnVisit = await request(harness.port, {
      method: 'GET',
      path: `/payment-return?out_trade_no=${order.merchantOrderNo}`,
    });
    assert.equal(returnVisit.statusCode, 404);
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      1250
    );
    const notification = createAlipayNotification(harness.keys, {
      out_trade_no: order.merchantOrderNo,
      total_amount: '23.01',
      receipt_amount: '23.01',
      trade_no: `ALI_ROUTE_${order.merchantOrderNo}`,
      notify_id: 'ALI_ROUTE_NOTICE_1',
    });
    const first = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: notification.rawBody,
    });
    const repeated = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: notification.rawBody,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.rawBody, 'success');
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.rawBody, 'success');
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      3551
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId(user.userId).length,
      1
    );
  } finally {
    await harness.close();
  }
});

test('alipay mode exposes only Alipay and never falls back to Mock', async () => {
  const harness = await startLiveHarness('alipay');
  try {
    const user = await login(harness.port);
    const rejectedWechatOrder = await createOrder(harness.port, user.cookie, {
      provider: 'wechat',
      amountCents: 1000,
      clientRequestId: '30000000-0000-4000-8000-000000000008',
    });
    assert.equal(rejectedWechatOrder.statusCode, 503);
    assert.equal(
      rejectedWechatOrder.body.error.code,
      'PAYMENT_PROVIDER_NOT_CONFIGURED'
    );

    const created = await createOrder(harness.port, user.cookie, {
      provider: 'alipay',
      amountCents: 901,
      clientRequestId: '30000000-0000-4000-8000-000000000009',
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.checkout.kind, 'alipay_wap');
    const order = getStoredOrder(harness.stores, created.body.order);
    const notification = createAlipayNotification(harness.keys, {
      out_trade_no: order.merchantOrderNo,
      total_amount: '9.01',
      receipt_amount: '9.01',
      trade_no: `ALI_ONLY_${order.merchantOrderNo}`,
      notify_id: 'ALI_ONLY_NOTICE_1',
    });
    const callback = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: notification.rawBody,
    });
    assert.equal(callback.statusCode, 200);
    assert.equal(callback.rawBody, 'success');
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      2151
    );

    const queryCreated = await createOrder(harness.port, user.cookie, {
      provider: 'alipay',
      amountCents: 333,
      clientRequestId: '30000000-0000-4000-8000-000000000010',
    });
    assert.equal(queryCreated.statusCode, 201);
    const queryOrder = getStoredOrder(harness.stores, queryCreated.body.order);
    harness.platform.alipayTrades.set(queryOrder.merchantOrderNo, {
      code: '10000',
      msg: 'Success',
      out_trade_no: queryOrder.merchantOrderNo,
      trade_no: 'ALI_QUERY_IDEMPOTENT',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '3.33',
      send_pay_date: '2026-08-02 16:00:00',
    });
    for (let index = 0; index < 2; index += 1) {
      const queried = await request(harness.port, {
        method: 'GET',
        path: `/api/payment-orders/${queryOrder.id}`,
        cookie: user.cookie,
      });
      assert.equal(queried.statusCode, 200);
      assert.equal(queried.body.order.status, 'credited');
    }
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      2484
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId(user.userId).length,
      2
    );

    const rejectedWechatCallback = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/wechat',
      contentType: 'application/json',
      body: '{}',
    });
    assert.equal(rejectedWechatCallback.statusCode, 503);
    assert.equal(
      rejectedWechatCallback.body.error.code,
      'PAYMENT_PROVIDER_NOT_CONFIGURED'
    );
  } finally {
    await harness.close();
  }
});

test('callback HTTP boundaries reject wrong media, duplicates, size, and signatures', async () => {
  const harness = await startLiveHarness();
  try {
    const wrongWechatType = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/wechat',
      contentType: 'text/plain',
      body: '{}',
    });
    assert.equal(wrongWechatType.statusCode, 415);

    const wrongAlipayType = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/json',
      body: '{}',
    });
    assert.equal(wrongAlipayType.statusCode, 415);
    assert.equal(wrongAlipayType.rawBody, 'failure');

    const duplicates = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: 'app_id=one&app_id=two',
    });
    assert.equal(duplicates.statusCode, 400);
    assert.equal(duplicates.rawBody, 'failure');

    const badWechatNotification = createWechatNotification(harness.keys, {
      appid: 'wxTESTAPPID001',
      mchid: '0000000000',
      out_trade_no: 'MO_UNKNOWN',
      transaction_id: 'WX_UNKNOWN',
      trade_state: 'SUCCESS',
      trade_type: 'MWEB',
      amount: { total: 1000, payer_total: 1000, currency: 'CNY' },
      success_time: '2026-08-02T08:00:00.000Z',
    });
    badWechatNotification.headers['Wechatpay-Signature'] = 'invalid';
    const rejectedWechat = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/wechat',
      contentType: 'application/json',
      headers: badWechatNotification.headers,
      body: badWechatNotification.rawBody,
    });
    assert.equal(rejectedWechat.statusCode, 400);
    assert.equal(rejectedWechat.body.error.code, 'PAYMENT_SIGNATURE_INVALID');
    assert.equal(JSON.stringify(rejectedWechat.body).includes('stack'), false);

    const badSignature = createAlipayNotification(harness.keys);
    badSignature.rawBody = Buffer.from(
      badSignature.rawBody.toString('utf8').replace(
        /sign=[^&]+/,
        'sign=not-a-valid-signature'
      ),
      'utf8'
    );
    const rejected = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: badSignature.rawBody,
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.rawBody, 'failure');
    assert.equal(rejected.rawBody.includes('stack'), false);

    const tooLargeWechat = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/wechat',
      contentType: 'application/json',
      body: Buffer.alloc(33 * 1024, 0x20),
    });
    assert.equal(tooLargeWechat.statusCode, 413);
    assert.equal(
      tooLargeWechat.body.error.code,
      'PAYMENT_NOTIFICATION_TOO_LARGE'
    );

    const tooLargeAlipay = await request(harness.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: Buffer.alloc(33 * 1024, 0x61),
    });
    assert.equal(tooLargeAlipay.statusCode, 413);
    assert.equal(tooLargeAlipay.rawBody, 'failure');
  } finally {
    await harness.close();
  }
});

test('live close confirms platform state before changing the local order', async () => {
  const harness = await startLiveHarness();
  try {
    const user = await login(harness.port);
    const alipayCreated = await createOrder(harness.port, user.cookie, {
      provider: 'alipay',
      amountCents: 1000,
      clientRequestId: '30000000-0000-4000-8000-000000000006',
    });
    assert.equal(alipayCreated.statusCode, 201);
    const alipayOrder = getStoredOrder(
      harness.stores,
      alipayCreated.body.order
    );
    harness.platform.alipayTrades.set(alipayOrder.merchantOrderNo, {
      code: '10000',
      msg: 'Success',
      out_trade_no: alipayOrder.merchantOrderNo,
      trade_no: 'ALI_PAID_BEFORE_CLOSE',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '10.00',
      send_pay_date: '2026-08-02 16:00:00',
    });
    const paidClose = await request(harness.port, {
      method: 'POST',
      path: `/api/payment-orders/${alipayOrder.id}/close`,
      cookie: user.cookie,
    });
    assert.equal(paidClose.statusCode, 200);
    assert.equal(paidClose.body.credited, true);
    assert.equal(paidClose.body.order.status, 'credited');
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      2250
    );

    const wechatCreated = await createOrder(harness.port, user.cookie, {
      provider: 'wechat',
      amountCents: 500,
      clientRequestId: '30000000-0000-4000-8000-000000000007',
    });
    assert.equal(wechatCreated.statusCode, 201);
    const wechatOrder = getStoredOrder(
      harness.stores,
      wechatCreated.body.order
    );
    const pendingClose = await request(harness.port, {
      method: 'POST',
      path: `/api/payment-orders/${wechatOrder.id}/close`,
      cookie: user.cookie,
    });
    assert.equal(pendingClose.statusCode, 200);
    assert.equal(pendingClose.body.order.status, 'closed');
    assert.equal(
      harness.platform.wechatTrades.get(wechatOrder.merchantOrderNo)
        .trade_state,
      'CLOSED'
    );
    assert.equal(
      harness.stores.accountStore.findByUserId(user.userId).balanceCents,
      2250
    );
  } finally {
    await harness.close();
  }
});

test('live configuration gaps and disabled mode both fail closed', async () => {
  const stores = createBusinessStores({ databasePath: ':memory:' });
  const app = createApp({
    businessStores: stores,
    ...createMockSmsTestOptions(),
    paymentRuntimeConfig: {
      alipay: { configured: false, enabled: false },
      mode: 'live',
      mockConfirmationEnabled: false,
      nodeEnv: 'test',
      wechat: { configured: false, enabled: false },
    },
  });
  const server = await listen(app);
  try {
    const user = await login(server.port);
    const created = await createOrder(server.port, user.cookie, {
      provider: 'alipay',
      amountCents: 1000,
      clientRequestId: '30000000-0000-4000-8000-000000000004',
    });
    assert.equal(created.statusCode, 503);
    assert.equal(created.body.error.code, 'PAYMENT_PROVIDER_NOT_CONFIGURED');

    const callback = await request(server.port, {
      method: 'POST',
      path: '/api/payment-notifications/alipay',
      contentType: 'application/x-www-form-urlencoded',
      body: 'app_id=missing',
    });
    assert.equal(callback.statusCode, 503);
    assert.equal(callback.rawBody, 'failure');
  } finally {
    await server.close();
    stores.close();
  }

  const disabledStores = createBusinessStores({ databasePath: ':memory:' });
  const disabledApp = createApp({
    businessStores: disabledStores,
    ...createMockSmsTestOptions(),
    paymentRuntimeConfig: {
      alipay: { configured: false, enabled: false },
      mode: 'disabled',
      mockConfirmationEnabled: false,
      nodeEnv: 'test',
      wechat: { configured: false, enabled: false },
    },
  });
  const disabledServer = await listen(disabledApp);
  try {
    const user = await login(disabledServer.port, '13900000000');
    const created = await createOrder(disabledServer.port, user.cookie, {
      provider: 'wechat',
      amountCents: 1000,
      clientRequestId: '30000000-0000-4000-8000-000000000005',
    });
    assert.equal(created.statusCode, 503);
    assert.equal(created.body.error.code, 'PAYMENT_PROVIDER_DISABLED');

    const callback = await request(disabledServer.port, {
      method: 'POST',
      path: '/api/payment-notifications/wechat',
      contentType: 'application/json',
      body: '{}',
    });
    assert.equal(callback.statusCode, 503);
    assert.equal(callback.body.error.code, 'PAYMENT_PROVIDER_DISABLED');
  } finally {
    await disabledServer.close();
    disabledStores.close();
  }
});
