'use strict';

const crypto = require('node:crypto');

const {
  createPaymentProtocolError,
} = require('./payment_errors');
const {
  decodeBase64Strict,
  signRsaSha256,
  verifyRsaSha256,
} = require('./wechat_pay_crypto');

const MAX_ALIPAY_FORM_PARAMETERS = 64;

function centsToAlipayAmount(amountCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new TypeError('amountCents must be a non-negative safe integer');
  }
  const yuan = Math.floor(amountCents / 100);
  const cents = String(amountCents % 100).padStart(2, '0');
  return `${yuan}.${cents}`;
}

function alipayAmountToCents(amount) {
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)\.\d{2}$/.test(amount)) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_AMOUNT_MISMATCH',
      'Payment amount is invalid'
    );
  }
  const [yuanText, centsText] = amount.split('.');
  const yuan = Number(yuanText);
  const cents = Number(centsText);
  if (!Number.isSafeInteger(yuan)) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_AMOUNT_MISMATCH',
      'Payment amount is invalid'
    );
  }
  const amountCents = (yuan * 100) + cents;
  if (!Number.isSafeInteger(amountCents)) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_AMOUNT_MISMATCH',
      'Payment amount is invalid'
    );
  }
  return amountCents;
}

function canonicalizeAlipayParameters(parameters, {
  excludeSignType = false,
} = {}) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new TypeError('Alipay parameters must be an object');
  }
  return Object.keys(parameters)
    .filter((key) => (
      key !== 'sign'
      && (!excludeSignType || key !== 'sign_type')
      && parameters[key] !== undefined
      && parameters[key] !== null
      && parameters[key] !== ''
    ))
    .sort()
    .map((key) => {
      const value = parameters[key];
      if (typeof value !== 'string') {
        throw new TypeError('Alipay parameter values must be strings');
      }
      return `${key}=${value}`;
    })
    .join('&');
}

function createSignedAlipayParameters(parameters, privateKey) {
  const signContent = canonicalizeAlipayParameters(parameters, {
    excludeSignType: true,
  });
  return Object.freeze({
    ...parameters,
    sign: signRsaSha256(signContent, privateKey),
  });
}

function verifyAlipayNotificationParameters(parameters, publicKey) {
  if (
    !parameters
    || parameters.sign_type !== 'RSA2'
    || typeof parameters.sign !== 'string'
  ) {
    return false;
  }
  const signContent = canonicalizeAlipayParameters(parameters, {
    excludeSignType: true,
  });
  return verifyRsaSha256(signContent, parameters.sign, publicKey);
}

function decodeFormComponent(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification form is invalid'
    );
  }
}

function parseAlipayFormBodyStrict(rawBody) {
  if (!Buffer.isBuffer(rawBody)) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification body is invalid'
    );
  }
  const rawText = rawBody.toString('utf8');
  if (rawText === '') {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification body is invalid'
    );
  }
  const segments = rawText.split('&');
  if (segments.length > MAX_ALIPAY_FORM_PARAMETERS) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment notification has too many parameters'
    );
  }
  const parameters = Object.create(null);
  for (const segment of segments) {
    const separator = segment.indexOf('=');
    const rawKey = separator === -1 ? segment : segment.slice(0, separator);
    const rawValue = separator === -1 ? '' : segment.slice(separator + 1);
    const key = decodeFormComponent(rawKey);
    const value = decodeFormComponent(rawValue);
    if (key === '' || Object.hasOwn(parameters, key)) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Payment notification contains duplicate or invalid parameters'
      );
    }
    parameters[key] = value;
  }
  return Object.freeze(parameters);
}

function encodeAlipayForm(parameters) {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(parameters[key])}`)
    .join('&');
}

function formatAlipayTimestamp(nowMs = Date.now()) {
  const date = new Date(nowMs + (8 * 60 * 60 * 1000));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Alipay timestamp is invalid');
  }
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]} `
    + `${parts[3]}:${parts[4]}:${parts[5]}`;
}

function alipayDateTimeToIso(value) {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
    : null;
  if (!match) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment time is invalid'
    );
  }
  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6])
  );
  const result = new Date(milliseconds);
  const shanghaiResult = new Date(milliseconds + (8 * 60 * 60 * 1000));
  if (
    Number.isNaN(result.getTime())
    || shanghaiResult.getUTCFullYear() !== Number(match[1])
    || shanghaiResult.getUTCMonth() + 1 !== Number(match[2])
    || shanghaiResult.getUTCDate() !== Number(match[3])
    || shanghaiResult.getUTCHours() !== Number(match[4])
    || shanghaiResult.getUTCMinutes() !== Number(match[5])
    || shanghaiResult.getUTCSeconds() !== Number(match[6])
  ) {
    throw createPaymentProtocolError(
      400,
      'PAYMENT_NOTIFICATION_INVALID',
      'Payment time is invalid'
    );
  }
  return result.toISOString();
}

function extractJsonObjectMemberRaw(rawText, memberName) {
  if (typeof rawText !== 'string' || typeof memberName !== 'string') {
    throw new TypeError('rawText and memberName must be strings');
  }
  const marker = JSON.stringify(memberName);
  const markerIndex = rawText.indexOf(marker);
  if (markerIndex === -1) {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_PLATFORM_RESPONSE_INVALID',
      'Payment platform response is invalid'
    );
  }
  let cursor = markerIndex + marker.length;
  while (/\s/.test(rawText[cursor] || '')) {
    cursor += 1;
  }
  if (rawText[cursor] !== ':') {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_PLATFORM_RESPONSE_INVALID',
      'Payment platform response is invalid'
    );
  }
  cursor += 1;
  while (/\s/.test(rawText[cursor] || '')) {
    cursor += 1;
  }
  if (rawText[cursor] !== '{') {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_PLATFORM_RESPONSE_INVALID',
      'Payment platform response is invalid'
    );
  }
  const start = cursor;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; cursor < rawText.length; cursor += 1) {
    const character = rawText[cursor];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return rawText.slice(start, cursor + 1);
      }
    }
  }
  throw createPaymentProtocolError(
    502,
    'PAYMENT_PLATFORM_RESPONSE_INVALID',
    'Payment platform response is invalid'
  );
}

function verifyAndParseAlipayResponse(rawText, responseMember, publicKey) {
  let envelope;
  try {
    envelope = JSON.parse(rawText);
  } catch {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_PLATFORM_RESPONSE_INVALID',
      'Payment platform response is invalid'
    );
  }
  if (!envelope || typeof envelope.sign !== 'string') {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_SIGNATURE_INVALID',
      'Payment platform signature is invalid'
    );
  }
  const rawResponse = extractJsonObjectMemberRaw(rawText, responseMember);
  if (!verifyRsaSha256(rawResponse, envelope.sign, publicKey)) {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_SIGNATURE_INVALID',
      'Payment platform signature is invalid'
    );
  }
  const response = envelope[responseMember];
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_PLATFORM_RESPONSE_INVALID',
      'Payment platform response is invalid'
    );
  }
  return response;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  MAX_ALIPAY_FORM_PARAMETERS,
  alipayAmountToCents,
  alipayDateTimeToIso,
  canonicalizeAlipayParameters,
  centsToAlipayAmount,
  createSignedAlipayParameters,
  decodeBase64Strict,
  encodeAlipayForm,
  extractJsonObjectMemberRaw,
  formatAlipayTimestamp,
  parseAlipayFormBodyStrict,
  sha256Hex,
  verifyAlipayNotificationParameters,
  verifyAndParseAlipayResponse,
};
