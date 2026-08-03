'use strict';

const crypto = require('node:crypto');

const CHINESE_MOBILE_PATTERN = /^1[3-9]\d{9}$/;
const SMS_CHALLENGE_TTL_SECONDS = 300;
const SMS_RESEND_AFTER_SECONDS = 60;
const SMS_MAX_ATTEMPTS = 5;
const SMS_PHONE_HOURLY_LIMIT = 5;
const SMS_IP_HOURLY_LIMIT = 20;
const SMS_PHONE_DAILY_LIMIT = 10;

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

function createPublicError(
  statusCode,
  code,
  publicMessage,
  retryAfterSeconds
) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  if (Number.isInteger(retryAfterSeconds)) {
    error.retryAfterSeconds = retryAfterSeconds;
  }
  return error;
}

function digestRequestIp(requestIp) {
  const normalizedIp = typeof requestIp === 'string' && requestIp !== ''
    ? requestIp
    : 'unknown';
  return crypto
    .createHash('sha256')
    .update(`sms-request-ip-v1\0${normalizedIp}`, 'utf8')
    .digest('hex');
}

function safeProviderFailureCode(error) {
  return error
    && typeof error.code === 'string'
    && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : 'SMS_PROVIDER_ERROR';
}

function createAuthService({
  userStore,
  sessionService,
  accountService,
  smsChallengeStore,
  smsProvider,
  smsRuntimeConfig,
  runInTransaction = (operation) => operation(),
  clock = Date.now,
  idGenerator = () => crypto.randomUUID(),
  challengeIdGenerator = () => crypto.randomUUID(),
} = {}) {
  if (
    !userStore
    || !sessionService
    || !accountService
    || !smsChallengeStore
    || !smsProvider
    || !smsRuntimeConfig
  ) {
    throw new TypeError(
      'Auth stores, services, and SMS provider are required'
    );
  }
  if (typeof runInTransaction !== 'function') {
    throw new TypeError('runInTransaction must be a function');
  }

  function requireSmsEnabled() {
    if (smsRuntimeConfig.mode === 'disabled') {
      throw createPublicError(
        503,
        'SMS_DISABLED',
        'SMS verification is currently unavailable'
      );
    }
  }

  async function sendSmsCode(requestBody, { requestIp } = {}) {
    requireSmsEnabled();
    if (
      !requestBody
      || typeof requestBody !== 'object'
      || Array.isArray(requestBody)
      || typeof requestBody.phone !== 'string'
    ) {
      throw createPublicError(
        400,
        'INVALID_SMS_SEND_REQUEST',
        'A mobile phone number is required'
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

    const now = clock();
    const nowIso = new Date(now).toISOString();
    const hourAgoIso = new Date(now - 3600000).toISOString();
    const dayAgoIso = new Date(now - 86400000).toISOString();
    const requestIpDigest = digestRequestIp(requestIp);
    const challengeId = challengeIdGenerator();
    const challenge = {
      id: challengeId,
      phoneNormalized: phoneE164,
      purpose: 'login',
      status: 'pending',
      provider: smsRuntimeConfig.mode,
      providerRequestId: null,
      providerBizId: null,
      requestIpDigest,
      expiresAt: new Date(
        now + (SMS_CHALLENGE_TTL_SECONDS * 1000)
      ).toISOString(),
      nextSendAllowedAt: new Date(
        now + (SMS_RESEND_AFTER_SECONDS * 1000)
      ).toISOString(),
      attemptCount: 0,
      maxAttempts: SMS_MAX_ATTEMPTS,
      createdAt: nowIso,
      sentAt: null,
      consumedAt: null,
      invalidatedAt: null,
      failureCode: null,
    };

    runInTransaction(() => {
      smsChallengeStore.expireActive(nowIso);
      const coolingChallenge =
        smsChallengeStore.findCoolingForPhone(phoneE164, nowIso);
      if (coolingChallenge) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(
            (Date.parse(coolingChallenge.nextSendAllowedAt) - now)
              / 1000
          )
        );
        throw createPublicError(
          429,
          'SMS_RESEND_TOO_SOON',
          'Please wait before requesting another code',
          retryAfterSeconds
        );
      }
      if (
        smsChallengeStore.countForPhoneSince(
          phoneE164,
          hourAgoIso
        ) >= SMS_PHONE_HOURLY_LIMIT
      ) {
        throw createPublicError(
          429,
          'SMS_PHONE_HOURLY_LIMIT',
          'Too many codes were requested for this phone',
          3600
        );
      }
      if (
        smsChallengeStore.countForPhoneSince(
          phoneE164,
          dayAgoIso
        ) >= SMS_PHONE_DAILY_LIMIT
      ) {
        throw createPublicError(
          429,
          'SMS_PHONE_DAILY_LIMIT',
          'The daily code limit for this phone was reached',
          86400
        );
      }
      if (
        smsChallengeStore.countForIpSince(
          requestIpDigest,
          hourAgoIso
        ) >= SMS_IP_HOURLY_LIMIT
      ) {
        throw createPublicError(
          429,
          'SMS_IP_HOURLY_LIMIT',
          'Too many codes were requested from this network',
          3600
        );
      }
      smsChallengeStore.create(challenge);
    });

    let providerResult;
    try {
      providerResult = await smsProvider.send({
        challengeId,
        phoneNumber: phoneE164,
        validTimeSeconds: SMS_CHALLENGE_TTL_SECONDS,
      });
    } catch (error) {
      smsChallengeStore.markSendFailed({
        challengeId,
        nowIso: new Date(clock()).toISOString(),
        failureCode: safeProviderFailureCode(error),
      });
      throw createPublicError(
        502,
        'SMS_SEND_FAILED',
        'The verification code could not be sent'
      );
    }

    const sentAt = new Date(clock()).toISOString();
    const markedSent = runInTransaction(() => {
      const changes = smsChallengeStore.markSent({
        challengeId,
        providerRequestId: providerResult.providerRequestId || null,
        providerBizId: providerResult.providerBizId || null,
        sentAt,
      });
      if (changes === 1) {
        smsChallengeStore.invalidateOthersForPhone({
          phoneNormalized: phoneE164,
          challengeId,
          nowIso: sentAt,
        });
      }
      return changes;
    });
    if (markedSent !== 1) {
      throw createPublicError(
        409,
        'SMS_SEND_STATE_CONFLICT',
        'The verification request is no longer active'
      );
    }

    return {
      challengeId,
      expiresInSeconds: SMS_CHALLENGE_TTL_SECONDS,
      resendAfterSeconds: SMS_RESEND_AFTER_SECONDS,
      ...(typeof providerResult.mockCode === 'string'
        ? { mockCode: providerResult.mockCode }
        : {}),
    };
  }

  function challengeStateError(challenge) {
    if (!challenge) {
      return createPublicError(
        401,
        'INVALID_SMS_CHALLENGE',
        'The verification request is invalid'
      );
    }
    if (challenge.status === 'expired') {
      return createPublicError(
        410,
        'SMS_CHALLENGE_EXPIRED',
        'The verification code has expired'
      );
    }
    if (challenge.status === 'locked') {
      return createPublicError(
        423,
        'SMS_CHALLENGE_LOCKED',
        'Too many incorrect attempts were made'
      );
    }
    if (challenge.status === 'consumed') {
      return createPublicError(
        409,
        'SMS_CHALLENGE_CONSUMED',
        'The verification code was already used'
      );
    }
    if (challenge.status === 'invalidated') {
      return createPublicError(
        409,
        'SMS_CHALLENGE_INVALIDATED',
        'A newer verification code has replaced this one'
      );
    }
    if (challenge.status === 'send_failed') {
      return createPublicError(
        409,
        'SMS_CHALLENGE_SEND_FAILED',
        'The verification code was not sent'
      );
    }
    return createPublicError(
      409,
      'SMS_CHALLENGE_NOT_READY',
      'The verification request is not ready'
    );
  }

  async function login(requestBody) {
    requireSmsEnabled();
    if (
      !requestBody
      || typeof requestBody !== 'object'
      || Array.isArray(requestBody)
      || typeof requestBody.phone !== 'string'
      || typeof requestBody.challengeId !== 'string'
      || requestBody.challengeId === ''
      || requestBody.challengeId.trim() !== requestBody.challengeId
      || requestBody.challengeId.length > 128
      || typeof requestBody.code !== 'string'
      || !/^\d{6}$/.test(requestBody.code)
    ) {
      throw createPublicError(
        400,
        'INVALID_LOGIN_REQUEST',
        'Phone, challengeId, and a six-digit code are required'
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

    const nowIso = new Date(clock()).toISOString();
    smsChallengeStore.expireActive(nowIso);
    let challenge = smsChallengeStore.findById(
      requestBody.challengeId
    );
    if (!challenge || challenge.phoneNormalized !== phoneE164) {
      throw challengeStateError(null);
    }
    if (challenge.status !== 'sent') {
      throw challengeStateError(challenge);
    }
    if (challenge.provider !== smsRuntimeConfig.mode) {
      throw createPublicError(
        503,
        'SMS_PROVIDER_MISMATCH',
        'The verification provider is unavailable'
      );
    }

    let verification;
    try {
      verification = await smsProvider.verify({
        challengeId: challenge.id,
        code: requestBody.code,
        phoneNumber: phoneE164,
      });
    } catch {
      throw createPublicError(
        502,
        'SMS_CHECK_FAILED',
        'The verification code could not be checked'
      );
    }
    const passed = verification
      && verification.code === 'OK'
      && verification.success === true
      && verification.verifyResult === 'PASS';
    if (!passed) {
      challenge = runInTransaction(() => (
        smsChallengeStore.recordFailedAttempt({
          challengeId: challenge.id,
          phoneNormalized: phoneE164,
          nowIso: new Date(clock()).toISOString(),
        })
      ));
      if (challenge && challenge.status === 'locked') {
        throw challengeStateError(challenge);
      }
      throw createPublicError(
        401,
        'INVALID_VERIFICATION_CODE',
        'The verification code is incorrect'
      );
    }

    let user;
    const consumedAt = new Date(clock()).toISOString();
    const consumed = runInTransaction(() => {
      const changes = smsChallengeStore.consume({
        challengeId: challenge.id,
        phoneNormalized: phoneE164,
        nowIso: consumedAt,
      });
      if (changes !== 1) {
        return false;
      }
      user = userStore.findByPhoneE164(phoneE164);
      if (!user) {
        user = {
          id: idGenerator(),
          phoneE164,
          status: 'active',
          createdAt: consumedAt,
          updatedAt: consumedAt,
        };
        userStore.save(user);
      }
      accountService.ensureAccountForUser(user.id);
      return true;
    });
    if (!consumed) {
      challenge = smsChallengeStore.findById(challenge.id);
      throw challengeStateError(challenge);
    }

    const {
      rawToken,
      principal,
      session,
    } = sessionService.createUserSession(user.id);
    return {
      rawToken,
      authMode: 'sms_phone',
      principal,
      profile: {
        phoneMasked: maskChineseMobile(user.phoneE164),
      },
      session,
      verifyResult: verification.verifyResult,
    };
  }

  return {
    login,
    sendSmsCode,
  };
}

module.exports = {
  createAuthService,
  digestRequestIp,
  maskChineseMobile,
  normalizeChineseMobile,
  SMS_CHALLENGE_TTL_SECONDS,
  SMS_IP_HOURLY_LIMIT,
  SMS_MAX_ATTEMPTS,
  SMS_PHONE_DAILY_LIMIT,
  SMS_PHONE_HOURLY_LIMIT,
  SMS_RESEND_AFTER_SECONDS,
};
