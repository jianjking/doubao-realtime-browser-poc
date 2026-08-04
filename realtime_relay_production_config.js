'use strict';

const net = require('node:net');
const {
  createFortuneAsrConfigFromEnv,
} = require('./fortune_asr_client');
const {
  createRelayInternalCallLifecycleDependency,
} = require('./relay_internal_call_lifecycle_bootstrap');

const DEFAULT_PRODUCTION_HOST = '127.0.0.1';
const DEFAULT_PRODUCTION_PORT = 3001;
const ROLE_SWITCHES = Object.freeze([
  ['DOUBAO_ENABLE_SUNWUKONG', 'DOUBAO_SUNWUKONG_SPEAKER_ID'],
  ['DOUBAO_ENABLE_GUANYIN', 'DOUBAO_GUANYIN_SPEAKER_ID'],
  ['DOUBAO_ENABLE_CAISHEN', 'DOUBAO_CAISHEN_SPEAKER_ID'],
  ['DOUBAO_ENABLE_RULAI', 'DOUBAO_RULAI_SPEAKER_ID'],
  ['DOUBAO_ENABLE_ZHUBAJIE', 'DOUBAO_ZHUBAJIE_SPEAKER_ID'],
  ['DOUBAO_ENABLE_SHAWUJING', 'DOUBAO_SHAWUJING_SPEAKER_ID'],
  ['DOUBAO_ENABLE_TANGSENG', 'DOUBAO_TANGSENG_SPEAKER_ID'],
]);

function readRequiredString(env, name) {
  const value = env[name];
  if (
    typeof value !== 'string'
    || value === ''
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function isLoopbackAddress(host) {
  const family = net.isIP(host);
  if (family === 4) {
    return host.split('.')[0] === '127';
  }
  return family === 6 && host.toLowerCase() === '::1';
}

function readHost(env) {
  const host = env.REALTIME_RELAY_HOST === undefined
    ? DEFAULT_PRODUCTION_HOST
    : readRequiredString(env, 'REALTIME_RELAY_HOST');
  if (!isLoopbackAddress(host)) {
    throw new TypeError('REALTIME_RELAY_HOST must be a loopback IP address');
  }
  return host;
}

function readPort(env) {
  if (env.REALTIME_RELAY_PORT === undefined) {
    return DEFAULT_PRODUCTION_PORT;
  }
  const value = readRequiredString(env, 'REALTIME_RELAY_PORT');
  if (!/^[1-9]\d{0,4}$/.test(value)) {
    throw new TypeError('REALTIME_RELAY_PORT must be an integer from 1 to 65535');
  }
  const port = Number(value);
  if (port > 65535) {
    throw new TypeError('REALTIME_RELAY_PORT must be an integer from 1 to 65535');
  }
  return port;
}

function validateRoleConfiguration(env) {
  for (const [enableName, speakerName] of ROLE_SWITCHES) {
    const enabled = env[enableName];
    if (enabled !== undefined && enabled !== '0' && enabled !== '1') {
      throw new TypeError(`${enableName} must be 0 or 1`);
    }
    if (enabled === '1') {
      readRequiredString(env, speakerName);
    }
  }
}

function validateProductionRelayConfig(env = process.env) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }
  if (env.NODE_ENV !== 'production') {
    throw new TypeError('NODE_ENV must be production');
  }

  const host = readHost(env);
  const port = readPort(env);
  readRequiredString(env, 'VOLCENGINE_API_KEY');
  readRequiredString(env, 'BUSINESS_BACKEND_INTERNAL_BASE_URL');
  readRequiredString(env, 'BUSINESS_INTERNAL_API_TOKEN');

  try {
    createRelayInternalCallLifecycleDependency({
      env,
      fetchImpl: async () => {
        throw new Error('production validation must not perform network I/O');
      },
    });
  } catch {
    throw new TypeError(
      'BUSINESS_BACKEND_INTERNAL_BASE_URL and '
      + 'BUSINESS_INTERNAL_API_TOKEN are invalid'
    );
  }

  if (env.DOUBAO_ENABLE_FORTUNE_ASR !== '1') {
    throw new TypeError('DOUBAO_ENABLE_FORTUNE_ASR must be 1');
  }
  try {
    createFortuneAsrConfigFromEnv(env);
  } catch {
    throw new TypeError(
      'DOUBAO_ASR_API_KEY, DOUBAO_ASR_RESOURCE_ID, or '
      + 'DOUBAO_ASR_WS_URL is invalid'
    );
  }
  validateRoleConfiguration(env);

  return Object.freeze({ host, port });
}

module.exports = {
  DEFAULT_PRODUCTION_HOST,
  DEFAULT_PRODUCTION_PORT,
  isLoopbackAddress,
  validateProductionRelayConfig,
};
