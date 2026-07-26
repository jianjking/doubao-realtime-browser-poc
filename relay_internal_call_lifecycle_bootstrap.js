'use strict';

const {
  createInternalCallLifecycleClientFromEnv,
} = require('./internal_call_lifecycle_client');

const ENV_ERROR_MESSAGE = 'env must be an object';
const READ_ERROR_MESSAGE =
  'Unable to read Relay internal lifecycle configuration';
const PAIR_ERROR_MESSAGE =
  'BUSINESS_BACKEND_INTERNAL_BASE_URL and '
  + 'BUSINESS_INTERNAL_API_TOKEN must be configured together';

function createRelayInternalCallLifecycleDependency({
  env = process.env,
  timeoutMs = 3000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError(ENV_ERROR_MESSAGE);
  }

  let baseUrl;
  let token;
  try {
    baseUrl = env.BUSINESS_BACKEND_INTERNAL_BASE_URL;
    token = env.BUSINESS_INTERNAL_API_TOKEN;
  } catch {
    throw new TypeError(READ_ERROR_MESSAGE);
  }

  const hasBaseUrl = baseUrl !== undefined;
  const hasToken = token !== undefined;
  if (!hasBaseUrl && !hasToken) {
    return Object.freeze({
      enabled: false,
      client: null,
    });
  }
  if (hasBaseUrl !== hasToken) {
    throw new TypeError(PAIR_ERROR_MESSAGE);
  }

  const clientEnv = {
    BUSINESS_BACKEND_INTERNAL_BASE_URL: baseUrl,
    BUSINESS_INTERNAL_API_TOKEN: token,
  };
  const client = createInternalCallLifecycleClientFromEnv({
    env: clientEnv,
    timeoutMs,
    fetchImpl,
  });
  return Object.freeze({
    enabled: true,
    client,
  });
}

module.exports = {
  createRelayInternalCallLifecycleDependency,
};
