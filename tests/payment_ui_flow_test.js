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

test('mobile payment copy is explicit and contains a separate confirmation', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /模拟支付，不会产生真实扣款/);
  assert.match(html, /创建支付订单/);
  assert.match(html, /模拟完成支付/);
  assert.match(html, /data-payment-order-amount/);
  assert.match(html, /data-payment-order-provider/);
  assert.match(html, /data-payment-method="wechat"/);
  assert.match(html, /data-payment-method="alipay"/);
});
