'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UI_PATH = path.join(
  PROJECT_ROOT,
  'ui_prototypes',
  'yuhuang_mobile_v1',
  'ui.js'
);
const HTML_PATH = path.join(
  PROJECT_ROOT,
  'ui_prototypes',
  'yuhuang_mobile_v1',
  'home.html'
);
const FORTUNE_HTML_PATH = path.join(
  PROJECT_ROOT,
  'ui_prototypes',
  'yuhuang_mobile_v1',
  'fortune.html'
);

test('mobile recharge source uses an order and verified-result flow', () => {
  const source = fs.readFileSync(UI_PATH, 'utf8');
  assert.match(source, /const PAYMENT_ORDERS_API_URL = '\/api\/payment-orders'/);
  assert.doesNotMatch(source, /\/api\/dev\/recharge/);
  assert.match(source, /clientRequestId: activeClientRequestId/);
  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /crypto\.getRandomValues/);
  assert.match(source, /\/mock-complete`/);
  assert.match(source, /fetchPaymentOrder\(currentPaymentOrder\.id\)/);
  assert.match(source, /AbortController/);
  assert.match(source, /beforeunload/);
  assert.match(source, /PAYMENT_POLL_TIMEOUT_MS/);
  assert.match(source, /window\.sessionStorage/);
  assert.doesNotMatch(
    source,
    /localStorage\.(?:setItem|getItem)\(PAYMENT_ORDER_STORAGE_KEY/
  );
  for (const state of [
    'idle',
    'creating-order',
    'awaiting-payment',
    'confirming-payment',
    'verifying-payment',
    'credited',
    'payment-error',
  ]) {
    assert.match(source, new RegExp(state));
  }
});

test('payment panels start neutral and defer mode copy to capabilities', () => {
  const source = fs.readFileSync(UI_PATH, 'utf8');
  for (const htmlPath of [HTML_PATH, FORTUNE_HTML_PATH]) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.doesNotMatch(html, /模拟支付|界面演示|开发态模拟|测试支付/);
    assert.match(html, /data-payment-panel-copy>充值服务暂未开放/);
    assert.match(html, /data-payment-mode-notice hidden/);
    assert.match(html, /data-payment-method="wechat"[^>]*hidden/);
    assert.match(html, /data-payment-method="alipay"[^>]*hidden/);
    assert.match(html, /创建支付订单/);
    assert.match(html, /data-payment-order-amount/);
    assert.match(html, /data-payment-order-provider/);
  }
  assert.match(source, /模拟支付，不会产生真实扣款/);
  assert.match(source, /支付完成后，话费将自动到账/);
  assert.match(source, /支付结果以到账状态为准/);
});
