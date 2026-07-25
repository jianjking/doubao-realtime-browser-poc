'use strict';

const crypto = require('node:crypto');

const DEFAULT_DEVELOPMENT_VERIFICATION_CODE = '123456';
const CHINESE_MOBILE_PATTERN = /^1[3-9]\d{9}$/;

function normalizeChineseMobile(phone) {
  if (typeof phone !== 'string') {
    return null;
  }

  const compactPhone = phone.trim().replace(/[ -]/g, '');
  const nationalPhone = compactPhone.startsWith('+86')
    ? compactPhone.slice(3)
    : compactPhone;
  if (!CHINESE_MOBILE_PATTERN.test(nationalPhone)) {
    return null;
  }
  if (
    compactPhone !== nationalPhone
    && compactPhone !== `+86${nationalPhone}`
  ) {
    return null;
  }
  return `+86${nationalPhone}`;
}

function maskChineseMobile(phoneE164) {
  if (
    typeof phoneE164 !== 'string'
    || !/^\+861[3-9]\d{9}$/.test(phoneE164)
  ) {
    throw new TypeError('A normalized Chinese mobile number is required');
  }

  const nationalPhone = phoneE164.slice(3);
  return `${nationalPhone.slice(0, 3)}****${nationalPhone.slice(-4)}`;
}

function createPublicError(statusCode, code, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function createAuthService({
  userStore,
  sessionService,
  accountService,
  clock = Date.now,
  idGenerator = () => crypto.randomUUID(),
  developmentVerificationCode =
    DEFAULT_DEVELOPMENT_VERIFICATION_CODE,
} = {}) {
  if (!userStore || !sessionService || !accountService) {
    throw new TypeError(
      'userStore, sessionService, and accountService are required'
    );
  }

  function login(requestBody) {
    if (
      !requestBody
      || typeof requestBody !== 'object'
      || Array.isArray(requestBody)
      || typeof requestBody.phone !== 'string'
    ) {
      throw createPublicError(
        400,
        'INVALID_LOGIN_REQUEST',
        'Phone and verification code are required'
      );
    }

    const phoneE164 = normalizeChineseMobile(requestBody.phone);
    if (!phoneE164) {
      throw createPublicError(
        400,
        'INVALID_PHONE',
        'A valid mobile phone number is required'
      );
    }

    if (
      typeof requestBody.code !== 'string'
      || requestBody.code === ''
    ) {
      throw createPublicError(
        400,
        'INVALID_LOGIN_REQUEST',
        'Phone and verification code are required'
      );
    }
    if (requestBody.code !== developmentVerificationCode) {
      throw createPublicError(
        401,
        'INVALID_VERIFICATION_CODE',
        'Verification code is invalid'
      );
    }

    let user = userStore.findByPhoneE164(phoneE164);
    if (!user) {
      const now = new Date(clock()).toISOString();
      user = {
        id: idGenerator(),
        phoneE164,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      userStore.save(user);
    }

    accountService.ensureAccountForUser(user.id);
    const {
      rawToken,
      principal,
      session,
    } = sessionService.createUserSession(user.id);
    return {
      rawToken,
      authMode: 'development_mock_phone',
      principal,
      profile: {
        phoneMasked: maskChineseMobile(user.phoneE164),
      },
      session,
    };
  }

  return {
    login,
  };
}

module.exports = {
  createAuthService,
  maskChineseMobile,
  normalizeChineseMobile,
};
