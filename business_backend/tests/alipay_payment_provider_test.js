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
    assert.equal(checkout.action, platform.gatewayUrl);
    assert.equal(checkout.fields.method, 'alipay.trade.wap.pay');
    assert.equal(checkout.fields.sign_type, 'RSA2');
    assert.equal(
      verifyRsaSha256(
        canonicalizeAlipayParameters(checkout.fields),
        checkout.fields.sign,
        keys.alipayApp.publicKey
      ),
      true
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
