'use strict';

const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { gzipSync, gunzipSync } = require('node:zlib');
const { WebSocket } = require('ws');

const DEFAULT_FORTUNE_ASR_URL =
  'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

const FORTUNE_ASR_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  FINISHING: 'finishing',
  FINISHED: 'finished',
  FAILED: 'failed',
  CLOSED: 'closed',
});

const MESSAGE_TYPES = Object.freeze({
  FULL_CLIENT_REQUEST: 0x1,
  AUDIO_ONLY_REQUEST: 0x2,
  FULL_SERVER_RESPONSE: 0x9,
  SERVER_ERROR: 0xf,
});

const MESSAGE_FLAGS = Object.freeze({
  NO_SEQUENCE: 0x0,
  POSITIVE_SEQUENCE: 0x1,
  LAST_NO_SEQUENCE: 0x2,
  LAST_WITH_NEGATIVE_SEQUENCE: 0x3,
});

const SERIALIZATION = Object.freeze({
  NONE: 0x0,
  JSON: 0x1,
});

const COMPRESSION = Object.freeze({
  NONE: 0x0,
  GZIP: 0x1,
});

class FortuneAsrClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FortuneAsrClientError';
    this.code = code;
    Object.assign(this, details);
  }
}

function readRequiredEnv(env, name) {
  const value = env && env[name];
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${name} must be a non-empty value without surrounding whitespace`);
  }
  return value;
}

function validateAsrUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new TypeError('Fortune ASR URL must be an absolute WSS URL');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Fortune ASR URL must be an absolute WSS URL');
  }

  if (
    parsed.protocol !== 'wss:'
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new TypeError('Fortune ASR URL must be an absolute WSS URL');
  }
  return parsed.toString();
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Fortune ASR config must be an object');
  }

  const apiKey = config.apiKey;
  if (
    typeof apiKey !== 'string'
    || apiKey.length === 0
    || apiKey !== apiKey.trim()
    || /[\u0000-\u001f\u007f]/.test(apiKey)
  ) {
    throw new TypeError('Fortune ASR API key is invalid');
  }

  const resourceId = config.resourceId;
  if (
    typeof resourceId !== 'string'
    || !/^[a-z0-9.]{1,128}$/.test(resourceId)
  ) {
    throw new TypeError('Fortune ASR resource ID is invalid');
  }

  return Object.freeze({
    url: validateAsrUrl(config.url || DEFAULT_FORTUNE_ASR_URL),
    apiKey,
    resourceId,
  });
}

function createFortuneAsrConfigFromEnv(env = process.env) {
  return validateConfig({
    url: env && env.DOUBAO_ASR_WS_URL
      ? readRequiredEnv(env, 'DOUBAO_ASR_WS_URL')
      : DEFAULT_FORTUNE_ASR_URL,
    apiKey: readRequiredEnv(env, 'DOUBAO_ASR_API_KEY'),
    resourceId: readRequiredEnv(env, 'DOUBAO_ASR_RESOURCE_ID'),
  });
}

function validateSequence(sequence) {
  if (
    !Number.isInteger(sequence)
    || sequence <= 0
    || sequence > 0x7fffffff
  ) {
    throw new TypeError('sequence must be a positive signed 32-bit integer');
  }
}

function validateCompression(compression) {
  if (compression !== COMPRESSION.NONE && compression !== COMPRESSION.GZIP) {
    throw new TypeError('compression must be COMPRESSION.NONE or COMPRESSION.GZIP');
  }
}

function createHeader(messageType, flags, serialization, compression) {
  return Buffer.from([
    0x11,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]);
}

function uint32Buffer(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function int32Buffer(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function compressPayload(payload, compression) {
  validateCompression(compression);
  return compression === COMPRESSION.GZIP ? gzipSync(payload) : payload;
}

function buildSequencedPacket({
  messageType,
  flags,
  serialization,
  compression,
  sequence,
  payload,
}) {
  const encodedPayload = compressPayload(payload, compression);
  return Buffer.concat([
    createHeader(messageType, flags, serialization, compression),
    int32Buffer(sequence),
    uint32Buffer(encodedPayload.length),
    encodedPayload,
  ]);
}

function encodeFullClientRequest({
  request,
  sequence,
  compression = COMPRESSION.GZIP,
}) {
  validateSequence(sequence);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }

  let payload;
  try {
    payload = Buffer.from(JSON.stringify(request), 'utf8');
  } catch {
    throw new TypeError('request must be JSON serializable');
  }

  return buildSequencedPacket({
    messageType: MESSAGE_TYPES.FULL_CLIENT_REQUEST,
    flags: MESSAGE_FLAGS.POSITIVE_SEQUENCE,
    serialization: SERIALIZATION.JSON,
    compression,
    sequence,
    payload,
  });
}

function encodeAudioOnlyRequest({
  pcmChunk,
  sequence,
  isLast = false,
  compression = COMPRESSION.GZIP,
  allowEmptyLast = false,
}) {
  validateSequence(sequence);
  if (!Buffer.isBuffer(pcmChunk)) {
    throw new TypeError('pcmChunk must be a Buffer');
  }
  if (pcmChunk.length === 0 && !(isLast && allowEmptyLast)) {
    throw new TypeError('pcmChunk must not be empty');
  }
  if (pcmChunk.length % 2 !== 0) {
    throw new TypeError('pcmChunk must contain complete 16-bit PCM samples');
  }

  return buildSequencedPacket({
    messageType: MESSAGE_TYPES.AUDIO_ONLY_REQUEST,
    flags: isLast
      ? MESSAGE_FLAGS.LAST_WITH_NEGATIVE_SEQUENCE
      : MESSAGE_FLAGS.POSITIVE_SEQUENCE,
    serialization: SERIALIZATION.NONE,
    compression,
    sequence: isLast ? -sequence : sequence,
    payload: pcmChunk,
  });
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new FortuneAsrClientError(
    'INVALID_SERVER_PACKET',
    'Fortune ASR server packet must be binary'
  );
}

function requireBytes(buffer, offset, length, field) {
  if (offset + length > buffer.length) {
    throw new FortuneAsrClientError(
      'TRUNCATED_SERVER_PACKET',
      `Fortune ASR server packet is truncated before ${field}`
    );
  }
}

function decodePayload(payload, compression) {
  if (compression === COMPRESSION.NONE) {
    return payload;
  }
  if (compression === COMPRESSION.GZIP) {
    try {
      return gunzipSync(payload);
    } catch {
      throw new FortuneAsrClientError(
        'INVALID_SERVER_COMPRESSION',
        'Fortune ASR server payload is not valid gzip data'
      );
    }
  }
  throw new FortuneAsrClientError(
    'UNSUPPORTED_SERVER_COMPRESSION',
    `Fortune ASR server compression ${compression} is unsupported`
  );
}

function readPayload(buffer, offset, compression) {
  requireBytes(buffer, offset, 4, 'payload size');
  const payloadSize = buffer.readUInt32BE(offset);
  const payloadOffset = offset + 4;
  requireBytes(buffer, payloadOffset, payloadSize, 'payload');
  if (payloadOffset + payloadSize !== buffer.length) {
    throw new FortuneAsrClientError(
      'INVALID_SERVER_PACKET',
      'Fortune ASR server packet has trailing bytes'
    );
  }
  return decodePayload(
    buffer.subarray(payloadOffset, payloadOffset + payloadSize),
    compression
  );
}

function parseJsonPayload(payload) {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    throw new FortuneAsrClientError(
      'INVALID_SERVER_JSON',
      'Fortune ASR server payload is not valid JSON'
    );
  }
}

function parseErrorMessage(payload, serialization) {
  const text = payload.toString('utf8');
  if (serialization !== SERIALIZATION.JSON) {
    return {
      message: text || 'Fortune ASR server returned an error',
      rawResult: text,
    };
  }

  try {
    const rawResult = JSON.parse(text);
    const message = rawResult && (
      rawResult.message
      || rawResult.error
      || rawResult.msg
    );
    return {
      message: typeof message === 'string' && message
        ? message
        : 'Fortune ASR server returned an error',
      rawResult,
    };
  } catch {
    return {
      message: text || 'Fortune ASR server returned an error',
      rawResult: text,
    };
  }
}

function parseAsrServerPacket(data) {
  const buffer = toBuffer(data);
  requireBytes(buffer, 0, 4, 'header');

  const version = buffer[0] >> 4;
  const headerWords = buffer[0] & 0x0f;
  const headerSize = headerWords * 4;
  const messageType = buffer[1] >> 4;
  const flags = buffer[1] & 0x0f;
  const serialization = buffer[2] >> 4;
  const compression = buffer[2] & 0x0f;

  if (version !== 1 || headerWords < 1) {
    throw new FortuneAsrClientError(
      'INVALID_SERVER_HEADER',
      'Fortune ASR server packet has an invalid protocol header'
    );
  }
  requireBytes(buffer, 0, headerSize, 'header extensions');

  let offset = headerSize;
  if (messageType === MESSAGE_TYPES.SERVER_ERROR) {
    requireBytes(buffer, offset, 4, 'error code');
    const errorCode = buffer.readUInt32BE(offset);
    offset += 4;
    const payload = readPayload(buffer, offset, compression);
    const errorDetails = parseErrorMessage(payload, serialization);
    return {
      type: 'error',
      errorCode,
      message: errorDetails.message,
      rawResult: errorDetails.rawResult,
      sequence: null,
      isLast: true,
    };
  }

  if (messageType !== MESSAGE_TYPES.FULL_SERVER_RESPONSE) {
    throw new FortuneAsrClientError(
      'UNSUPPORTED_SERVER_MESSAGE',
      `Fortune ASR server message type ${messageType} is unsupported`
    );
  }
  if (serialization !== SERIALIZATION.JSON) {
    throw new FortuneAsrClientError(
      'UNSUPPORTED_SERVER_SERIALIZATION',
      `Fortune ASR server serialization ${serialization} is unsupported`
    );
  }

  let sequence = null;
  if ((flags & MESSAGE_FLAGS.POSITIVE_SEQUENCE) !== 0) {
    requireBytes(buffer, offset, 4, 'sequence');
    sequence = buffer.readInt32BE(offset);
    offset += 4;
  }

  const payload = readPayload(buffer, offset, compression);
  return {
    type: 'result',
    rawResult: parseJsonPayload(payload),
    sequence,
    isLast: (flags & MESSAGE_FLAGS.LAST_NO_SEQUENCE) !== 0,
  };
}

function buildInitialRequest() {
  return {
    audio: {
      format: 'pcm',
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: 'bigmodel',
      enable_punc: true,
      enable_itn: true,
      enable_nonstream: true,
      show_utterances: true,
    },
  };
}

function validateRequestId(requestId) {
  if (
    typeof requestId !== 'string'
    || requestId.length === 0
    || requestId.length > 128
    || !/^[\x21-\x7e]+$/.test(requestId)
  ) {
    throw new TypeError('requestIdFactory must return a non-empty printable ASCII string');
  }
  return requestId;
}

function sanitizeExternalMessage(value, apiKey) {
  const message = typeof value === 'string' ? value : String(value || '');
  return apiKey && message.includes(apiKey)
    ? message.split(apiKey).join('[redacted]')
    : message;
}

function createFortuneAsrClient({
  config,
  WebSocketImpl = WebSocket,
  requestIdFactory = randomUUID,
} = {}) {
  const safeConfig = validateConfig(config);
  if (typeof WebSocketImpl !== 'function') {
    throw new TypeError('WebSocketImpl must be a constructor');
  }
  if (typeof requestIdFactory !== 'function') {
    throw new TypeError('requestIdFactory must be a function');
  }

  const emitter = new EventEmitter();
  emitter.on('error', () => {});

  let state = FORTUNE_ASR_STATES.IDLE;
  let socket = null;
  let requestId = null;
  let nextSequence = 1;
  let connectPromise = null;
  let resolveConnect = null;
  let rejectConnect = null;
  let closedEmitted = false;

  function settleConnect(error) {
    if (!resolveConnect && !rejectConnect) {
      return;
    }
    const resolve = resolveConnect;
    const reject = rejectConnect;
    resolveConnect = null;
    rejectConnect = null;
    if (error) {
      reject(error);
      return;
    }
    resolve(api);
  }

  function emitFailure(error) {
    if (
      state === FORTUNE_ASR_STATES.FAILED
      || state === FORTUNE_ASR_STATES.CLOSED
    ) {
      return;
    }
    state = FORTUNE_ASR_STATES.FAILED;
    const failedSocket = socket;
    socket = null;
    settleConnect(error);
    emitter.emit('error', error);
    if (failedSocket && typeof failedSocket.close === 'function') {
      try {
        failedSocket.close(1000, 'session failed');
      } catch {
        // Failure handling must not be replaced by a secondary close error.
      }
    }
  }

  function emitClosed(details) {
    if (closedEmitted) {
      return;
    }
    closedEmitted = true;
    emitter.emit('closed', {
      ...details,
      requestId,
    });
  }

  function sendPacket(packet) {
    socket.send(packet, { binary: true });
  }

  function handleOpen() {
    if (state !== FORTUNE_ASR_STATES.CONNECTING || !socket) {
      return;
    }

    try {
      sendPacket(encodeFullClientRequest({
        request: buildInitialRequest(),
        sequence: nextSequence,
      }));
      nextSequence += 1;
    } catch {
      emitFailure(new FortuneAsrClientError(
        'INITIAL_REQUEST_FAILED',
        'Fortune ASR initial request could not be sent'
      ));
      return;
    }

    state = FORTUNE_ASR_STATES.OPEN;
    settleConnect();
    emitter.emit('ready', { requestId });
  }

  function handleResult(parsed) {
    const rawResult = parsed.rawResult;
    const result = rawResult && rawResult.result;
    const text = result && typeof result.text === 'string'
      ? result.text
      : '';
    const utterances = result && Array.isArray(result.utterances)
      ? result.utterances
      : [];
    const hasDefiniteUtterance = utterances.some(
      (utterance) => utterance && utterance.definite === true
    );
    const isFinal = hasDefiniteUtterance || parsed.isLast;

    if (parsed.isLast && state === FORTUNE_ASR_STATES.FINISHING) {
      state = FORTUNE_ASR_STATES.FINISHED;
    }

    if (!text && !isFinal) {
      return;
    }

    emitter.emit(isFinal ? 'final' : 'partial', {
      text,
      rawResult,
      requestId,
      sequence: parsed.sequence,
    });
  }

  function handleMessage(data, isBinary) {
    if (
      state === FORTUNE_ASR_STATES.CLOSED
      || state === FORTUNE_ASR_STATES.FAILED
      || (isBinary === false)
    ) {
      if (isBinary !== false) {
        return;
      }
      emitFailure(new FortuneAsrClientError(
        'INVALID_SERVER_PACKET',
        'Fortune ASR server packet must be binary'
      ));
      return;
    }

    let parsed;
    try {
      parsed = parseAsrServerPacket(data);
    } catch (error) {
      emitFailure(error);
      return;
    }

    if (parsed.type === 'error') {
      const safeMessage = sanitizeExternalMessage(
        parsed.message,
        safeConfig.apiKey
      );
      emitFailure(new FortuneAsrClientError(
        'UPSTREAM_ASR_ERROR',
        `Fortune ASR server error ${parsed.errorCode}: ${safeMessage}`,
        {
          upstreamCode: parsed.errorCode,
          requestId,
        }
      ));
      return;
    }

    handleResult(parsed);
  }

  function handleWebSocketError() {
    emitFailure(new FortuneAsrClientError(
      'UPSTREAM_WEBSOCKET_ERROR',
      'Fortune ASR WebSocket failed',
      { requestId }
    ));
  }

  function handleClose(code, reasonBuffer) {
    const previousState = state;
    socket = null;

    if (
      previousState === FORTUNE_ASR_STATES.CLOSED
      || previousState === FORTUNE_ASR_STATES.FAILED
    ) {
      emitClosed({
        code,
        reason: sanitizeExternalMessage(
          Buffer.isBuffer(reasonBuffer)
            ? reasonBuffer.toString('utf8')
            : reasonBuffer,
          safeConfig.apiKey
        ),
        abnormal: code !== 1000,
      });
      return;
    }

    if (code !== 1000) {
      const error = new FortuneAsrClientError(
        'UPSTREAM_ABNORMAL_CLOSE',
        `Fortune ASR WebSocket closed abnormally with code ${code}`,
        { closeCode: code, requestId }
      );
      state = FORTUNE_ASR_STATES.FAILED;
      settleConnect(error);
      emitter.emit('error', error);
    } else {
      state = FORTUNE_ASR_STATES.CLOSED;
      if (previousState === FORTUNE_ASR_STATES.CONNECTING) {
        settleConnect(new FortuneAsrClientError(
          'UPSTREAM_CLOSED_BEFORE_OPEN',
          'Fortune ASR WebSocket closed before opening',
          { closeCode: code, requestId }
        ));
      }
    }

    emitClosed({
      code,
      reason: sanitizeExternalMessage(
        Buffer.isBuffer(reasonBuffer)
          ? reasonBuffer.toString('utf8')
          : reasonBuffer,
        safeConfig.apiKey
      ),
      abnormal: code !== 1000,
    });
  }

  function connect() {
    if (state === FORTUNE_ASR_STATES.CONNECTING) {
      return connectPromise;
    }
    if (
      state === FORTUNE_ASR_STATES.OPEN
      || state === FORTUNE_ASR_STATES.FINISHING
      || state === FORTUNE_ASR_STATES.FINISHED
    ) {
      return Promise.resolve(api);
    }
    if (state !== FORTUNE_ASR_STATES.IDLE) {
      return Promise.reject(new FortuneAsrClientError(
        'INVALID_STATE',
        `Fortune ASR client cannot connect while ${state}`
      ));
    }

    state = FORTUNE_ASR_STATES.CONNECTING;
    try {
      requestId = validateRequestId(requestIdFactory());
    } catch (error) {
      state = FORTUNE_ASR_STATES.FAILED;
      return Promise.reject(error);
    }

    connectPromise = new Promise((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });

    try {
      socket = new WebSocketImpl(safeConfig.url, {
        headers: {
          'X-Api-Key': safeConfig.apiKey,
          'X-Api-Resource-Id': safeConfig.resourceId,
          'X-Api-Request-Id': requestId,
          'X-Api-Sequence': '-1',
        },
        perMessageDeflate: false,
      });
      socket.on('open', handleOpen);
      socket.on('message', handleMessage);
      socket.on('error', handleWebSocketError);
      socket.on('close', handleClose);
    } catch {
      const error = new FortuneAsrClientError(
        'WEBSOCKET_CONSTRUCTION_FAILED',
        'Fortune ASR WebSocket could not be created',
        { requestId }
      );
      socket = null;
      emitFailure(error);
    }

    return connectPromise;
  }

  function sendPcmChunk(pcmChunk) {
    if (state !== FORTUNE_ASR_STATES.OPEN) {
      throw new FortuneAsrClientError(
        'INVALID_STATE',
        `Fortune ASR client cannot send audio while ${state}`
      );
    }

    const packet = encodeAudioOnlyRequest({
      pcmChunk,
      sequence: nextSequence,
    });
    try {
      sendPacket(packet);
      nextSequence += 1;
    } catch {
      const error = new FortuneAsrClientError(
        'AUDIO_SEND_FAILED',
        'Fortune ASR audio packet could not be sent',
        { requestId }
      );
      emitFailure(error);
      throw error;
    }
  }

  function finish() {
    if (
      state === FORTUNE_ASR_STATES.FINISHING
      || state === FORTUNE_ASR_STATES.FINISHED
    ) {
      return false;
    }
    if (state !== FORTUNE_ASR_STATES.OPEN) {
      throw new FortuneAsrClientError(
        'INVALID_STATE',
        `Fortune ASR client cannot finish while ${state}`
      );
    }

    const packet = encodeAudioOnlyRequest({
      pcmChunk: Buffer.alloc(0),
      sequence: nextSequence,
      isLast: true,
      allowEmptyLast: true,
    });
    try {
      sendPacket(packet);
      nextSequence += 1;
      state = FORTUNE_ASR_STATES.FINISHING;
      return true;
    } catch {
      const error = new FortuneAsrClientError(
        'FINISH_SEND_FAILED',
        'Fortune ASR final packet could not be sent',
        { requestId }
      );
      emitFailure(error);
      throw error;
    }
  }

  function close() {
    if (state === FORTUNE_ASR_STATES.CLOSED) {
      return false;
    }

    const currentSocket = socket;
    socket = null;
    const wasConnecting = state === FORTUNE_ASR_STATES.CONNECTING;
    state = FORTUNE_ASR_STATES.CLOSED;

    if (wasConnecting) {
      settleConnect(new FortuneAsrClientError(
        'CLIENT_CLOSED_BEFORE_OPEN',
        'Fortune ASR client was closed before opening',
        { requestId }
      ));
    }

    if (currentSocket && typeof currentSocket.close === 'function') {
      try {
        currentSocket.close(1000, 'client closed');
      } catch {
        // Closing is intentionally idempotent and best effort.
      }
    }

    emitClosed({
      code: 1000,
      reason: 'client closed',
      abnormal: false,
    });
    return true;
  }

  const api = Object.freeze({
    get state() {
      return state;
    },
    get requestId() {
      return requestId;
    },
    on(eventName, listener) {
      emitter.on(eventName, listener);
      return api;
    },
    once(eventName, listener) {
      emitter.once(eventName, listener);
      return api;
    },
    connect,
    sendPcmChunk,
    finish,
    close,
  });

  return api;
}

module.exports = {
  COMPRESSION,
  DEFAULT_FORTUNE_ASR_URL,
  FORTUNE_ASR_STATES,
  FortuneAsrClientError,
  createFortuneAsrClient,
  createFortuneAsrConfigFromEnv,
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  parseAsrServerPacket,
};
