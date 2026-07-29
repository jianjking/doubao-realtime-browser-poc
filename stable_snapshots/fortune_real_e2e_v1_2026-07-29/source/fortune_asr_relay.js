'use strict';

const {
  createFortuneAsrClient,
  createFortuneAsrConfigFromEnv,
} = require('./fortune_asr_client');

const FORTUNE_ASR_WEBSOCKET_PATH = '/fortune-asr';
const FORTUNE_ASR_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_FORTUNE_ASR';
const DEFAULT_MAX_JSON_BYTES = 8192;
const DEFAULT_MAX_PCM_CHUNK_BYTES = 64000;
const WEBSOCKET_OPEN = 1;

const FORTUNE_ASR_RELAY_STATES = Object.freeze({
  WAITING_START: 'waiting-start',
  CONNECTING_UPSTREAM: 'connecting-upstream',
  STREAMING: 'streaming',
  FINISHING: 'finishing',
  FINISHED: 'finished',
  FAILED: 'failed',
  CLOSED: 'closed',
});

function isFortuneAsrEnabled(env = process.env) {
  return env[FORTUNE_ASR_ENABLE_ENV_NAME] === '1';
}

function createFortuneAsrClientFactoryFromEnv({
  env = process.env,
  clientFactory = createFortuneAsrClient,
} = {}) {
  if (typeof clientFactory !== 'function') {
    throw new TypeError('clientFactory must be a function');
  }

  return function createConfiguredFortuneAsrClient() {
    return clientFactory({
      config: createFortuneAsrConfigFromEnv(env),
    });
  };
}

function isValidStartMessage(message) {
  if (
    !message
    || Array.isArray(message)
    || typeof message !== 'object'
    || message.type !== 'fortune.asr.start'
  ) {
    return false;
  }

  const audio = message.audio;
  return Boolean(
    audio
    && !Array.isArray(audio)
    && typeof audio === 'object'
    && audio.format === 'pcm_s16le'
    && audio.sampleRate === 16000
    && audio.bitsPerSample === 16
    && audio.channels === 1
  );
}

function createFortuneAsrRelayConnectionHandler({
  asrClientFactory,
  logger = () => {},
  limits = {},
} = {}) {
  if (typeof asrClientFactory !== 'function') {
    throw new TypeError('asrClientFactory must be a function');
  }
  if (typeof logger !== 'function') {
    throw new TypeError('logger must be a function');
  }

  const maxJsonBytes = limits.maxJsonBytes === undefined
    ? DEFAULT_MAX_JSON_BYTES
    : limits.maxJsonBytes;
  const maxPcmChunkBytes = limits.maxPcmChunkBytes === undefined
    ? DEFAULT_MAX_PCM_CHUNK_BYTES
    : limits.maxPcmChunkBytes;

  if (!Number.isInteger(maxJsonBytes) || maxJsonBytes < 1) {
    throw new TypeError('maxJsonBytes must be a positive integer');
  }
  if (!Number.isInteger(maxPcmChunkBytes) || maxPcmChunkBytes < 2) {
    throw new TypeError('maxPcmChunkBytes must be an integer of at least 2');
  }

  return function handleFortuneAsrConnection(browserSocket) {
    let state = FORTUNE_ASR_RELAY_STATES.WAITING_START;
    let asrClient = null;
    let asrClientCreated = false;
    let asrCloseHandled = false;
    let browserCloseRequested = false;
    let lastFinalText = null;
    let listenersAttached = false;

    function logStatus(message) {
      try {
        logger(`[Fortune ASR Relay] ${message}`);
      } catch {
        // Logging must never change protocol or cleanup behavior.
      }
    }

    function closeBrowser(code, reason) {
      if (browserCloseRequested) {
        return;
      }
      browserCloseRequested = true;
      if (
        browserSocket
        && typeof browserSocket.close === 'function'
        && browserSocket.readyState !== 3
      ) {
        try {
          browserSocket.close(code, reason);
        } catch {
          // Browser cleanup is best effort.
        }
      }
    }

    function sendJson(message, afterSend) {
      if (!browserSocket || browserSocket.readyState !== WEBSOCKET_OPEN) {
        cleanupAfterBrowserDisconnect();
        return false;
      }

      let callbackCalled = false;
      const handleSendComplete = (error) => {
        if (callbackCalled) {
          return;
        }
        callbackCalled = true;
        if (error) {
          logStatus('browser send failed');
          cleanupAfterBrowserDisconnect();
          closeBrowser(1011, 'send failed');
          return;
        }
        if (typeof afterSend === 'function') {
          afterSend();
        }
      };

      try {
        browserSocket.send(JSON.stringify(message), handleSendComplete);
      } catch {
        handleSendComplete(new Error('send failed'));
        return false;
      }
      return true;
    }

    function removeAsrListeners() {
      if (!asrClient || !listenersAttached) {
        return;
      }
      const remove = typeof asrClient.off === 'function'
        ? asrClient.off.bind(asrClient)
        : (
          typeof asrClient.removeListener === 'function'
            ? asrClient.removeListener.bind(asrClient)
            : null
        );
      if (remove) {
        remove('ready', handleAsrReady);
        remove('partial', handleAsrPartial);
        remove('final', handleAsrFinal);
        remove('error', handleAsrError);
        remove('closed', handleAsrClosed);
      }
      listenersAttached = false;
    }

    function closeAsrOnce() {
      if (!asrClient || asrCloseHandled) {
        return;
      }
      const clientToClose = asrClient;
      asrClient = null;
      asrCloseHandled = true;
      try {
        clientToClose.close();
      } catch {
        // Upstream cleanup is best effort and intentionally idempotent.
      }
    }

    function cleanupAfterBrowserDisconnect() {
      if (state === FORTUNE_ASR_RELAY_STATES.CLOSED) {
        return;
      }
      state = FORTUNE_ASR_RELAY_STATES.CLOSED;
      removeAsrListeners();
      closeAsrOnce();
    }

    function failSession(code, message) {
      if (
        state === FORTUNE_ASR_RELAY_STATES.FAILED
        || state === FORTUNE_ASR_RELAY_STATES.CLOSED
      ) {
        return;
      }
      state = FORTUNE_ASR_RELAY_STATES.FAILED;
      removeAsrListeners();
      closeAsrOnce();
      sendJson({
        type: 'fortune.asr.error',
        error: {
          code,
          message,
        },
      }, () => {
        closeBrowser(1008, 'fortune asr session failed');
      });
    }

    function protocolError(code, message) {
      logStatus(`protocol error: ${code}`);
      failSession(code, message);
    }

    function handleAsrReady() {
      if (state !== FORTUNE_ASR_RELAY_STATES.CONNECTING_UPSTREAM) {
        return;
      }
      state = FORTUNE_ASR_RELAY_STATES.STREAMING;
      sendJson({ type: 'fortune.asr.started' });
    }

    function handleAsrPartial(event) {
      if (
        state !== FORTUNE_ASR_RELAY_STATES.STREAMING
        && state !== FORTUNE_ASR_RELAY_STATES.FINISHING
      ) {
        return;
      }
      const text = event && typeof event.text === 'string'
        ? event.text
        : '';
      if (text.trim() === '') {
        return;
      }
      sendJson({
        type: 'fortune.asr.partial',
        text,
      });
    }

    function handleAsrFinal(event) {
      if (
        state !== FORTUNE_ASR_RELAY_STATES.STREAMING
        && state !== FORTUNE_ASR_RELAY_STATES.FINISHING
        && state !== FORTUNE_ASR_RELAY_STATES.FINISHED
      ) {
        return;
      }
      const text = event && typeof event.text === 'string'
        ? event.text
        : '';
      if (state === FORTUNE_ASR_RELAY_STATES.FINISHING) {
        state = FORTUNE_ASR_RELAY_STATES.FINISHED;
      }
      if (text.trim() === '' || text === lastFinalText) {
        return;
      }
      lastFinalText = text;
      sendJson({
        type: 'fortune.asr.final',
        text,
      });
    }

    function handleAsrError() {
      logStatus('upstream ASR failed');
      failSession(
        'UPSTREAM_ASR_ERROR',
        'Fortune ASR service failed'
      );
    }

    function handleAsrClosed() {
      if (
        state === FORTUNE_ASR_RELAY_STATES.CLOSED
        || state === FORTUNE_ASR_RELAY_STATES.FAILED
      ) {
        return;
      }
      asrCloseHandled = true;
      state = FORTUNE_ASR_RELAY_STATES.CLOSED;
      removeAsrListeners();
      asrClient = null;
      sendJson({ type: 'fortune.asr.closed' }, () => {
        closeBrowser(1000, 'fortune asr closed');
      });
    }

    function attachAsrListeners() {
      asrClient.on('ready', handleAsrReady);
      asrClient.on('partial', handleAsrPartial);
      asrClient.on('final', handleAsrFinal);
      asrClient.on('error', handleAsrError);
      asrClient.on('closed', handleAsrClosed);
      listenersAttached = true;
    }

    function startAsr() {
      state = FORTUNE_ASR_RELAY_STATES.CONNECTING_UPSTREAM;

      try {
        asrClient = asrClientFactory();
        if (
          !asrClient
          || typeof asrClient.on !== 'function'
          || typeof asrClient.connect !== 'function'
          || typeof asrClient.sendPcmChunk !== 'function'
          || typeof asrClient.finish !== 'function'
          || typeof asrClient.close !== 'function'
        ) {
          throw new TypeError('invalid ASR client');
        }
        asrClientCreated = true;
        attachAsrListeners();
        Promise.resolve(asrClient.connect()).catch(() => {
          handleAsrError();
        });
      } catch {
        logStatus('ASR configuration or client creation failed');
        failSession(
          'ASR_CONFIGURATION_ERROR',
          'Fortune ASR service is not configured'
        );
      }
    }

    function handleTextMessage(rawData) {
      const buffer = Buffer.isBuffer(rawData)
        ? rawData
        : Buffer.from(rawData);
      if (buffer.length === 0 || buffer.length > maxJsonBytes) {
        protocolError(
          'INVALID_MESSAGE',
          'Fortune ASR control message is invalid'
        );
        return;
      }

      let message;
      try {
        message = JSON.parse(buffer.toString('utf8'));
      } catch {
        protocolError(
          'INVALID_MESSAGE',
          'Fortune ASR control message is invalid'
        );
        return;
      }

      if (state === FORTUNE_ASR_RELAY_STATES.WAITING_START) {
        if (!isValidStartMessage(message)) {
          protocolError(
            'INVALID_START',
            'Fortune ASR start message is invalid'
          );
          return;
        }
        startAsr();
        return;
      }

      if (message && message.type === 'fortune.asr.start') {
        protocolError(
          'DUPLICATE_START',
          'Fortune ASR has already been started'
        );
        return;
      }

      if (message && message.type === 'fortune.asr.finish') {
        if (state !== FORTUNE_ASR_RELAY_STATES.STREAMING) {
          protocolError(
            'INVALID_FINISH',
            'Fortune ASR cannot finish in the current state'
          );
          return;
        }
        state = FORTUNE_ASR_RELAY_STATES.FINISHING;
        try {
          asrClient.finish();
        } catch {
          handleAsrError();
        }
        return;
      }

      protocolError(
        'INVALID_MESSAGE',
        'Fortune ASR control message is invalid'
      );
    }

    function handlePcmMessage(rawData) {
      if (state !== FORTUNE_ASR_RELAY_STATES.STREAMING) {
        protocolError(
          'PCM_NOT_ALLOWED',
          'Fortune ASR audio is not allowed in the current state'
        );
        return;
      }

      if (
        !Buffer.isBuffer(rawData)
        || rawData.length === 0
        || rawData.length % 2 !== 0
        || rawData.length > maxPcmChunkBytes
      ) {
        protocolError(
          'INVALID_PCM_CHUNK',
          'Fortune ASR audio chunk is invalid'
        );
        return;
      }

      try {
        asrClient.sendPcmChunk(rawData);
      } catch {
        handleAsrError();
      }
    }

    browserSocket.on('message', (rawData, isBinary) => {
      if (
        state === FORTUNE_ASR_RELAY_STATES.FAILED
        || state === FORTUNE_ASR_RELAY_STATES.CLOSED
      ) {
        return;
      }
      if (isBinary === true) {
        handlePcmMessage(rawData);
        return;
      }
      handleTextMessage(rawData);
    });

    browserSocket.on('close', () => {
      cleanupAfterBrowserDisconnect();
    });

    browserSocket.on('error', () => {
      cleanupAfterBrowserDisconnect();
    });

    sendJson({ type: 'fortune.asr.ready' });

    return Object.freeze({
      get state() {
        return state;
      },
      get asrClientCreated() {
        return asrClientCreated;
      },
      close() {
        cleanupAfterBrowserDisconnect();
        closeBrowser(1001, 'relay shutting down');
      },
    });
  };
}

module.exports = {
  DEFAULT_MAX_JSON_BYTES,
  DEFAULT_MAX_PCM_CHUNK_BYTES,
  FORTUNE_ASR_ENABLE_ENV_NAME,
  FORTUNE_ASR_RELAY_STATES,
  FORTUNE_ASR_WEBSOCKET_PATH,
  createFortuneAsrClientFactoryFromEnv,
  createFortuneAsrRelayConnectionHandler,
  isFortuneAsrEnabled,
  isValidStartMessage,
};
