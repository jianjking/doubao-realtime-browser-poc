'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  alipayAmountToCents,
  alipayDateTimeToIso,
  canonicalizeAlipayParameters,
  centsToAlipayAmount,
  createSignedAlipayParameters,
  parseAlipayFormBodyStrict,
  verifyAlipayNotificationParameters,
} = require('../payments/alipay_crypto');
const {
  createTemporaryPaymentKeys,
} = require('./payment_live_test_helpers');

test('Alipay amount conversion is exact and rejects unsafe decimal input', () => {
  assert.equal(centsToAlipayAmount(1), '0.01');
  assert.equal(centsToAlipayAmount(1000), '10.00');
  assert.equal(centsToAlipayAmount(100000), '1000.00');
  assert.equal(alipayAmountToCents('0.01'), 1);
  assert.equal(alipayAmountToCents('1000.00'), 100000);
  for (const invalid of [
    '',
    '-1.00',
    '1',
    '1.0',
    '1.001',
    '1e2',
    '01.00',
    String(Number.MAX_SAFE_INTEGER),
  ]) {
    assert.throws(() => alipayAmountToCents(invalid));
  }
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => centsToAlipayAmount(invalid));
  }
});

test('Alipay RSA2 signatures are canonical and parameter changes fail', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const parameters = {
      sign_type: 'RSA2',
      charset: 'utf-8',
      app_id: '0000000000000000',
      method: 'alipay.trade.wap.pay',
      biz_content: '{"total_amount":"10.00"}',
    };
    const signed = createSignedAlipayParameters(
      parameters,
      keys.alipayApp.privateKey
    );
    const notificationShape = {
      ...signed,
      sign: createSignedAlipayParameters(
        Object.fromEntries(
          Object.entries(parameters).filter(([key]) => key !== 'sign_type')
        ),
        keys.alipayApp.privateKey
      ).sign,
    };
    assert.equal(
      canonicalizeAlipayParameters(parameters),
      'app_id=0000000000000000&biz_content={"total_amount":"10.00"}'
        + '&charset=utf-8&method=alipay.trade.wap.pay&sign_type=RSA2'
    );
    assert.equal(
      verifyAlipayNotificationParameters(
        notificationShape,
        keys.alipayApp.publicKey
      ),
      true
    );
    assert.equal(
      verifyAlipayNotificationParameters(
        { ...notificationShape, app_id: '0000000000000001' },
        keys.alipayApp.publicKey
      ),
      false
    );
  } finally {
    keys.cleanup();
  }
});

test('Alipay form parser decodes once and rejects duplicate keys', () => {
  assert.deepEqual(
    { ...parseAlipayFormBodyStrict(Buffer.from('a=1%202&b=x%2By')) },
    { a: '1 2', b: 'x+y' }
  );
  assert.throws(
    () => parseAlipayFormBodyStrict(Buffer.from('a=1&a=2')),
    (error) => error && error.code === 'PAYMENT_NOTIFICATION_INVALID'
  );
  assert.throws(
    () => parseAlipayFormBodyStrict(Buffer.from('a=%ZZ')),
    (error) => error && error.code === 'PAYMENT_NOTIFICATION_INVALID'
  );
});

test('Alipay Shanghai timestamps reject calendar normalization', () => {
  assert.equal(
    alipayDateTimeToIso('2026-08-02 16:00:00'),
    '2026-08-02T08:00:00.000Z'
  );
  for (const invalid of [
    '2026-02-30 12:00:00',
    '2026-13-01 00:00:00',
    '2026-01-01 24:00:00',
  ]) {
    assert.throws(
      () => alipayDateTimeToIso(invalid),
      (error) => error && error.code === 'PAYMENT_NOTIFICATION_INVALID'
    );
  }
});
