'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const PAYMENT_NOTICE = '模拟支付，不会产生真实扣款';
const MIN_PAYMENT_AMOUNT_CENTS = 1;
const MAX_PAYMENT_AMOUNT_CENTS = 100000;
const PAYMENT_ORDER_TTL_MS = 15 * 60 * 1000;
const PAYMENT_PROVIDERS = Object.freeze(['wechat', 'alipay']);
const PAYMENT_PROVIDER_MODES = Object.freeze(['disabled', 'mock', 'live']);
const WECHAT_PAY_API_ORIGIN = 'https://api.mch.weixin.qq.com';
const ALIPAY_GATEWAY_URL = 'https://openapi.alipay.com/gateway.do';

function parseEnabledFlag(env, name) {
  const value = env[name] === undefined ? '0' : env[name];
  if (value !== '0' && value !== '1') {
    throw new Error(`${name} must be 0 or 1`);
  }
  return value === '1';
}

function hasEveryString(env, names) {
  return names.every((name) => (
    typeof env[name] === 'string' && env[name].trim() !== ''
  ));
}

function parseHttpsUrl(value, name, { allowQuery = true } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.hash !== ''
    || (!allowQuery && url.search !== '')
  ) {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  return url.toString();
}

function loadRsaKey(filePath, keyKind, name) {
  let keyBytes;
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < 1 || stats.size > 64 * 1024) {
      throw new Error('invalid key file');
    }
    keyBytes = fs.readFileSync(filePath);
  } catch {
    throw new Error(`${name} could not be read`);
  }
  if (
    keyKind === 'public'
    && /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(
      keyBytes.toString('ascii')
    )
  ) {
    throw new Error(`${name} must contain a valid RSA public key`);
  }
  let key;
  try {
    key = keyKind === 'private'
      ? crypto.createPrivateKey(keyBytes)
      : crypto.createPublicKey(keyBytes);
  } catch {
    throw new Error(`${name} must contain a valid RSA ${keyKind} key`);
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error(`${name} must contain a valid RSA ${keyKind} key`);
  }
  return key;
}

function parseWechatLiveConfig(env, enabled) {
  if (!enabled) {
    return Object.freeze({ configured: false, enabled: false });
  }
  const requiredNames = [
    'WECHAT_PAY_MCH_ID',
    'WECHAT_PAY_APP_ID',
    'WECHAT_PAY_API_V3_KEY',
    'WECHAT_PAY_MERCHANT_SERIAL_NO',
    'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH',
    'WECHAT_PAY_PUBLIC_KEY_ID',
    'WECHAT_PAY_PUBLIC_KEY_PATH',
    'WECHAT_PAY_NOTIFY_URL',
    'WECHAT_PAY_H5_RETURN_URL',
  ];
  if (!hasEveryString(env, requiredNames)) {
    return Object.freeze({ configured: false, enabled: true });
  }
  if (!/^\d{6,32}$/.test(env.WECHAT_PAY_MCH_ID)) {
    throw new Error('WECHAT_PAY_MCH_ID is invalid');
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(env.WECHAT_PAY_APP_ID)) {
    throw new Error('WECHAT_PAY_APP_ID is invalid');
  }
  if (!/^[A-Fa-f0-9]{8,64}$/.test(env.WECHAT_PAY_MERCHANT_SERIAL_NO)) {
    throw new Error('WECHAT_PAY_MERCHANT_SERIAL_NO is invalid');
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(env.WECHAT_PAY_PUBLIC_KEY_ID)) {
    throw new Error('WECHAT_PAY_PUBLIC_KEY_ID is invalid');
  }
  if (Buffer.byteLength(env.WECHAT_PAY_API_V3_KEY, 'utf8') !== 32) {
    throw new Error('WECHAT_PAY_API_V3_KEY must be exactly 32 bytes');
  }
  const merchantPrivateKey = loadRsaKey(
    env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH,
    'private',
    'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH'
  );
  const platformPublicKey = loadRsaKey(
    env.WECHAT_PAY_PUBLIC_KEY_PATH,
    'public',
    'WECHAT_PAY_PUBLIC_KEY_PATH'
  );
  return Object.freeze({
    apiV3Key: Buffer.from(env.WECHAT_PAY_API_V3_KEY, 'utf8'),
    appId: env.WECHAT_PAY_APP_ID,
    configured: true,
    enabled: true,
    h5ReturnUrl: parseHttpsUrl(
      env.WECHAT_PAY_H5_RETURN_URL,
      'WECHAT_PAY_H5_RETURN_URL'
    ),
    mchId: env.WECHAT_PAY_MCH_ID,
    merchantPrivateKey,
    merchantSerialNo: env.WECHAT_PAY_MERCHANT_SERIAL_NO,
    notifyUrl: parseHttpsUrl(
      env.WECHAT_PAY_NOTIFY_URL,
      'WECHAT_PAY_NOTIFY_URL',
      { allowQuery: false }
    ),
    platformPublicKey,
    platformPublicKeyId: env.WECHAT_PAY_PUBLIC_KEY_ID,
  });
}

function parseAlipayLiveConfig(env, enabled) {
  if (!enabled) {
    return Object.freeze({ configured: false, enabled: false });
  }
  const requiredNames = [
    'ALIPAY_APP_ID',
    'ALIPAY_APP_PRIVATE_KEY_PATH',
    'ALIPAY_PUBLIC_KEY_PATH',
    'ALIPAY_NOTIFY_URL',
    'ALIPAY_RETURN_URL',
  ];
  if (!hasEveryString(env, requiredNames)) {
    return Object.freeze({ configured: false, enabled: true });
  }
  if (!/^\d{8,32}$/.test(env.ALIPAY_APP_ID)) {
    throw new Error('ALIPAY_APP_ID is invalid');
  }
  const gatewayUrl = env.ALIPAY_GATEWAY_URL === undefined
    ? ALIPAY_GATEWAY_URL
    : parseHttpsUrl(env.ALIPAY_GATEWAY_URL, 'ALIPAY_GATEWAY_URL');
  if (gatewayUrl !== ALIPAY_GATEWAY_URL) {
    throw new Error('ALIPAY_GATEWAY_URL must be the official Alipay gateway');
  }
  if (
    env.ALIPAY_SELLER_ID !== undefined
    && env.ALIPAY_SELLER_ID !== ''
    && !/^\d{8,32}$/.test(env.ALIPAY_SELLER_ID)
  ) {
    throw new Error('ALIPAY_SELLER_ID is invalid');
  }
  return Object.freeze({
    appId: env.ALIPAY_APP_ID,
    appPrivateKey: loadRsaKey(
      env.ALIPAY_APP_PRIVATE_KEY_PATH,
      'private',
      'ALIPAY_APP_PRIVATE_KEY_PATH'
    ),
    configured: true,
    enabled: true,
    gatewayUrl,
    notifyUrl: parseHttpsUrl(
      env.ALIPAY_NOTIFY_URL,
      'ALIPAY_NOTIFY_URL',
      { allowQuery: false }
    ),
    platformPublicKey: loadRsaKey(
      env.ALIPAY_PUBLIC_KEY_PATH,
      'public',
      'ALIPAY_PUBLIC_KEY_PATH'
    ),
    returnUrl: parseHttpsUrl(
      env.ALIPAY_RETURN_URL,
      'ALIPAY_RETURN_URL'
    ),
    sellerId: env.ALIPAY_SELLER_ID || '',
  });
}

function parsePaymentRuntimeConfig(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }

  const mode = env.PAYMENT_PROVIDER_MODE === undefined
    ? 'disabled'
    : env.PAYMENT_PROVIDER_MODE;
  if (!PAYMENT_PROVIDER_MODES.includes(mode)) {
    throw new Error(
      'PAYMENT_PROVIDER_MODE must be disabled, mock, or live'
    );
  }

  const rawMockConfirmation =
    env.PAYMENT_MOCK_CONFIRMATION_ENABLED === undefined
      ? '0'
      : env.PAYMENT_MOCK_CONFIRMATION_ENABLED;
  if (rawMockConfirmation !== '0' && rawMockConfirmation !== '1') {
    throw new Error(
      'PAYMENT_MOCK_CONFIRMATION_ENABLED must be 0 or 1'
    );
  }
  const mockConfirmationEnabled = rawMockConfirmation === '1';

  if (
    env.NODE_ENV === 'production'
    && (mode === 'mock' || mockConfirmationEnabled)
  ) {
    throw new Error('Mock payment is forbidden in production');
  }

  const wechatEnabled = parseEnabledFlag(env, 'WECHAT_PAY_ENABLED');
  const alipayEnabled = parseEnabledFlag(env, 'ALIPAY_ENABLED');

  return Object.freeze({
    alipay: parseAlipayLiveConfig(env, alipayEnabled),
    mode,
    mockConfirmationEnabled,
    nodeEnv: typeof env.NODE_ENV === 'string' ? env.NODE_ENV : '',
    wechat: parseWechatLiveConfig(env, wechatEnabled),
  });
}

module.exports = {
  ALIPAY_GATEWAY_URL,
  MAX_PAYMENT_AMOUNT_CENTS,
  MIN_PAYMENT_AMOUNT_CENTS,
  PAYMENT_NOTICE,
  PAYMENT_ORDER_TTL_MS,
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_MODES,
  WECHAT_PAY_API_ORIGIN,
  loadRsaKey,
  parseAlipayLiveConfig,
  parseHttpsUrl,
  parsePaymentRuntimeConfig,
  parseWechatLiveConfig,
};
