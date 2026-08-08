'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canonicalizeAlipayParameters,
  encodeAlipayForm,
} = require('../payments/alipay_crypto');
const {
  createPaymentHttpTransport,
} = require('../payments/payment_http_transport');
const {
  AlipayPaymentProvider,
} = require('../payments/alipay_payment_provider');
const {
  verifyRsaSha256,
} = require('../payments/wechat_pay_crypto');
const {
  createTemporaryPaymentKeys,
  createTestAlipayConfig,
  startFakePaymentPlatform,
} = require('./payment_live_test_helpers');

function createOrder(overrides = {}) {
  return {
    id: 'pay_test_alipay',
    provider: 'alipay',
    requestedScene: 'alipay_wap',
    merchantOrderNo: 'MO_ALIPAY_TEST',
    amountCents: 725,
    currency: 'CNY',
    status: 'pending',
    expiresAt: '2026-08-02T09:00:00.000Z',
    ...overrides,
  };
}

test('Alipay WAP checkout puts charset on the official gateway URL', async () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const provider = new AlipayPaymentProvider({
      config: createTestAlipayConfig(keys),
    });
    const checkout = await provider.createCheckout(createOrder());
    assert.equal(
      checkout.action,
      'https://openapi.alipay.com/gateway.do?charset=utf-8'
    );
    assert.equal(Object.hasOwn(checkout.fields, 'charset'), false);
  } finally {
    keys.cleanup();
  }
});

test('Alipay Provider creates signed WAP form and uses signed query/close', async () => {
  const keys = createTemporaryPaymentKeys();
  const platform = await startFakePaymentPlatform(keys);
  try {
    const provider = new AlipayPaymentProvider({
      config: createTestAlipayConfig(keys, platform.gatewayUrl),
      gatewayUrl: platform.gatewayUrl,
      allowTestUrls: true,
      transport: createPaymentHttpTransport({
        allowedOrigins: [platform.origin],
      }),
    });
    const order = createOrder();
    const checkout = await provider.createCheckout(order);
    assert.equal(checkout.kind, 'alipay_wap');
    assert.equal(checkout.method, 'POST');
    const checkoutUrl = new URL(checkout.action);
    const gatewayUrl = new URL(platform.gatewayUrl);
    assert.equal(checkoutUrl.origin, gatewayUrl.origin);
    assert.equal(checkoutUrl.pathname, gatewayUrl.pathname);
    assert.equal(checkoutUrl.search, '?charset=utf-8');
    assert.equal(checkoutUrl.searchParams.get('charset'), 'utf-8');
    assert.equal(checkout.fields.method, 'alipay.trade.wap.pay');
    assert.equal(checkout.fields.sign_type, 'RSA2');
    assert.equal(Object.hasOwn(checkout.fields, 'charset'), false);
    for (const key of [
      'app_id',
      'method',
      'format',
      'sign_type',
      'timestamp',
      'version',
      'notify_url',
      'return_url',
      'biz_content',
      'sign',
    ]) {
      assert.equal(Object.hasOwn(checkout.fields, key), true, key);
    }
    const gatewayCanonical = canonicalizeAlipayParameters(checkout.fields, {
      excludeSignType: true,
    });
    assert.equal(
      gatewayCanonical,
      `app_id=${checkout.fields.app_id}`
        + `&biz_content=${checkout.fields.biz_content}`
        + `&format=${checkout.fields.format}`
        + `&method=${checkout.fields.method}`
        + `&notify_url=${checkout.fields.notify_url}`
        + `&return_url=${checkout.fields.return_url}`
        + `&timestamp=${checkout.fields.timestamp}`
        + `&version=${checkout.fields.version}`
    );
    assert.doesNotMatch(gatewayCanonical, /(?:^|&)charset=/);
    assert.doesNotMatch(gatewayCanonical, /(?:^|&)sign_type=/);
    assert.doesNotMatch(gatewayCanonical, /(?:^|&)sign=/);
    assert.doesNotMatch(checkout.fields.biz_content, /%7B/i);
    assert.equal(
      verifyRsaSha256(
        gatewayCanonical,
        checkout.fields.sign,
        keys.alipayApp.publicKey
      ),
      true
    );
    assert.equal(
      verifyRsaSha256(
        canonicalizeAlipayParameters(checkout.fields),
        checkout.fields.sign,
        keys.alipayApp.publicKey
      ),
      false
    );
    assert.equal(
      verifyRsaSha256(
        canonicalizeAlipayParameters({
          ...checkout.fields,
          charset: 'utf-8',
        }, {
          excludeSignType: true,
        }),
        checkout.fields.sign,
        keys.alipayApp.publicKey
      ),
      false
    );
    const bizContent = JSON.parse(checkout.fields.biz_content);
    assert.equal(bizContent.total_amount, '7.25');
    assert.equal(bizContent.out_trade_no, order.merchantOrderNo);
    const wapResponse = await fetch(checkout.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeAlipayForm(checkout.fields),
      redirect: 'manual',
    });
    assert.equal(wapResponse.status, 200);
    const wapRequest = platform.requests.find(
      (request) => request.queryParameters
        && request.formParameters.method === 'alipay.trade.wap.pay'
    );
    assert.ok(wapRequest);
    assert.deepEqual(wapRequest.queryParameters, { charset: 'utf-8' });
    assert.equal(Object.hasOwn(wapRequest.formParameters, 'charset'), false);

    platform.alipayTrades.set(order.merchantOrderNo, {
      code: '10000',
      msg: 'Success',
      out_trade_no: order.merchantOrderNo,
      trade_no: 'ALI_QUERY_SUCCESS',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '7.25',
      send_pay_date: '2026-08-02 16:00:00',
    });
    const queried = await provider.queryPayment(order);
    assert.equal(queried.status, 'succeeded');
    assert.equal(queried.verifiedEvent.amountCents, 725);
    assert.equal(queried.verifiedEvent.providerTradeNo, 'ALI_QUERY_SUCCESS');

    const closeOrder = createOrder({
      merchantOrderNo: 'MO_ALIPAY_CLOSE',
      amountCents: 1000,
    });
    platform.alipayTrades.set(closeOrder.merchantOrderNo, {
      code: '10000',
      msg: 'Success',
      out_trade_no: closeOrder.merchantOrderNo,
      trade_no: 'ALI_CLOSE_PENDING',
      trade_status: 'WAIT_BUYER_PAY',
      total_amount: '10.00',
    });
    const closed = await provider.closePayment(closeOrder);
    assert.equal(closed.closed, true);
    assert.equal(
      platform.alipayTrades.get(closeOrder.merchantOrderNo).trade_status,
      'TRADE_CLOSED'
    );
    assert.equal(
      platform.requests.every((request) => (
        request.path.startsWith('/v3/') || request.path === '/gateway.do'
      )),
      true
    );
  } finally {
    await platform.close();
    keys.cleanup();
  }
});
