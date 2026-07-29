'use strict';

const crypto = require('node:crypto');

const TTS_ENDPOINT =
  'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 4096;

class FortuneTtsClientError extends Error {
  constructor(message, {
    code,
    upstreamStatus,
    providerCode,
    upstreamSummary,
    logId,
  } = {}) {
    super(message);
    this.name = 'FortuneTtsClientError';
    this.code = code;
    if (upstreamStatus !== undefined) {
      this.upstreamStatus = upstreamStatus;
    }
    if (providerCode !== undefined) {
      this.providerCode = providerCode;
    }
    if (upstreamSummary !== undefined) {
      this.upstreamSummary = upstreamSummary;
    }
    if (logId !== undefined) {
      this.logId = logId;
    }
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateNonEmptyConfiguration(value, name) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.trim() !== value
  ) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function parseTimeoutMs(rawTimeoutMs) {
  const timeoutMs = rawTimeoutMs === undefined
    ? DEFAULT_TIMEOUT_MS
    : typeof rawTimeoutMs === 'string' && /^\d+$/.test(rawTimeoutMs)
      ? Number(rawTimeoutMs)
      : rawTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 100
    || timeoutMs > 60000
  ) {
    throw new TypeError(
      'FORTUNE_TTS_TIMEOUT_MS must be an integer between 100 and 60000'
    );
  }
  return timeoutMs;
}

function sanitizeDiagnostic(value, sensitiveValues = []) {
  if (typeof value !== 'string') {
    return undefined;
  }
  let sanitized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  for (const sensitiveValue of sensitiveValues) {
    if (
      typeof sensitiveValue === 'string'
      && sensitiveValue !== ''
    ) {
      sanitized = sanitized.split(sensitiveValue).join('[REDACTED]');
    }
  }
  sanitized = sanitized.replace(/\s+/g, ' ').slice(0, 300);
  return sanitized === '' ? undefined : sanitized;
}

function sanitizeIdentifier(value) {
  if (
    (typeof value !== 'string' && typeof value !== 'number')
    || String(value).length > 128
  ) {
    return undefined;
  }
  const identifier = String(value).trim();
  return /^[A-Za-z0-9_.:-]+$/.test(identifier)
    ? identifier
    : undefined;
}

function getHeader(response, name) {
  if (
    !response
    || !response.headers
    || typeof response.headers.get !== 'function'
  ) {
    return undefined;
  }
  const value = response.headers.get(name);
  return sanitizeIdentifier(value);
}

async function readLimitedErrorBody(response) {
  if (
    response.body
    && typeof response.body.getReader === 'function'
  ) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (totalBytes < MAX_ERROR_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!(value instanceof Uint8Array)) {
          break;
        }
        const remaining = MAX_ERROR_BODY_BYTES - totalBytes;
        const chunk = Buffer.from(value).subarray(0, remaining);
        chunks.push(chunk);
        totalBytes += chunk.length;
        if (value.length > remaining) {
          break;
        }
      }
    } catch {
      return '';
    } finally {
      try {
        await reader.cancel();
      } catch {
        // The response stream may already be closed.
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof response.text === 'function') {
    try {
      return (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
    } catch {
      return '';
    }
  }
  return '';
}

function extractProviderDiagnostic(rawBody, sensitiveValues) {
  let providerCode;
  let summarySource = rawBody;
  try {
    const parsed = JSON.parse(rawBody);
    if (isPlainObject(parsed)) {
      providerCode = sanitizeIdentifier(
        parsed.code
        ?? parsed.error_code
        ?? parsed.error?.code
        ?? parsed.ResponseMetadata?.Error?.Code
      );
      const message = (
        parsed.message
        ?? parsed.error_message
        ?? parsed.error?.message
        ?? parsed.ResponseMetadata?.Error?.Message
      );
      if (typeof message === 'string') {
        summarySource = message;
      }
    }
  } catch {
    // A non-JSON upstream error is retained only as a short redacted summary.
  }
  return {
    providerCode,
    upstreamSummary: sanitizeDiagnostic(
      summarySource,
      sensitiveValues
    ),
  };
}

function decodeStrictBase64(value) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
      .test(value)
  ) {
    throw new FortuneTtsClientError(
      'TTS response contained invalid audio data',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length === 0
    || decoded.toString('base64') !== value
  ) {
    throw new FortuneTtsClientError(
      'TTS response contained invalid audio data',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  return decoded;
}

function processResponseMessage(message, state, options) {
  if (!isPlainObject(message) || !Number.isInteger(message.code)) {
    throw new FortuneTtsClientError(
      'TTS response was invalid',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  if (message.code === 20000000) {
    state.sawFinalSuccess = true;
    return;
  }
  if (message.code !== 0) {
    throw new FortuneTtsClientError(
      'TTS provider rejected the request',
      {
        code: 'FORTUNE_TTS_BUSINESS_ERROR',
        providerCode: sanitizeIdentifier(message.code),
        upstreamSummary: sanitizeDiagnostic(
          message.message,
          options.sensitiveValues
        ),
      }
    );
  }
  if (message.data === null || message.data === undefined) {
    return;
  }
  if (typeof message.data !== 'string') {
    throw new FortuneTtsClientError(
      'TTS response was invalid',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  if (message.data === '') {
    return;
  }
  const audioChunk = decodeStrictBase64(message.data);
  if (
    state.totalAudioBytes + audioChunk.length
    > options.maxAudioBytes
  ) {
    throw new FortuneTtsClientError(
      'TTS response exceeded the audio size limit',
      { code: 'FORTUNE_TTS_SIZE_LIMIT' }
    );
  }
  state.audioChunks.push(audioChunk);
  state.totalAudioBytes += audioChunk.length;
}

function parseResponseLine(line, state, options) {
  const normalizedLine = line.endsWith('\r')
    ? line.slice(0, -1)
    : line;
  if (normalizedLine.trim() === '') {
    return;
  }
  let message;
  try {
    message = JSON.parse(normalizedLine);
  } catch {
    throw new FortuneTtsClientError(
      'TTS response was invalid',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  processResponseMessage(message, state, options);
}

async function parseAudioResponseStream(body, {
  maxAudioBytes,
  sensitiveValues,
}) {
  if (!body || typeof body.getReader !== 'function') {
    throw new FortuneTtsClientError(
      'TTS response body was invalid',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const state = {
    audioChunks: [],
    totalAudioBytes: 0,
    sawFinalSuccess: false,
  };
  const options = { maxAudioBytes, sensitiveValues };
  const maxPendingCharacters =
    Math.ceil(maxAudioBytes * 4 / 3) + 65536;
  let pending = '';

  try {
    while (!state.sawFinalSuccess) {
      let result;
      try {
        result = await reader.read();
      } catch {
        throw new FortuneTtsClientError(
          'TTS response stream failed',
          { code: 'FORTUNE_TTS_NETWORK_ERROR' }
        );
      }
      if (result.done) {
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw new FortuneTtsClientError(
          'TTS response stream was invalid',
          { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
        );
      }
      try {
        pending += decoder.decode(result.value, { stream: true });
      } catch {
        throw new FortuneTtsClientError(
          'TTS response encoding was invalid',
          { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
        );
      }

      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        parseResponseLine(line, state, options);
        if (state.sawFinalSuccess) {
          break;
        }
        newlineIndex = pending.indexOf('\n');
      }
      if (pending.length > maxPendingCharacters) {
        throw new FortuneTtsClientError(
          'TTS response exceeded the message size limit',
          { code: 'FORTUNE_TTS_SIZE_LIMIT' }
        );
      }
    }

    if (!state.sawFinalSuccess) {
      try {
        pending += decoder.decode();
      } catch {
        throw new FortuneTtsClientError(
          'TTS response encoding was invalid',
          { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
        );
      }
      parseResponseLine(pending, state, options);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The response stream may already be closed.
    }
  }

  if (!state.sawFinalSuccess) {
    throw new FortuneTtsClientError(
      'TTS response did not contain a final success message',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  if (state.totalAudioBytes === 0) {
    throw new FortuneTtsClientError(
      'TTS response did not contain audio',
      { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
    );
  }
  return Buffer.concat(state.audioChunks, state.totalAudioBytes);
}

function createFortuneTtsClient({
  apiKey,
  speakerId,
  resourceId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  maxAudioBytes = MAX_AUDIO_BYTES,
  randomUUID = crypto.randomUUID,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  validateNonEmptyConfiguration(apiKey, 'FORTUNE_TTS_API_KEY');
  validateNonEmptyConfiguration(
    speakerId,
    'FORTUNE_TTS_SPEAKER_ID'
  );
  validateNonEmptyConfiguration(
    resourceId,
    'FORTUNE_TTS_RESOURCE_ID'
  );
  const normalizedTimeoutMs = parseTimeoutMs(timeoutMs);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  if (
    !Number.isSafeInteger(maxAudioBytes)
    || maxAudioBytes < 1
    || maxAudioBytes > MAX_AUDIO_BYTES
  ) {
    throw new TypeError(
      'maxAudioBytes must be a positive integer no greater than 16 MiB'
    );
  }
  if (typeof randomUUID !== 'function') {
    throw new TypeError('randomUUID must be a function');
  }
  if (
    typeof setTimeoutImpl !== 'function'
    || typeof clearTimeoutImpl !== 'function'
  ) {
    throw new TypeError('timer implementations must be functions');
  }

  async function synthesize({ text } = {}) {
    if (
      typeof text !== 'string'
      || text === ''
      || text.trim() !== text
    ) {
      throw new TypeError('text must be a non-empty string');
    }
    const requestId = randomUUID();
    if (
      typeof requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(requestId)
    ) {
      throw new TypeError('randomUUID must return a UUID v4 string');
    }

    const controller = new AbortController();
    let timeoutId;
    let timeoutTriggered = false;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeoutImpl(() => {
        timeoutTriggered = true;
        controller.abort();
        reject(new FortuneTtsClientError(
          'TTS request timed out',
          { code: 'FORTUNE_TTS_TIMEOUT' }
        ));
      }, normalizedTimeoutMs);
    });

    const requestPromise = (async () => {
      let response;
      try {
        response = await fetchImpl(TTS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
            'X-Api-Resource-Id': resourceId,
            'X-Api-Request-Id': requestId,
          },
          body: JSON.stringify({
            user: { uid: 'fortune-prototype' },
            req_params: {
              text,
              speaker: speakerId,
              audio_params: {
                format: 'mp3',
                sample_rate: 24000,
              },
            },
          }),
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        if (timeoutTriggered) {
          throw new FortuneTtsClientError(
            'TTS request timed out',
            { code: 'FORTUNE_TTS_TIMEOUT' }
          );
        }
        throw new FortuneTtsClientError(
          'TTS network request failed',
          { code: 'FORTUNE_TTS_NETWORK_ERROR' }
        );
      }

      if (
        !response
        || typeof response !== 'object'
        || !Number.isInteger(response.status)
      ) {
        throw new FortuneTtsClientError(
          'TTS response was invalid',
          { code: 'FORTUNE_TTS_INVALID_RESPONSE' }
        );
      }
      if (response.status < 200 || response.status > 299) {
        const rawBody = await readLimitedErrorBody(response);
        const diagnostic = extractProviderDiagnostic(
          rawBody,
          [apiKey, text]
        );
        throw new FortuneTtsClientError(
          'TTS HTTP request failed',
          {
            code: 'FORTUNE_TTS_HTTP_ERROR',
            upstreamStatus: response.status,
            ...diagnostic,
            logId: getHeader(response, 'x-tt-logid'),
          }
        );
      }

      const audioBuffer = await parseAudioResponseStream(
        response.body,
        {
          maxAudioBytes,
          sensitiveValues: [apiKey, text],
        }
      );
      return {
        audioBuffer,
        contentType: 'audio/mpeg',
      };
    })();

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      clearTimeoutImpl(timeoutId);
    }
  }

  return Object.freeze({ synthesize });
}

function createFortuneTtsClientFromEnv({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }
  let apiKey;
  let speakerId;
  let resourceId;
  let rawTimeoutMs;
  try {
    apiKey = env.FORTUNE_TTS_API_KEY;
    speakerId = env.FORTUNE_TTS_SPEAKER_ID;
    resourceId = env.FORTUNE_TTS_RESOURCE_ID;
    rawTimeoutMs = env.FORTUNE_TTS_TIMEOUT_MS;
  } catch {
    throw new TypeError('Unable to read Fortune TTS configuration');
  }

  apiKey = apiKey === '' ? undefined : apiKey;
  speakerId = speakerId === '' ? undefined : speakerId;
  resourceId = resourceId === '' ? undefined : resourceId;
  rawTimeoutMs = rawTimeoutMs === '' ? undefined : rawTimeoutMs;
  const configuredValues = [apiKey, speakerId, resourceId]
    .filter((value) => value !== undefined);
  if (configuredValues.length === 0 && rawTimeoutMs === undefined) {
    return null;
  }
  if (configuredValues.length !== 3) {
    throw new TypeError(
      'FORTUNE_TTS_API_KEY, FORTUNE_TTS_SPEAKER_ID, '
        + 'and FORTUNE_TTS_RESOURCE_ID must be configured together'
    );
  }
  return createFortuneTtsClient({
    apiKey,
    speakerId,
    resourceId,
    timeoutMs: parseTimeoutMs(rawTimeoutMs),
    fetchImpl,
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  FortuneTtsClientError,
  MAX_AUDIO_BYTES,
  TTS_ENDPOINT,
  createFortuneTtsClient,
  createFortuneTtsClientFromEnv,
};
