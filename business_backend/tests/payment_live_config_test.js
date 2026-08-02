'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  ALIPAY_GATEWAY_URL,
  parsePaymentRuntimeConfig,
} = require('../config/payments');
const {
  createTemporaryPaymentKeys,
} = require('./payment_live_test_helpers');

function createValidEnvironment(keys) {
  return {
    NODE_ENV: 'test',
    PAYMENT_PROVIDER_MODE: 'live',
    PAYMENT_MOCK_CONFIRMATION_ENABLED: '0',
    WECHAT_PAY_ENABLED: '1',
    WECHAT_PAY_MCH_ID: '0000000000',
    WECHAT_PAY_APP_ID: 'wxTESTAPPID001',
    WECHAT_PAY_API_V3_KEY: crypto.randomBytes(16).toString('hex'),
    WECHAT_PAY_MERCHANT_SERIAL_NO: 'ABCDEF1234567890',
    WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH:
      keys.paths.wechatMerchantPrivate,
    WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST_WECHAT',
    WECHAT_PAY_PUBLIC_KEY_PATH: keys.paths.wechatPlatformPublic,
    WECHAT_PAY_NOTIFY_URL:
      'https://merchant.example/api/payment-notifications/wechat',
    WECHAT_PAY_H5_RETURN_URL:
      'https://merchant.example/payment-return',
    ALIPAY_ENABLED: '1',
    ALIPAY_APP_ID: '0000000000000000',
    ALIPAY_APP_PRIVATE_KEY_PATH: keys.paths.alipayAppPrivate,
    ALIPAY_PUBLIC_KEY_PATH: keys.paths.alipayPlatformPublic,
    ALIPAY_NOTIFY_URL:
      'https://merchant.example/api/payment-notifications/alipay',
    ALIPAY_RETURN_URL: 'https://merchant.example/payment-return',
    ALIPAY_SELLER_ID: '0000000000000000',
    ALIPAY_GATEWAY_URL,
  };
}

test('live configuration loads valid RSA keys and HTTPS channel settings', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const config = parsePaymentRuntimeConfig(createValidEnvironment(keys));
    assert.equal(config.mode, 'live');
    assert.equal(config.mockConfirmationEnabled, false);
    assert.equal(config.wechat.configured, true);
    assert.equal(config.wechat.apiV3Key.length, 32);
    assert.equal(config.wechat.merchantPrivateKey.type, 'private');
    assert.equal(config.wechat.platformPublicKey.type, 'public');
    assert.equal(config.alipay.configured, true);
    assert.equal(config.alipay.appPrivateKey.type, 'private');
    assert.equal(config.alipay.platformPublicKey.type, 'public');
    assert.equal(config.alipay.gatewayUrl, ALIPAY_GATEWAY_URL);
  } finally {
    keys.cleanup();
  }
});

test('enabled but incomplete live channel stays explicitly unconfigured', () => {
  const config = parsePaymentRuntimeConfig({
    PAYMENT_PROVIDER_MODE: 'live',
    WECHAT_PAY_ENABLED: '1',
    ALIPAY_ENABLED: '1',
  });
  assert.deepEqual(config.wechat, { configured: false, enabled: true });
  assert.deepEqual(config.alipay, { configured: false, enabled: true });
});

test('live configuration rejects unsafe secrets, URLs, gateway, and flags', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const valid = createValidEnvironment(keys);
    for (const [name, value, expected] of [
      ['WECHAT_PAY_ENABLED', 'yes', /must be 0 or 1/],
      ['WECHAT_PAY_API_V3_KEY', 'too-short', /exactly 32 bytes/],
      ['WECHAT_PAY_NOTIFY_URL', 'http://merchant.example/notify', /HTTPS URL/],
      ['WECHAT_PAY_NOTIFY_URL', 'https://merchant.example/notify?token=x', /HTTPS URL/],
      ['ALIPAY_RETURN_URL', 'javascript:alert(1)', /HTTPS URL/],
      ['ALIPAY_GATEWAY_URL', 'https://evil.example/gateway.do', /official Alipay gateway/],
      ['WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH', keys.paths.wechatPlatformPublic, /valid RSA private key/],
      ['ALIPAY_PUBLIC_KEY_PATH', keys.paths.alipayAppPrivate, /valid RSA public key/],
    ]) {
      assert.throws(
        () => parsePaymentRuntimeConfig({ ...valid, [name]: value }),
        expected,
        name
      );
    }
  } finally {
    keys.cleanup();
  }
});
