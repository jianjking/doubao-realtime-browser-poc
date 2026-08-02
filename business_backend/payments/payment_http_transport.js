'use strict';

const {
  createPaymentProtocolError,
} = require('./payment_errors');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

function normalizeAllowedOrigins(allowedOrigins) {
  if (allowedOrigins === undefined) {
    return null;
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new TypeError('allowedOrigins must be a non-empty array');
  }
  return new Set(allowedOrigins.map((value) => {
    if (typeof value !== 'string') {
      throw new TypeError('allowedOrigins must contain strings');
    }
    return new URL(value).origin;
  }));
}

async function readLimitedResponseBody(response, maximumBytes) {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null
    && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > maximumBytes
  ) {
    throw createPaymentProtocolError(
      502,
      'PAYMENT_PLATFORM_RESPONSE_TOO_LARGE',
      'Payment platform response is too large'
    );
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maximumBytes) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_RESPONSE_TOO_LARGE',
        'Payment platform response is too large'
      );
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_RESPONSE_TOO_LARGE',
        'Payment platform response is too large'
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function createPaymentHttpTransport({
  fetchImpl = globalThis.fetch,
  allowedOrigins,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  if (!Number.isSafeInteger(defaultTimeoutMs) || defaultTimeoutMs < 1) {
    throw new TypeError('defaultTimeoutMs must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new TypeError('maxResponseBytes must be a positive safe integer');
  }
  const allowedOriginSet = normalizeAllowedOrigins(allowedOrigins);

  async function request({
    method,
    url,
    headers = {},
    body = '',
    timeoutMs = defaultTimeoutMs,
  } = {}) {
    const normalizedMethod = typeof method === 'string'
      ? method.toUpperCase()
      : '';
    if (!['GET', 'POST'].includes(normalizedMethod)) {
      throw new TypeError('Payment HTTP method must be GET or POST');
    }
    const parsedUrl = new URL(url);
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
      throw new TypeError('Payment HTTP URL must use HTTP or HTTPS');
    }
    if (allowedOriginSet && !allowedOriginSet.has(parsedUrl.origin)) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_NETWORK_DESTINATION_REJECTED',
        'Payment platform destination is not allowed'
      );
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError('timeoutMs must be a positive safe integer');
    }
    if (!(typeof body === 'string' || Buffer.isBuffer(body))) {
      throw new TypeError('Payment HTTP body must be a string or Buffer');
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(parsedUrl, {
        method: normalizedMethod,
        headers,
        body: normalizedMethod === 'GET' ? undefined : body,
        redirect: 'manual',
        signal: controller.signal,
      });
      const responseBody = await readLimitedResponseBody(
        response,
        maxResponseBytes
      );
      return Object.freeze({
        statusCode: response.status,
        headers: Object.freeze(Object.fromEntries(response.headers.entries())),
        body: responseBody,
        bodyText: responseBody.toString('utf8'),
      });
    } catch (error) {
      if (error && typeof error.code === 'string' && error.publicMessage) {
        throw error;
      }
      throw createPaymentProtocolError(
        timedOut ? 504 : 502,
        timedOut ? 'PAYMENT_NETWORK_TIMEOUT' : 'PAYMENT_NETWORK_ERROR',
        timedOut
          ? 'Payment platform request timed out'
          : 'Payment platform request failed',
        { cause: error, retryable: true }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return Object.freeze({ request });
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  createPaymentHttpTransport,
};
