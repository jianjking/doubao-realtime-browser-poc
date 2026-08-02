'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const UI_PATH = path.resolve(
  __dirname,
  '../ui_prototypes/yuhuang_mobile_v1/ui.js'
);
const PAYMENT_STORAGE_KEY = 'companion_pending_payment_order_v1';
const ALIPAY_GATEWAY = 'https://openapi.alipay.com/gateway.do';

class FakeElement {
  constructor(tagName = 'div', eventLog = []) {
    this.children = [];
    this.eventLog = eventLog;
    this.hidden = false;
    this.method = '';
    this.action = '';
    this.name = '';
    this.type = '';
    this.value = '';
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set innerHTML(_) {
    throw new Error('live checkout must not use innerHTML');
  }

  submit() {
    this.eventLog.push('form-submit');
    this.submitted = true;
  }
}

function loadRuntime({
  immediateTimeout = false,
  userAgent = 'Offline browser',
} = {}) {
  let source = fs.readFileSync(UI_PATH, 'utf8');
  const replacement = `
  globalThis.__livePaymentUiTest = {
    getAccountBalanceCents: () => accountBalanceCents,
    getPaymentUiState: () => paymentUiState,
    launchAlipayWap,
    launchLiveCheckout,
    launchWechatH5,
    launchWechatJsapi,
    parsePaymentCheckout,
  };`;
  assert.ok(source.includes('  initializeUi();'));
  source = source.replace('  initializeUi();', replacement);

  const eventLog = [];
  const createdElements = [];
  const body = new FakeElement('body', eventLog);
  body.dataset = {};
  const document = {
    body,
    addEventListener() {},
    createElement(tagName) {
      const element = new FakeElement(tagName, eventLog);
      createdElements.push(element);
      return element;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const storage = new Map();
  const locationAssignments = [];
  const window = {
    addEventListener() {},
    clearTimeout,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    location: {
      assign(value) {
        eventLog.push('location-assign');
        locationAssignments.push(value);
      },
      href: 'https://merchant.example/home',
      origin: 'https://merchant.example',
    },
    navigator: { userAgent },
    sessionStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      removeItem(key) {
        storage.delete(key);
      },
      setItem(key, value) {
        eventLog.push('session-store');
        storage.set(key, String(value));
      },
    },
    setTimeout(callback, milliseconds) {
      if (immediateTimeout) {
        callback();
        return 1;
      }
      return setTimeout(callback, milliseconds);
    },
  };
  const context = {
    AbortController,
    Element: FakeElement,
    Image: class {},
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    document,
    globalThis: null,
    setTimeout,
    window,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: UI_PATH });
  return {
    api: context.__livePaymentUiTest,
    body,
    createdElements,
    eventLog,
    locationAssignments,
    storage,
    window,
  };
}

function validJsapiCheckout() {
  return {
    kind: 'wechat_jsapi',
    payload: {
      appId: 'wxTESTAPPID001',
      timeStamp: '1785657600',
      nonceStr: 'nonce_123',
      package: 'prepay_id=prepay_test_123',
      signType: 'RSA',
      paySign: 'base64-signature',
    },
  };
}

function validAlipayCheckout() {
  return {
    kind: 'alipay_wap',
    action: ALIPAY_GATEWAY,
    method: 'POST',
    fields: {
      app_id: '0000000000000000',
      method: 'alipay.trade.wap.pay',
      sign_type: 'RSA2',
      sign: 'base64-signature',
      biz_content: '{"out_trade_no":"MO_TEST"}',
    },
  };
}

test('checkout parser accepts only bounded provider-specific structures', () => {
  const runtime = loadRuntime();
  assert.equal(runtime.api.parsePaymentCheckout(validJsapiCheckout()).kind,
    'wechat_jsapi');
  assert.equal(runtime.api.parsePaymentCheckout({
    ...validJsapiCheckout(),
    payload: { ...validJsapiCheckout().payload, signType: 'MD5' },
  }), null);

  const h5 = runtime.api.parsePaymentCheckout({
    kind: 'wechat_h5',
    h5Url: 'https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=one',
  });
  assert.equal(h5.kind, 'wechat_h5');
  for (const unsafeUrl of [
    'http://wx.tenpay.com/pay',
    'https://wx.tenpay.com:444/pay',
    'https://wx.tenpay.com.evil.example/pay',
    'https://user:password@wx.tenpay.com/pay',
  ]) {
    assert.equal(runtime.api.parsePaymentCheckout({
      kind: 'wechat_h5',
      h5Url: unsafeUrl,
    }), null);
  }

  assert.equal(runtime.api.parsePaymentCheckout(validAlipayCheckout()).kind,
    'alipay_wap');
  assert.equal(runtime.api.parsePaymentCheckout({
    ...validAlipayCheckout(),
    action: 'https://evil.example/gateway.do',
  }), null);
  assert.equal(runtime.api.parsePaymentCheckout({
    ...validAlipayCheckout(),
    fields: { ...validAlipayCheckout().fields, 'bad-name': 'value' },
  }), null);
});

test('every WeixinJSBridge callback verifies server state without credit', async () => {
  for (const errMsg of [
    'get_brand_wcpay_request:ok',
    'get_brand_wcpay_request:cancel',
  ]) {
    const runtime = loadRuntime({ userAgent: 'MicroMessenger/8.0.50' });
    let invokedMethod = '';
    let invokedPayload = null;
    runtime.window.WeixinJSBridge = {
      invoke(method, payload, callback) {
        invokedMethod = method;
        invokedPayload = payload;
        callback({ err_msg: errMsg });
      },
    };
    const checkout = runtime.api.parsePaymentCheckout(validJsapiCheckout());
    await runtime.api.launchWechatJsapi(checkout);
    assert.equal(invokedMethod, 'getBrandWCPayRequest');
    assert.equal(invokedPayload.package, 'prepay_id=prepay_test_123');
    assert.equal(runtime.api.getPaymentUiState(), 'verifying-payment');
    assert.equal(runtime.api.getAccountBalanceCents(), null);
  }
});

test('missing WeixinJSBridge fails with a readable recovery prompt', async () => {
  const runtime = loadRuntime({
    immediateTimeout: true,
    userAgent: 'MicroMessenger/8.0.50',
  });
  const checkout = runtime.api.parsePaymentCheckout(validJsapiCheckout());
  await assert.rejects(
    runtime.api.launchWechatJsapi(checkout),
    /请在微信中刷新页面后重试支付/
  );
});

test('WeChat H5 and Alipay WAP persist the order before leaving the page', () => {
  const h5Runtime = loadRuntime();
  const h5Checkout = h5Runtime.api.parsePaymentCheckout({
    kind: 'wechat_h5',
    h5Url: 'https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=two',
  });
  h5Runtime.api.launchWechatH5(h5Checkout, { id: 'pay_h5_test' });
  assert.deepEqual(h5Runtime.eventLog, ['session-store', 'location-assign']);
  assert.equal(
    h5Runtime.storage.get(PAYMENT_STORAGE_KEY),
    'pay_h5_test'
  );
  assert.equal(h5Runtime.locationAssignments.length, 1);

  const alipayRuntime = loadRuntime();
  const alipayCheckout = alipayRuntime.api.parsePaymentCheckout(
    validAlipayCheckout()
  );
  alipayRuntime.api.launchAlipayWap(
    alipayCheckout,
    { id: 'pay_alipay_test' }
  );
  assert.deepEqual(alipayRuntime.eventLog, ['session-store', 'form-submit']);
  assert.equal(
    alipayRuntime.storage.get(PAYMENT_STORAGE_KEY),
    'pay_alipay_test'
  );
  const form = alipayRuntime.body.children[0];
  assert.equal(form.tagName, 'FORM');
  assert.equal(form.method, 'POST');
  assert.equal(form.action, ALIPAY_GATEWAY);
  assert.equal(form.submitted, true);
  assert.equal(
    form.children.length,
    Object.keys(validAlipayCheckout().fields).length
  );
  assert.equal(
    form.children.find((input) => input.name === 'method').value,
    'alipay.trade.wap.pay'
  );
});
