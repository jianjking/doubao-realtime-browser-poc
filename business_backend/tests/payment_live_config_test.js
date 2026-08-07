'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ALIPAY_GATEWAY_URL,
  parseHttpsUrl,
  parsePaymentRuntimeConfig,
} = require('../config/payments');
const {
  createConfiguredPaymentProviderRegistry,
} = require('../payments/payment_provider_registry');
const {
  createTemporaryPaymentKeys,
} = require('./payment_live_test_helpers');

function createValidEnvironment(keys) {
  return {
    NODE_ENV: 'test',
    PAYMENT_PROVIDER_MODE: 'live',
    PAYMENT_MOCK_CONFIRMATION_ENABLED: '0',
    PAYMENT_PUBLIC_ENTRY_ENABLED: '1',
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
      'https://merchant.example.com/api/payment-notifications/wechat',
    WECHAT_PAY_H5_RETURN_URL:
      'https://merchant.example.com/payment-return',
    ALIPAY_ENABLED: '1',
    ALIPAY_APP_ID: '0000000000000000',
    ALIPAY_APP_PRIVATE_KEY_PATH: keys.paths.alipayAppPrivate,
    ALIPAY_PUBLIC_KEY_PATH: keys.paths.alipayPlatformPublic,
    ALIPAY_NOTIFY_URL:
      'https://merchant.example.com/api/payment-notifications/alipay',
    ALIPAY_RETURN_URL: 'https://merchant.example.com/payment-return',
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
    assert.equal(config.publicEntryEnabled, true);
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

test('public payment entry defaults closed and rejects invalid flags', () => {
  assert.equal(parsePaymentRuntimeConfig({}).publicEntryEnabled, false);
  for (const value of ['', 'yes', '2', 'true']) {
    assert.throws(
      () => parsePaymentRuntimeConfig({
        PAYMENT_PUBLIC_ENTRY_ENABLED: value,
      }),
      /PAYMENT_PUBLIC_ENTRY_ENABLED must be 0 or 1/
    );
  }
});

test('live configuration rejects unsafe secrets, URLs, gateway, and flags', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const valid = createValidEnvironment(keys);
    for (const [name, value, expected] of [
      ['WECHAT_PAY_ENABLED', 'yes', /must be 0 or 1/],
      ['WECHAT_PAY_API_V3_KEY', 'too-short', /exactly 32 bytes/],
      ['WECHAT_PAY_NOTIFY_URL', 'http://merchant.example.com/notify', /HTTPS URL/],
      ['WECHAT_PAY_NOTIFY_URL', 'https://merchant.example.com/notify?token=x', /HTTPS URL/],
      ['ALIPAY_NOTIFY_URL', 'https://localhost/notify', /HTTPS URL/],
      ['ALIPAY_NOTIFY_URL', 'https://127.0.0.1/notify', /HTTPS URL/],
      ['ALIPAY_RETURN_URL', 'javascript:alert(1)', /HTTPS URL/],
      ['ALIPAY_GATEWAY_URL', 'https://evil.example/gateway.do', /official Alipay gateway/],
      ['WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH', keys.paths.wechatPlatformPublic, /valid RSA private key/],
      ['ALIPAY_APP_PRIVATE_KEY_PATH', keys.paths.alipayPlatformPublic, /valid RSA private key/],
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

test('alipay mode loads file-first keys and normalizes a Base64 public key', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const publicKeyBase64 = keys.alipayPlatform.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64');
    const config = parsePaymentRuntimeConfig({
      ...createValidEnvironment(keys),
      PAYMENT_PROVIDER_MODE: 'alipay',
      WECHAT_PAY_ENABLED: '1',
      ALIPAY_APP_PRIVATE_KEY_FILE: keys.paths.alipayAppPrivate,
      ALIPAY_APP_PRIVATE_KEY_PATH: 'missing-private-key.pem',
      ALIPAY_PRIVATE_KEY: 'invalid-inline-private-key',
      ALIPAY_PUBLIC_KEY: publicKeyBase64,
      ALIPAY_PUBLIC_KEY_PATH: undefined,
    });
    assert.equal(config.mode, 'alipay');
    assert.equal(config.alipay.configured, true);
    assert.equal(config.alipay.appPrivateKey.type, 'private');
    assert.equal(config.alipay.platformPublicKey.type, 'public');
    assert.equal(config.wechat.configured, false);

    const privateKeyBase64 = keys.alipayApp.privateKey
      .export({ type: 'pkcs8', format: 'der' })
      .toString('base64');
    const inlineConfig = parsePaymentRuntimeConfig({
      ...createValidEnvironment(keys),
      PAYMENT_PROVIDER_MODE: 'alipay',
      ALIPAY_APP_PRIVATE_KEY_PATH: undefined,
      ALIPAY_PRIVATE_KEY: privateKeyBase64,
    });
    assert.equal(inlineConfig.alipay.appPrivateKey.type, 'private');
  } finally {
    keys.cleanup();
  }
});

test('ready Alipay configuration stays private until the public gate opens', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const privateConfig = parsePaymentRuntimeConfig({
      ...createValidEnvironment(keys),
      PAYMENT_PROVIDER_MODE: 'alipay',
      PAYMENT_PUBLIC_ENTRY_ENABLED: '0',
    });
    assert.equal(privateConfig.alipay.configured, true);
    assert.equal(privateConfig.publicEntryEnabled, false);
    assert.deepEqual(
      createConfiguredPaymentProviderRegistry({
        runtimeConfig: privateConfig,
      }).getCapabilities(),
      {
        canRecharge: false,
        paymentMode: 'alipay',
        paymentProviders: { alipay: false, wechat: false },
        publicPaymentEntryEnabled: false,
      }
    );

    const publicConfig = parsePaymentRuntimeConfig({
      ...createValidEnvironment(keys),
      PAYMENT_PROVIDER_MODE: 'alipay',
      PAYMENT_PUBLIC_ENTRY_ENABLED: '1',
    });
    assert.deepEqual(
      createConfiguredPaymentProviderRegistry({
        runtimeConfig: publicConfig,
      }).getCapabilities(),
      {
        canRecharge: true,
        paymentMode: 'alipay',
        paymentProviders: { alipay: true, wechat: false },
        publicPaymentEntryEnabled: true,
      }
    );
  } finally {
    keys.cleanup();
  }
});

test('disabled mode does not load enabled Alipay key material', () => {
  const config = parsePaymentRuntimeConfig({
    PAYMENT_PROVIDER_MODE: 'disabled',
    ALIPAY_ENABLED: '1',
    ALIPAY_APP_PRIVATE_KEY_FILE: 'missing-private-key.pem',
    ALIPAY_PUBLIC_KEY_FILE: 'missing-public-key.pem',
  });
  assert.deepEqual(config.alipay, { configured: false, enabled: true });
});

test('public HTTPS validation allows public IPv6 and rejects reserved IPv6', () => {
  assert.equal(
    parseHttpsUrl(
      'https://[2606:4700:4700::1111]/notify',
      'TEST_NOTIFY_URL',
      { allowQuery: false, requirePublicHost: true }
    ),
    'https://[2606:4700:4700::1111]/notify'
  );
  for (const value of [
    'https://[::1]/notify',
    'https://[fc00::1]/notify',
    'https://[2001:db8::1]/notify',
  ]) {
    assert.throws(
      () => parseHttpsUrl(value, 'TEST_NOTIFY_URL', {
        allowQuery: false,
        requirePublicHost: true,
      }),
      /HTTPS URL/
    );
  }
});

test('alipay mode fails closed for missing configuration and mock confirmation', () => {
  assert.throws(
    () => parsePaymentRuntimeConfig({
      PAYMENT_PROVIDER_MODE: 'alipay',
      ALIPAY_ENABLED: '1',
    }),
    /Alipay live configuration is incomplete/
  );
  assert.throws(
    () => parsePaymentRuntimeConfig({
      PAYMENT_PROVIDER_MODE: 'alipay',
      PAYMENT_MOCK_CONFIRMATION_ENABLED: '1',
      ALIPAY_ENABLED: '1',
    }),
    /Mock payment confirmation is forbidden/
  );
});

test('alipay mode rejects a missing AppId with otherwise complete settings', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    assert.throws(
      () => parsePaymentRuntimeConfig({
        ...createValidEnvironment(keys),
        PAYMENT_PROVIDER_MODE: 'alipay',
        ALIPAY_APP_ID: '',
      }),
      /Alipay live configuration is incomplete/
    );
  } finally {
    keys.cleanup();
  }
});

test('Alipay production paths do not log key or signature material', () => {
  for (const relativePath of [
    '../config/payments.js',
    '../payments/alipay_crypto.js',
    '../payments/alipay_payment_provider.js',
    '../routes/payment_notification_routes.js',
    '../services/payment_service.js',
  ]) {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
    assert.doesNotMatch(source, /console\.(?:debug|error|info|log|warn)\s*\(/);
  }

  const sensitiveMarker = 'sensitive-private-key-must-not-leak';
  let caughtError = null;
  try {
    parsePaymentRuntimeConfig({
      PAYMENT_PROVIDER_MODE: 'alipay',
      PAYMENT_MOCK_CONFIRMATION_ENABLED: '0',
      ALIPAY_ENABLED: '1',
      ALIPAY_APP_ID: '0000000000000000',
      ALIPAY_PRIVATE_KEY: sensitiveMarker,
      ALIPAY_PUBLIC_KEY: sensitiveMarker,
      ALIPAY_NOTIFY_URL:
        'https://merchant.example.com/api/payment-notifications/alipay',
      ALIPAY_RETURN_URL: 'https://merchant.example.com/payment-return',
    });
  } catch (error) {
    caughtError = error;
  }
  assert.ok(caughtError);
  assert.equal(caughtError.message.includes(sensitiveMarker), false);
});
