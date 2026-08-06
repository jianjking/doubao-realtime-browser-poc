'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');

const PAYMENT_NOTICE = '模拟支付，不会产生真实扣款';
const MIN_PAYMENT_AMOUNT_CENTS = 1;
const MAX_PAYMENT_AMOUNT_CENTS = 100000;
const PAYMENT_ORDER_TTL_MS = 15 * 60 * 1000;
const PAYMENT_PROVIDERS = Object.freeze(['wechat', 'alipay']);
const PAYMENT_PROVIDER_MODES = Object.freeze([
  'disabled',
  'mock',
  'live',
  'alipay',
]);
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

function isNonPublicHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const ipVersion = net.isIP(host);
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.example')
    || host.endsWith('.invalid')
    || host.endsWith('.test')
    || (ipVersion === 0 && !host.includes('.'))
  ) {
    return true;
  }
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    const [first, second] = parts;
    return (
      first === 0
      || first === 10
      || (first === 100 && second >= 64 && second <= 127)
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0)
      || (first === 192 && second === 168)
      || (first === 198 && second >= 18 && second <= 19)
      || (first === 198 && second === 51)
      || (first === 203 && second === 0 && parts[2] === 113)
      || first >= 224
    );
  }
  if (ipVersion === 6) {
    if (host.startsWith('::ffff:')) {
      return isNonPublicHostname(host.slice('::ffff:'.length));
    }
    return (
      host === '::'
      || host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe8')
      || host.startsWith('fe9')
      || host.startsWith('fea')
      || host.startsWith('feb')
      || host.startsWith('ff')
      || host === '2001:db8'
      || host.startsWith('2001:db8:')
    );
  }
  return false;
}

function parseHttpsUrl(
  value,
  name,
  { allowQuery = true, requirePublicHost = false } = {}
) {
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
    || (requirePublicHost && isNonPublicHostname(url.hostname))
  ) {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  return url.toString();
}

function normalizeRsaKeyMaterial(keyBytes, keyKind) {
  let material = Buffer.isBuffer(keyBytes)
    ? keyBytes
    : Buffer.from(String(keyBytes), 'utf8');
  const text = material.toString('utf8').trim();
  if (
    text !== ''
    && !text.includes('-----BEGIN')
    && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(text.replace(/\s+/g, ''))
  ) {
    const base64 = text.replace(/\s+/g, '');
    const label = keyKind === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
    material = Buffer.from(
      `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`,
      'utf8'
    );
  }
  return material;
}

function parseRsaKey(keyBytes, keyKind, name) {
  const material = normalizeRsaKeyMaterial(keyBytes, keyKind);
  const asciiMaterial = material.toString('ascii');
  if (
    keyKind === 'public'
    && asciiMaterial.includes('-----BEGIN')
    && !/-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(asciiMaterial)
  ) {
    throw new Error(`${name} must contain a valid RSA public key`);
  }
  if (keyKind === 'public') {
    let containsCertificate = false;
    try {
      new crypto.X509Certificate(material);
      containsCertificate = true;
    } catch {
      // Public-key mode accepts key material, never certificates.
    }
    if (containsCertificate) {
      throw new Error(`${name} must contain a valid RSA public key`);
    }
  }
  let key;
  try {
    key = keyKind === 'private'
      ? crypto.createPrivateKey(material)
      : crypto.createPublicKey(material);
  } catch {
    throw new Error(`${name} must contain a valid RSA ${keyKind} key`);
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new Error(`${name} must contain a valid RSA ${keyKind} key`);
  }
  return key;
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
  return parseRsaKey(keyBytes, keyKind, name);
}

function resolveAlipayKeySource(env, fileNames, inlineNames) {
  for (const name of fileNames) {
    if (typeof env[name] === 'string' && env[name].trim() !== '') {
      return Object.freeze({
        kind: 'file',
        name,
        value: env[name].trim(),
      });
    }
  }
  for (const name of inlineNames) {
    if (typeof env[name] === 'string' && env[name].trim() !== '') {
      return Object.freeze({
        kind: 'inline',
        name,
        value: env[name],
      });
    }
  }
  return null;
}

function loadAlipayKey(source, keyKind) {
  if (source.kind === 'file') {
    return loadRsaKey(source.value, keyKind, source.name);
  }
  let value = source.value;
  if (typeof value === 'string' && value.includes('\\n')) {
    value = value.replace(/\\n/g, '\n');
  }
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) {
    throw new Error(`${source.name} is too large`);
  }
  return parseRsaKey(value, keyKind, source.name);
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
      { allowQuery: false, requirePublicHost: true }
    ),
    platformPublicKey,
    platformPublicKeyId: env.WECHAT_PAY_PUBLIC_KEY_ID,
  });
}

function parseAlipayLiveConfig(env, enabled, { strict = false } = {}) {
  if (!enabled) {
    if (strict) {
      throw new Error('ALIPAY_ENABLED must be 1 in alipay mode');
    }
    return Object.freeze({ configured: false, enabled: false });
  }
  const appPrivateKeySource = resolveAlipayKeySource(
    env,
    ['ALIPAY_APP_PRIVATE_KEY_FILE', 'ALIPAY_APP_PRIVATE_KEY_PATH'],
    ['ALIPAY_PRIVATE_KEY', 'ALIPAY_APP_PRIVATE_KEY']
  );
  const publicKeySource = resolveAlipayKeySource(
    env,
    ['ALIPAY_PUBLIC_KEY_FILE', 'ALIPAY_PUBLIC_KEY_PATH'],
    ['ALIPAY_PUBLIC_KEY']
  );
  const requiredNames = [
    'ALIPAY_APP_ID',
    'ALIPAY_NOTIFY_URL',
    'ALIPAY_RETURN_URL',
  ];
  if (!hasEveryString(env, requiredNames) || !appPrivateKeySource || !publicKeySource) {
    if (strict) {
      throw new Error('Alipay live configuration is incomplete');
    }
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
    appPrivateKey: loadAlipayKey(appPrivateKeySource, 'private'),
    configured: true,
    enabled: true,
    gatewayUrl,
    notifyUrl: parseHttpsUrl(
      env.ALIPAY_NOTIFY_URL,
      'ALIPAY_NOTIFY_URL',
      { allowQuery: false, requirePublicHost: true }
    ),
    platformPublicKey: loadAlipayKey(publicKeySource, 'public'),
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
      'PAYMENT_PROVIDER_MODE must be disabled, mock, live, or alipay'
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
  if (mode === 'alipay' && mockConfirmationEnabled) {
    throw new Error('Mock payment confirmation is forbidden in alipay mode');
  }
  const parseWechat = mode === 'live';
  const parseAlipay = mode === 'live' || mode === 'alipay';

  return Object.freeze({
    alipay: parseAlipay
      ? parseAlipayLiveConfig(env, alipayEnabled, { strict: mode === 'alipay' })
      : Object.freeze({ configured: false, enabled: alipayEnabled }),
    mode,
    mockConfirmationEnabled,
    nodeEnv: typeof env.NODE_ENV === 'string' ? env.NODE_ENV : '',
    wechat: parseWechat
      ? parseWechatLiveConfig(env, wechatEnabled)
      : Object.freeze({ configured: false, enabled: wechatEnabled }),
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
