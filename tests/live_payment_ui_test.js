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
const ALIPAY_WAP_ACTION = `${ALIPAY_GATEWAY}?charset=utf-8`;

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
    applyPaymentCapabilities,
    getAccountBalanceCents: () => accountBalanceCents,
    getPaymentCapabilities: () => ({
      canRecharge,
      paymentMode,
      paymentProviders,
      publicPaymentEntryEnabled,
    }),
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
  const paymentCopyElements = {
    '#recharge-panel-title': new FakeElement('h2', eventLog),
    '[data-payment-panel-copy]': new FakeElement('p', eventLog),
    '#payment-methods-title': new FakeElement('h3', eventLog),
    '[data-payment-mode-notice]': new FakeElement('p', eventLog),
  };
  const document = {
    body,
    addEventListener() {},
    createElement(tagName) {
      const element = new FakeElement(tagName, eventLog);
      createdElements.push(element);
      return element;
    },
    querySelector(selector) {
      return paymentCopyElements[selector] || null;
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
    paymentCopyElements,
    storage,
    window,
  };
}

test('runtime capabilities keep disabled, mock, and Alipay copy distinct', () => {
  const cases = [
    {
      name: 'disabled',
      permissions: {
        canRecharge: false,
        paymentMode: 'disabled',
        paymentProviders: { alipay: false, wechat: false },
        publicPaymentEntryEnabled: false,
      },
      expected: ['话费充值', '充值服务暂未开放', '选择支付方式', '', true],
    },
    {
      name: 'alipay-private',
      permissions: {
        canRecharge: false,
        paymentMode: 'alipay',
        paymentProviders: { alipay: false, wechat: false },
        publicPaymentEntryEnabled: false,
      },
      expected: ['话费充值', '充值服务暂未开放', '选择支付方式', '', true],
    },
    {
      name: 'mock',
      permissions: {
        canRecharge: true,
        paymentMode: 'mock',
        paymentProviders: { alipay: true, wechat: true },
        publicPaymentEntryEnabled: true,
      },
      expected: [
        '开发演示充值',
        '仅用于模拟支付，不会产生真实扣款',
        '选择模拟支付方式',
        '模拟支付，不会产生真实扣款',
        false,
      ],
    },
    {
      name: 'alipay-public',
      permissions: {
        canRecharge: true,
        paymentMode: 'alipay',
        paymentProviders: { alipay: true, wechat: false },
        publicPaymentEntryEnabled: true,
      },
      expected: [
        '话费充值',
        '支付完成后，话费将自动到账',
        '选择支付方式',
        '请确认金额后安全支付，支付结果以到账状态为准',
        false,
      ],
    },
  ];
  for (const testCase of cases) {
    const runtime = loadRuntime();
    runtime.api.applyPaymentCapabilities(testCase.permissions);
    const elements = runtime.paymentCopyElements;
    const actual = [
      elements['#recharge-panel-title'].textContent,
      elements['[data-payment-panel-copy]'].textContent,
      elements['#payment-methods-title'].textContent,
      elements['[data-payment-mode-notice]'].textContent,
      elements['[data-payment-mode-notice]'].hidden,
    ];
    assert.deepEqual(actual, testCase.expected, testCase.name);
    if (testCase.name === 'alipay-public') {
      assert.doesNotMatch(actual.join(' '), /模拟|界面演示|测试支付/);
    }
  }
});

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
    action: ALIPAY_WAP_ACTION,
    method: 'POST',
    fields: {
      app_id: '0000000000000000',
      method: 'alipay.trade.wap.pay',
      format: 'JSON',
      sign_type: 'RSA2',
      timestamp: '2026-08-08 13:00:00',
      version: '1.0',
      notify_url: 'https://merchant.example/api/payment-notifications/alipay',
      return_url: 'https://merchant.example/payment-return',
      biz_content: '{"out_trade_no":"MO_TEST"}',
      sign: 'base64-signature',
    },
  };
}

test('production Alipay checkout with charset query parses successfully', () => {
  const runtime = loadRuntime();
  const checkout = runtime.api.parsePaymentCheckout(validAlipayCheckout());
  assert.ok(checkout);
  assert.equal(checkout.kind, 'alipay_wap');
  assert.equal(checkout.action, ALIPAY_WAP_ACTION);
});

test('Alipay checkout rejects every unsafe gateway action', () => {
  const runtime = loadRuntime();
  for (const action of [
    'not-a-url',
    'http://openapi.alipay.com/gateway.do?charset=utf-8',
    ALIPAY_GATEWAY,
    `${ALIPAY_GATEWAY}?charset=gbk`,
    `${ALIPAY_WAP_ACTION}&foo=bar`,
    `${ALIPAY_WAP_ACTION}&charset=utf-8`,
    'https://evil.example/gateway.do?charset=utf-8',
    'https://openapi.alipay.com.evil.example/gateway.do?charset=utf-8',
    'https://openapi.alipay.com:444/gateway.do?charset=utf-8',
    'https://openapi.alipay.com/other?charset=utf-8',
    'https://user:password@openapi.alipay.com/gateway.do?charset=utf-8',
    `${ALIPAY_WAP_ACTION}#payment`,
  ]) {
    assert.equal(runtime.api.parsePaymentCheckout({
      ...validAlipayCheckout(),
      action,
    }), null, action);
  }
});

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
  assert.equal(form.action, ALIPAY_WAP_ACTION);
  assert.equal(form.submitted, true);
  assert.equal(
    form.children.length,
    Object.keys(validAlipayCheckout().fields).length
  );
  assert.equal(
    form.children.find((input) => input.name === 'method').value,
    'alipay.trade.wap.pay'
  );
  assert.equal(
    form.children.some((input) => input.name === 'charset'),
    false
  );
  assert.deepEqual(
    form.children.map((input) => input.name).sort(),
    [
      'app_id',
      'biz_content',
      'format',
      'method',
      'notify_url',
      'return_url',
      'sign',
      'sign_type',
      'timestamp',
      'version',
    ]
  );
});
