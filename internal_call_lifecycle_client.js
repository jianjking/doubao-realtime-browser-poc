'use strict';

const BASE_URL_ERROR_MESSAGE =
  'baseUrl must be an absolute HTTP(S) origin';
const TOKEN_ERROR_MESSAGE =
  'internal API token must be a base64url string of at least 32 characters';
const TIMEOUT_ERROR_MESSAGE =
  'timeoutMs must be an integer between 100 and 30000';
const FETCH_ERROR_MESSAGE = 'fetchImpl must be a function';
const CALL_ID_ERROR_MESSAGE = 'callId must be a non-empty string';

class InternalCallLifecycleClientError extends Error {
  constructor(message, {
    code,
    statusCode = null,
    remoteCode = null,
    retryable,
  } = {}) {
    super(message);
    this.name = 'InternalCallLifecycleClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.remoteCode = remoteCode;
    this.retryable = retryable;
  }
}

function validateBaseUrl(baseUrl) {
  if (
    typeof baseUrl !== 'string'
    || baseUrl === ''
    || baseUrl.trim() !== baseUrl
    || /[\u0000-\u0020\u007f]/.test(baseUrl)
    || baseUrl.includes('?')
    || baseUrl.includes('#')
  ) {
    throw new TypeError(BASE_URL_ERROR_MESSAGE);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new TypeError(BASE_URL_ERROR_MESSAGE);
  }

  if (
    (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
    || parsedUrl.username !== ''
    || parsedUrl.password !== ''
    || parsedUrl.search !== ''
    || parsedUrl.hash !== ''
    || parsedUrl.pathname !== '/'
    || parsedUrl.origin === 'null'
  ) {
    throw new TypeError(BASE_URL_ERROR_MESSAGE);
  }

  return parsedUrl.origin;
}

function validateToken(token) {
  if (
    typeof token !== 'string'
    || token.length < 32
    || !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new TypeError(TOKEN_ERROR_MESSAGE);
  }
}

function validateTimeoutMs(timeoutMs) {
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 100
    || timeoutMs > 30000
  ) {
    throw new TypeError(TIMEOUT_ERROR_MESSAGE);
  }
}

function validateCallId(callId) {
  if (
    typeof callId !== 'string'
    || callId === ''
    || callId.trim() === ''
    || callId.trim() !== callId
  ) {
    throw new TypeError(CALL_ID_ERROR_MESSAGE);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function buildPublicCall(responseBody, callId, targetStatus) {
  if (!isPlainObject(responseBody) || !isPlainObject(responseBody.call)) {
    return null;
  }

  const call = responseBody.call;
  if (
    call.id !== callId
    || !isPlainObject(call.role)
    || !isNonEmptyString(call.role.slug)
    || !isNonEmptyString(call.role.displayName)
    || call.status !== targetStatus
    || !isNonEmptyString(call.createdAt)
    || !(
      call.startedAt === null
      || isNonEmptyString(call.startedAt)
    )
    || !(
      call.endedAt === null
      || isNonEmptyString(call.endedAt)
    )
  ) {
    return null;
  }

  return {
    id: call.id,
    role: {
      slug: call.role.slug,
      displayName: call.role.displayName,
    },
    status: call.status,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
  };
}

function createTimeoutError() {
  return new InternalCallLifecycleClientError(
    'Internal call lifecycle request timed out',
    {
      code: 'INTERNAL_CALL_TIMEOUT',
      statusCode: null,
      remoteCode: null,
      retryable: true,
    }
  );
}

function createNetworkError() {
  return new InternalCallLifecycleClientError(
    'Internal call lifecycle network request failed',
    {
      code: 'INTERNAL_CALL_NETWORK_ERROR',
      statusCode: null,
      remoteCode: null,
      retryable: true,
    }
  );
}

function createInvalidResponseError(statusCode) {
  return new InternalCallLifecycleClientError(
    'Internal call lifecycle response was invalid',
    {
      code: 'INTERNAL_CALL_INVALID_RESPONSE',
      statusCode,
      remoteCode: null,
      retryable: true,
    }
  );
}

function extractSafeRemoteCode(responseBody, token) {
  try {
    if (
      !isPlainObject(responseBody)
      || !isPlainObject(responseBody.error)
      || typeof responseBody.error.code !== 'string'
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(responseBody.error.code)
      || responseBody.error.code.includes(token)
    ) {
      return null;
    }
    return responseBody.error.code;
  } catch {
    return null;
  }
}

function createHttpError(statusCode, remoteCode) {
  const retryable = (
    statusCode === 408
    || statusCode === 429
    || (statusCode >= 500 && statusCode <= 599)
  );
  const remoteSuffix = remoteCode === null ? '' : ` (${remoteCode})`;

  return new InternalCallLifecycleClientError(
    `Internal call lifecycle request failed with HTTP `
      + `${statusCode}${remoteSuffix}`,
    {
      code: 'INTERNAL_CALL_HTTP_ERROR',
      statusCode,
      remoteCode,
      retryable,
    }
  );
}

function createInternalCallLifecycleClient({
  baseUrl,
  token,
  timeoutMs = 3000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const origin = validateBaseUrl(baseUrl);
  validateToken(token);
  validateTimeoutMs(timeoutMs);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(FETCH_ERROR_MESSAGE);
  }

  async function requestLifecycle(callId, targetStatus) {
    validateCallId(callId);

    const requestUrl = `${origin}/internal/calls/`
      + `${encodeURIComponent(callId)}/${targetStatus}`;
    const controller = new AbortController();
    let timeoutTriggered = false;
    let timeoutId;

    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
        reject(createTimeoutError());
      }, timeoutMs);
    });

    const requestPromise = (async () => {
      let response;
      try {
        response = await fetchImpl(requestUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        if (timeoutTriggered) {
          throw createTimeoutError();
        }
        throw createNetworkError();
      }

      let statusCode;
      let jsonMethod;
      try {
        if (response === null || typeof response !== 'object') {
          throw new TypeError('response must be an object');
        }
        statusCode = response.status;
        if (
          !Number.isInteger(statusCode)
          || statusCode < 100
          || statusCode > 599
        ) {
          statusCode = undefined;
          throw new TypeError('response status was invalid');
        }
        jsonMethod = response.json;
        if (typeof jsonMethod !== 'function') {
          throw new TypeError('response json method was invalid');
        }
      } catch {
        throw createInvalidResponseError(
          Number.isInteger(statusCode) ? statusCode : null
        );
      }

      if (statusCode < 200 || statusCode > 299) {
        let responseBody = null;
        try {
          responseBody = await jsonMethod.call(response);
        } catch {
          if (timeoutTriggered) {
            throw createTimeoutError();
          }
        }
        if (timeoutTriggered) {
          throw createTimeoutError();
        }
        const remoteCode = extractSafeRemoteCode(responseBody, token);
        throw createHttpError(statusCode, remoteCode);
      }

      let responseBody;
      try {
        responseBody = await jsonMethod.call(response);
      } catch {
        if (timeoutTriggered) {
          throw createTimeoutError();
        }
        throw createInvalidResponseError(statusCode);
      }
      if (timeoutTriggered) {
        throw createTimeoutError();
      }

      let publicCall;
      try {
        publicCall = buildPublicCall(
          responseBody,
          callId,
          targetStatus
        );
      } catch {
        publicCall = null;
      }
      if (publicCall === null) {
        throw createInvalidResponseError(statusCode);
      }
      return publicCall;
    })();

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return Object.freeze({
    markConnecting(callId) {
      return requestLifecycle(callId, 'connecting');
    },
    markActive(callId) {
      return requestLifecycle(callId, 'active');
    },
    markEnded(callId) {
      return requestLifecycle(callId, 'ended');
    },
    markFailed(callId) {
      return requestLifecycle(callId, 'failed');
    },
  });
}

function createInternalCallLifecycleClientFromEnv({
  env = process.env,
  timeoutMs,
  fetchImpl,
} = {}) {
  const baseUrl = env && env.BUSINESS_BACKEND_INTERNAL_BASE_URL;
  const token = env && env.BUSINESS_INTERNAL_API_TOKEN;

  return createInternalCallLifecycleClient({
    baseUrl,
    token,
    timeoutMs: timeoutMs === undefined ? 3000 : timeoutMs,
    fetchImpl: fetchImpl === undefined ? globalThis.fetch : fetchImpl,
  });
}

module.exports = {
  InternalCallLifecycleClientError,
  createInternalCallLifecycleClient,
  createInternalCallLifecycleClientFromEnv,
};
