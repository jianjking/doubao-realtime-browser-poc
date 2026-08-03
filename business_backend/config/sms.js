'use strict';

const SMS_PROVIDER_MODES = Object.freeze([
  'disabled',
  'mock',
  'aliyun',
]);

const ALIYUN_SMS_SETTINGS = Object.freeze({
  endpoint: 'dypnsapi.aliyuncs.com',
  signName: '恒创联众',
  templateCode: '100001',
  templateParam: '{"code":"##code##","min":"5"}',
  countryCode: '86',
  codeLength: 6,
  validTime: 300,
  duplicatePolicy: 1,
  codeType: 1,
  returnVerifyCode: false,
});

function readMode(env) {
  const rawMode = env.SMS_PROVIDER_MODE;
  if (rawMode === undefined) {
    return 'disabled';
  }
  if (
    typeof rawMode !== 'string'
    || !SMS_PROVIDER_MODES.includes(rawMode)
  ) {
    throw new Error(
      'SMS_PROVIDER_MODE must be disabled, mock, or aliyun'
    );
  }
  return rawMode;
}

function readBooleanFlag(env, name) {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === '0') {
    return false;
  }
  if (rawValue === '1') {
    return true;
  }
  throw new Error(`${name} must be 0 or 1`);
}

function readCredential(env, name) {
  const value = env[name];
  if (
    typeof value !== 'string'
    || value === ''
    || value.trim() !== value
  ) {
    throw new Error(`${name} is required in aliyun SMS mode`);
  }
  return value;
}

function parseSmsRuntimeConfig(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }

  const mode = readMode(env);
  const mockExposeCode = readBooleanFlag(
    env,
    'SMS_MOCK_EXPOSE_CODE'
  );
  const nodeEnv = typeof env.NODE_ENV === 'string'
    ? env.NODE_ENV
    : '';

  if (nodeEnv === 'production' && mode === 'mock') {
    throw new Error('SMS mock mode is forbidden in production');
  }

  const aliyun = {
    ...ALIYUN_SMS_SETTINGS,
    accessKeyId: null,
    accessKeySecret: null,
    configured: false,
  };
  if (mode === 'aliyun') {
    aliyun.accessKeyId = readCredential(
      env,
      'ALIBABA_CLOUD_ACCESS_KEY_ID'
    );
    aliyun.accessKeySecret = readCredential(
      env,
      'ALIBABA_CLOUD_ACCESS_KEY_SECRET'
    );
    aliyun.configured = true;
  }

  return {
    aliyun,
    mockExposeCode,
    mode,
    nodeEnv,
  };
}

module.exports = {
  ALIYUN_SMS_SETTINGS,
  SMS_PROVIDER_MODES,
  parseSmsRuntimeConfig,
};
