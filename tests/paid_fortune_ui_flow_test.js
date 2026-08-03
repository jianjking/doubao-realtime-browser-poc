'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(PROJECT_ROOT, 'ui_prototypes/yuhuang_mobile_v1/fortune.html'),
  'utf8'
);
const js = fs.readFileSync(
  path.join(PROJECT_ROOT, 'ui_prototypes/yuhuang_mobile_v1/fortune.js'),
  'utf8'
);

test('paid Fortune page renders server price, balance, login, and recharge guidance', () => {
  assert.match(html, /本次求签[^<]*<strong data-fortune-price>/);
  assert.match(html, /仅在成功抽到签文后扣费/);
  assert.match(html, /当前话费[^<]*<strong data-fortune-balance>/);
  assert.match(html, /请先登录后求签/);
  assert.match(html, /data-fortune-recharge[^>]*>话费充值/);
  assert.match(html, /data-fortune-charge-success/);
  assert.match(js, /const FORTUNE_CONFIG_API_URL = '\/api\/fortune-config'/);
  assert.match(js, /const ACCOUNT_API_URL = '\/api\/me'/);
  assert.match(js, /INSUFFICIENT_ACCOUNT_BALANCE/);
  assert.match(js, /还差 \$\{formatCny\(drawPriceCents - accountBalanceCents\)\}/);
  assert.doesNotMatch(js, /drawPriceCents\s*=\s*200/);
});

test('one secure client request ID is retained across automatic draw retries', () => {
  assert.match(js, /window\.crypto[\s\S]*?randomUUID/);
  assert.match(js, /window\.crypto[\s\S]*?getRandomValues/);
  assert.match(js, /activeFortuneClientRequestId === ''/);
  assert.match(js, /clientRequestId:\s*activeFortuneClientRequestId/);
  assert.match(
    js,
    /interactionState === INTERACTION_STATES\.INSUFFICIENT_BALANCE[\s\S]*?void handleFortuneDraw\(\)/
  );
  assert.doesNotMatch(js, /clientRequestId:\s*Date\.now/);
  assert.doesNotMatch(js, /priceCents:\s*drawPriceCents/);
  assert.doesNotMatch(js, /lotId:\s*/);
});

test('paid result refresh uses the server-owned session and never stores balance locally', () => {
  assert.match(js, /fortuneSessionId/);
  assert.match(
    js,
    /fortuneService|getPaidFortuneSession|restorePaidFortuneFromUrl/
  );
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/);
  assert.match(js, /void refreshFortuneAccount\(\)/);
});
