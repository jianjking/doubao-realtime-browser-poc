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

test('paid Fortune page keeps pricing and balance details behind user actions', () => {
  assert.doesNotMatch(html, /class="fortune-price-summary"/);
  assert.match(
    html,
    /class="fortune-pricing-trigger"[\s\S]*?aria-controls="fortune-pricing-overlay"/
  );
  assert.match(
    html,
    /class="fortune-pricing-overlay prototype-overlay"[\s\S]*?<h2 id="fortune-pricing-title">价格说明<\/h2>/
  );
  assert.match(html, /data-fortune-price>加载中/);
  assert.match(html, /每次成功抽到签文才扣费/);
  assert.match(html, /没抽到签文不扣费/);
  assert.match(html, /文字解签与道童语音<br>包含在本次费用内/);
  assert.match(html, /重看、重播不重复扣费/);
  assert.doesNotMatch(html, /¥2\.00/);
  assert.match(
    html,
    /class="fortune-insufficient-overlay prototype-overlay"[\s\S]*?<h2 id="fortune-insufficient-title">当前话费不足<\/h2>/
  );
  assert.match(html, /本次求签需要\s*<strong data-fortune-insufficient-price>/);
  assert.match(html, /当前话费\s*<strong data-fortune-balance>/);
  assert.match(html, /充值后可以继续求签，<br>不用重新说一遍心愿/);
  assert.match(html, /data-fortune-insufficient-recharge>话费充值/);
  assert.match(html, /data-close-fortune-insufficient>暂不充值/);
  assert.equal((html.match(/class="recharge-panel prototype-overlay"/g) || []).length, 1);
  assert.match(html, /请先登录后求签/);
  assert.match(html, /data-fortune-recharge[^>]*>话费充值/);
  assert.match(html, /data-fortune-charge-success/);
  assert.match(js, /const FORTUNE_CONFIG_API_URL = '\/api\/fortune-config'/);
  assert.match(js, /const ACCOUNT_API_URL = '\/api\/me'/);
  assert.match(js, /INSUFFICIENT_ACCOUNT_BALANCE/);
  assert.match(js, /fortuneInsufficientOverlay/);
  assert.match(js, /openFortuneRecharge/);
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
