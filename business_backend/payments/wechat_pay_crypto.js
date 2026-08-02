'use strict';

const crypto = require('node:crypto');

const {
  createPaymentProtocolError,
} = require('./payment_errors');

const DEFAULT_WECHAT_SIGNATURE_SKEW_SECONDS = 5 * 60;
const DEFAULT_WECHAT_PLAINTEXT_LIMIT = 64 * 1024;

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }
  return '';
}

function decodeBase64Strict(value, fieldName) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      `${fieldName} is invalid`
    );
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      `${fieldName} is invalid`
    );
  }
  return decoded;
}

function canonicalWechatUrl(url) {
  const parsedUrl = url instanceof URL ? url : new URL(url);
  return `${parsedUrl.pathname}${parsedUrl.search}`;
}

function buildWechatRequestMessage({ method, url, timestamp, nonce, body }) {
  const normalizedMethod = typeof method === 'string'
    ? method.toUpperCase()
    : '';
  if (!['GET', 'POST'].includes(normalizedMethod)) {
    throw new TypeError('WeChat request method must be GET or POST');
  }
  if (!/^\d+$/.test(String(timestamp))) {
    throw new TypeError('WeChat timestamp must be Unix seconds');
  }
  if (typeof nonce !== 'string' || nonce === '' || /[\r\n]/.test(nonce)) {
    throw new TypeError('WeChat nonce must be a non-empty string');
  }
  if (typeof body !== 'string') {
    throw new TypeError('WeChat request body must be a string');
  }
  return `${normalizedMethod}\n${canonicalWechatUrl(url)}\n`
    + `${timestamp}\n${nonce}\n${body}\n`;
}

function signRsaSha256(message, privateKey) {
  return crypto.sign(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    privateKey
  ).toString('base64');
}

function verifyRsaSha256(message, signature, publicKey) {
  let signatureBytes;
  try {
    signatureBytes = decodeBase64Strict(signature, 'Payment signature');
  } catch {
    return false;
  }
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    publicKey,
    signatureBytes
  );
}

function createWechatAuthorization({
  method,
  url,
  body = '',
  mchId,
  serialNo,
  privateKey,
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = crypto.randomBytes(16).toString('hex'),
} = {}) {
  for (const [name, value] of [['mchId', mchId], ['serialNo', serialNo]]) {
    if (
      typeof value !== 'string'
      || value === ''
      || !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new TypeError(`${name} is invalid`);
    }
  }
  const message = buildWechatRequestMessage({
    method,
    url,
    timestamp: String(timestamp),
    nonce,
    body,
  });
  const signature = signRsaSha256(message, privateKey);
  return Object.freeze({
    authorization: 'WECHATPAY2-SHA256-RSA2048 '
      + `mchid="${mchId}",nonce_str="${nonce}",`
      + `timestamp="${timestamp}",serial_no="${serialNo}",`
      + `signature="${signature}"`,
    message,
    nonce,
    signature,
    timestamp: String(timestamp),
  });
}

function buildWechatResponseMessage(timestamp, nonce, rawBody) {
  if (typeof rawBody !== 'string') {
    throw new TypeError('rawBody must be a string');
  }
  return `${timestamp}\n${nonce}\n${rawBody}\n`;
}

function resolveTrustedWechatPublicKey(trustedPublicKeys, serial) {
  if (trustedPublicKeys instanceof Map) {
    return trustedPublicKeys.get(serial) || null;
  }
  if (
    trustedPublicKeys
    && typeof trustedPublicKeys === 'object'
    && Object.hasOwn(trustedPublicKeys, serial)
  ) {
    return trustedPublicKeys[serial] || null;
  }
  return null;
}

function verifyWechatSignedMessage({
  headers,
  rawBody,
  trustedPublicKeys,
  nowMs = Date.now(),
  maxSkewSeconds = DEFAULT_WECHAT_SIGNATURE_SKEW_SECONDS,
} = {}) {
  if (Buffer.isBuffer(rawBody)) {
    rawBody = rawBody.toString('utf8');
  }
  if (typeof rawBody !== 'string') {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification body is invalid'
    );
  }
  const timestamp = getHeader(headers, 'Wechatpay-Timestamp');
  const nonce = getHeader(headers, 'Wechatpay-Nonce');
  const signature = getHeader(headers, 'Wechatpay-Signature');
  const serial = getHeader(headers, 'Wechatpay-Serial');
  if (
    !/^\d{1,16}$/.test(timestamp)
    || nonce === ''
    || signature === ''
    || serial === ''
    || !Number.isSafeInteger(maxSkewSeconds)
    || maxSkewSeconds < 0
  ) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_SIGNATURE_INVALID',
      'Payment signature is invalid'
    );
  }
  const timestampSeconds = Number(timestamp);
  const currentSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds)
    || Math.abs(currentSeconds - timestampSeconds) > maxSkewSeconds
  ) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_SIGNATURE_EXPIRED',
      'Payment signature timestamp is outside the allowed window'
    );
  }
  const publicKey = resolveTrustedWechatPublicKey(
    trustedPublicKeys,
    serial
  );
  if (!publicKey) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_SIGNATURE_INVALID',
      'Payment signature is invalid'
    );
  }
  const message = buildWechatResponseMessage(timestamp, nonce, rawBody);
  if (!verifyRsaSha256(message, signature, publicKey)) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_SIGNATURE_INVALID',
      'Payment signature is invalid'
    );
  }
  return Object.freeze({ nonce, serial, timestamp });
}

function decryptWechatResource({
  apiV3Key,
  algorithm,
  ciphertext,
  nonce,
  associatedData = '',
  maxPlaintextBytes = DEFAULT_WECHAT_PLAINTEXT_LIMIT,
} = {}) {
  const key = Buffer.isBuffer(apiV3Key)
    ? Buffer.from(apiV3Key)
    : Buffer.from(String(apiV3Key || ''), 'utf8');
  if (key.length !== 32) {
    throw new TypeError('WeChat APIv3 key must be exactly 32 bytes');
  }
  if (algorithm !== 'AEAD_AES_256_GCM') {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification encryption algorithm is invalid'
    );
  }
  if (typeof nonce !== 'string' || Buffer.byteLength(nonce, 'utf8') !== 12) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification nonce is invalid'
    );
  }
  if (typeof associatedData !== 'string') {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification associated data is invalid'
    );
  }
  const encrypted = decodeBase64Strict(
    ciphertext,
    'Payment notification ciphertext'
  );
  if (encrypted.length <= 16) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification ciphertext is invalid'
    );
  }
  const encryptedBody = encrypted.subarray(0, encrypted.length - 16);
  const authenticationTag = encrypted.subarray(encrypted.length - 16);
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(nonce, 'utf8')
    );
    decipher.setAuthTag(authenticationTag);
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const plaintext = Buffer.concat([
      decipher.update(encryptedBody),
      decipher.final(),
    ]);
    if (plaintext.length > maxPlaintextBytes) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Payment notification plaintext is too large'
      );
    }
    return plaintext.toString('utf8');
  } catch (error) {
    if (error && error.code === 'PAYMENT_NOTIFICATION_INVALID') {
      throw error;
    }
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification decryption failed'
    );
  }
}

function createWechatJsapiPaySignature({
  appId,
  timeStamp,
  nonceStr,
  packageValue,
  privateKey,
} = {}) {
  for (const value of [appId, timeStamp, nonceStr, packageValue]) {
    if (typeof value !== 'string' || value === '' || /[\r\n]/.test(value)) {
      throw new TypeError('WeChat JSAPI signature field is invalid');
    }
  }
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  return Object.freeze({
    message,
    signature: signRsaSha256(message, privateKey),
  });
}

module.exports = {
  DEFAULT_WECHAT_PLAINTEXT_LIMIT,
  DEFAULT_WECHAT_SIGNATURE_SKEW_SECONDS,
  buildWechatRequestMessage,
  buildWechatResponseMessage,
  canonicalWechatUrl,
  createWechatAuthorization,
  createWechatJsapiPaySignature,
  decodeBase64Strict,
  decryptWechatResource,
  signRsaSha256,
  verifyRsaSha256,
  verifyWechatSignedMessage,
};
