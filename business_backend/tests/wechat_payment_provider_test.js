'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPaymentHttpTransport,
} = require('../payments/payment_http_transport');
const {
  WeChatPaymentProvider,
  isDefaultSafeWechatH5Url,
} = require('../payments/wechat_payment_provider');
const {
  buildWechatResponseMessage,
  verifyRsaSha256,
} = require('../payments/wechat_pay_crypto');
const {
  createTemporaryPaymentKeys,
  createTestWechatConfig,
  startFakePaymentPlatform,
} = require('./payment_live_test_helpers');

function createOrder(overrides = {}) {
  return {
    id: 'pay_test_wechat',
    provider: 'wechat',
    requestedScene: 'wechat_h5',
    merchantOrderNo: 'MO_WECHAT_TEST',
    amountCents: 1000,
    currency: 'CNY',
    status: 'pending',
    expiresAt: '2026-08-02T09:00:00.000Z',
    ...overrides,
  };
}

test('WeChat Provider performs offline JSAPI and H5 contracts', async () => {
  const keys = createTemporaryPaymentKeys();
  const platform = await startFakePaymentPlatform(keys);
  try {
    const provider = new WeChatPaymentProvider({
      config: createTestWechatConfig(keys),
      apiBaseUrl: platform.origin,
      allowTestUrls: true,
      transport: createPaymentHttpTransport({
        allowedOrigins: [platform.origin],
      }),
      h5UrlValidator: isDefaultSafeWechatH5Url,
    });
    const jsapiOrder = createOrder({
      requestedScene: 'wechat_jsapi',
      merchantOrderNo: 'MO_WECHAT_JSAPI',
    });
    await assert.rejects(
      provider.createCheckout(jsapiOrder, {
        userAgent: 'MicroMessenger',
      }),
      (error) => error && error.code === 'WECHAT_OPENID_REQUIRED'
    );
    assert.equal(platform.requests.length, 0);

    const jsapiCheckout = await provider.createCheckout(jsapiOrder, {
      userAgent: 'MicroMessenger',
      wechatOpenId: 'openid_server_verified',
    });
    assert.equal(jsapiCheckout.kind, 'wechat_jsapi');
    assert.equal(jsapiCheckout.payload.signType, 'RSA');
    assert.match(jsapiCheckout.payload.package, /^prepay_id=/);
    const jsapiMessage = `${jsapiCheckout.payload.appId}\n`
      + `${jsapiCheckout.payload.timeStamp}\n`
      + `${jsapiCheckout.payload.nonceStr}\n`
      + `${jsapiCheckout.payload.package}\n`;
    assert.equal(
      verifyRsaSha256(
        jsapiMessage,
        jsapiCheckout.payload.paySign,
        keys.wechatMerchant.publicKey
      ),
      true
    );

    const h5Order = createOrder();
    const h5Checkout = await provider.createCheckout(h5Order, {
      payerClientIp: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Linux; Android 15) Mobile',
    });
    assert.equal(h5Checkout.kind, 'wechat_h5');
    assert.equal(new URL(h5Checkout.h5Url).hostname, 'wx.tenpay.com');
    assert.equal(
      new URL(h5Checkout.h5Url).searchParams.get('redirect_url'),
      'https://merchant.example/payment-return'
    );
    const h5Request = platform.requests.find(
      (request) => request.path === '/v3/pay/transactions/h5'
    );
    const h5Body = JSON.parse(h5Request.body);
    assert.equal(h5Body.amount.total, 1000);
    assert.equal(h5Body.scene_info.payer_client_ip, '127.0.0.1');
    assert.equal(h5Body.scene_info.h5_info.type, 'Android');
    assert.equal(isDefaultSafeWechatH5Url('javascript:alert(1)'), false);
    assert.equal(isDefaultSafeWechatH5Url('http://wx.tenpay.com/x'), false);
    assert.equal(
      isDefaultSafeWechatH5Url('https://wx.tenpay.com:444/x'),
      false
    );
    assert.equal(isDefaultSafeWechatH5Url('https://evil.example/x'), false);

    const successTrade = platform.wechatTrades.get(h5Order.merchantOrderNo);
    successTrade.trade_state = 'SUCCESS';
    const query = await provider.queryPayment(h5Order);
    assert.equal(query.status, 'succeeded');
    assert.equal(query.verifiedEvent.amountCents, 1000);
    assert.equal(query.verifiedEvent.requestedScene, 'wechat_h5');

    const closeOrder = createOrder({ merchantOrderNo: 'MO_WECHAT_CLOSE' });
    await provider.createCheckout(closeOrder, {
      payerClientIp: '127.0.0.1',
      userAgent: 'Mobile Safari',
    });
    const closed = await provider.closePayment(closeOrder);
    assert.equal(closed.closed, true);
    assert.equal(
      platform.wechatTrades.get(closeOrder.merchantOrderNo).trade_state,
      'CLOSED'
    );
    assert.equal(
      platform.requests.every((request) => request.path.startsWith('/v3/')),
      true
    );
  } finally {
    await platform.close();
    keys.cleanup();
  }
});

test('WeChat response signature helper uses the exact raw body', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const raw = '{"code":"SUCCESS"}';
    const message = buildWechatResponseMessage('1785657600', 'nonce', raw);
    const signature = require('../payments/wechat_pay_crypto')
      .signRsaSha256(message, keys.wechatPlatform.privateKey);
    assert.equal(
      verifyRsaSha256(message, signature, keys.wechatPlatform.publicKey),
      true
    );
    assert.equal(
      verifyRsaSha256(`${message} `, signature, keys.wechatPlatform.publicKey),
      false
    );
  } finally {
    keys.cleanup();
  }
});
