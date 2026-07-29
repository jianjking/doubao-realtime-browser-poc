'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_TIMEOUT_MS,
  MAX_AUDIO_BYTES,
  TTS_ENDPOINT,
  createFortuneTtsClient,
  createFortuneTtsClientFromEnv,
} = require('../clients/fortune_tts_client');

const API_KEY = 'test-tts-api-key';
const SPEAKER_ID = 'test-speaker-id';
const RESOURCE_ID = 'test-resource-id';
const TEXT = '签意概括：先安住当下。';

function encode(value) {
  return new TextEncoder().encode(value);
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function createStream(chunks, { onCancel } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? encode(chunk) : chunk
        );
      }
      controller.close();
    },
    cancel() {
      if (onCancel) {
        onCancel();
      }
    },
  });
}

function createResponse(chunks, {
  status = 200,
  headers,
  onCancel,
} = {}) {
  return new Response(createStream(chunks, { onCancel }), {
    status,
    headers,
  });
}

function successChunks(audioChunks, {
  includeFinal = true,
  finalNewline = true,
} = {}) {
  const chunks = audioChunks.map((audioChunk) => jsonLine({
    code: 0,
    message: '',
    data: Buffer.from(audioChunk).toString('base64'),
  }));
  if (includeFinal) {
    const final = JSON.stringify({
      code: 20000000,
      message: 'ok',
      data: null,
    });
    chunks.push(finalNewline ? `${final}\n` : final);
  }
  return chunks;
}

function createClient(options = {}) {
  return createFortuneTtsClient({
    apiKey: API_KEY,
    speakerId: SPEAKER_ID,
    resourceId: RESOURCE_ID,
    timeoutMs: 1000,
    ...options,
  });
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected promise to reject');
}

test('request uses the official V3 URL, headers, and minimal JSON body', async () => {
  const requests = [];
  let clearedTimer;
  const client = createClient({
    fetchImpl: async (...args) => {
      requests.push(args);
      return createResponse(successChunks([
        Buffer.from([0x49, 0x44, 0x33]),
      ]));
    },
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
    setTimeoutImpl: () => 42,
    clearTimeoutImpl: (timerId) => {
      clearedTimer = timerId;
    },
  });

  const result = await client.synthesize({ text: TEXT });

  assert.equal(requests.length, 1);
  const [url, options] = requests[0];
  assert.equal(url, TTS_ENDPOINT);
  assert.equal(
    url,
    'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
  );
  assert.equal(options.method, 'POST');
  assert.deepEqual(options.headers, {
    'Content-Type': 'application/json',
    'X-Api-Key': API_KEY,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Request-Id':
      '11111111-1111-4111-8111-111111111111',
  });
  assert.equal('Authorization' in options.headers, false);
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), {
    user: { uid: 'fortune-prototype' },
    req_params: {
      text: TEXT,
      speaker: SPEAKER_ID,
      audio_params: {
        format: 'mp3',
        sample_rate: 24000,
      },
    },
  });
  assert.deepEqual(result, {
    audioBuffer: Buffer.from([0x49, 0x44, 0x33]),
    contentType: 'audio/mpeg',
  });
  assert.equal(clearedTimer, 42);
});

test('environment configuration is all-or-nothing and sanitized', () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
  };
  assert.equal(
    createFortuneTtsClientFromEnv({ env: {}, fetchImpl }),
    null
  );
  assert.equal(
    createFortuneTtsClientFromEnv({
      env: {
        FORTUNE_TTS_API_KEY: '',
        FORTUNE_TTS_SPEAKER_ID: '',
        FORTUNE_TTS_RESOURCE_ID: '',
        FORTUNE_TTS_TIMEOUT_MS: '',
      },
      fetchImpl,
    }),
    null
  );

  for (const env of [
    { FORTUNE_TTS_API_KEY: 'private-partial-key' },
    { FORTUNE_TTS_SPEAKER_ID: SPEAKER_ID },
    {
      FORTUNE_TTS_API_KEY: API_KEY,
      FORTUNE_TTS_RESOURCE_ID: RESOURCE_ID,
    },
    { FORTUNE_TTS_TIMEOUT_MS: '1000' },
  ]) {
    assert.throws(
      () => createFortuneTtsClientFromEnv({ env, fetchImpl }),
      (error) => (
        error instanceof TypeError
        && !error.message.includes('private-partial-key')
        && !error.message.includes(API_KEY)
      )
    );
  }
  assert.throws(
    () => createFortuneTtsClientFromEnv({
      env: {
        FORTUNE_TTS_API_KEY: API_KEY,
        FORTUNE_TTS_SPEAKER_ID: SPEAKER_ID,
        FORTUNE_TTS_RESOURCE_ID: RESOURCE_ID,
        FORTUNE_TTS_TIMEOUT_MS: 'unsafe',
      },
      fetchImpl,
    }),
    /FORTUNE_TTS_TIMEOUT_MS/
  );
  const configuredClient = createFortuneTtsClientFromEnv({
    env: {
      FORTUNE_TTS_API_KEY: API_KEY,
      FORTUNE_TTS_SPEAKER_ID: SPEAKER_ID,
      FORTUNE_TTS_RESOURCE_ID: RESOURCE_ID,
    },
    fetchImpl,
  });
  assert.equal(typeof configuredClient.synthesize, 'function');
  assert.equal(fetchCalls, 0);
  assert.equal(DEFAULT_TIMEOUT_MS, 60000);
});

test('one audio message plus final success returns MP3 bytes', async () => {
  const audio = Buffer.from([0x49, 0x44, 0x33, 0x04]);
  const client = createClient({
    fetchImpl: async () => createResponse(
      successChunks([audio], { finalNewline: false })
    ),
  });

  const result = await client.synthesize({ text: TEXT });

  assert.equal(result.contentType, 'audio/mpeg');
  assert.deepEqual(result.audioBuffer, audio);
});

test('multiple audio messages are concatenated in arrival order', async () => {
  const first = Buffer.from([0x49, 0x44]);
  const second = Buffer.from([0x33, 0x04, 0x00]);
  const third = Buffer.from([0xff, 0xfb]);
  const client = createClient({
    fetchImpl: async () => createResponse(
      successChunks([first, second, third])
    ),
  });

  const result = await client.synthesize({ text: TEXT });

  assert.deepEqual(
    result.audioBuffer,
    Buffer.concat([first, second, third])
  );
});

test('NDJSON parsing survives split JSON and multiple JSON lines per chunk', async () => {
  const audio = Buffer.from([0x49, 0x44, 0x33, 0xff, 0xfb]);
  const body = successChunks([
    audio.subarray(0, 2),
    audio.subarray(2),
  ]).join('');
  const splitAt = body.indexOf('"data"') + 5;
  const client = createClient({
    fetchImpl: async () => createResponse([
      body.slice(0, splitAt),
      body.slice(splitAt, splitAt + 3),
      body.slice(splitAt + 3),
    ]),
  });

  const result = await client.synthesize({ text: TEXT });

  assert.deepEqual(result.audioBuffer, audio);
});

test('null-data status messages are ignored', async () => {
  const audio = Buffer.from([0x49, 0x44, 0x33]);
  const client = createClient({
    fetchImpl: async () => createResponse([
      jsonLine({ code: 0, message: 'status', data: null }),
      ...successChunks([audio]),
    ]),
  });

  const result = await client.synthesize({ text: TEXT });

  assert.deepEqual(result.audioBuffer, audio);
});

test('audio without a final success message is rejected', async () => {
  const client = createClient({
    fetchImpl: async () => createResponse(
      successChunks([Buffer.from('audio')], {
        includeFinal: false,
      })
    ),
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(error.code, 'FORTUNE_TTS_INVALID_RESPONSE');
  assert.equal('audioBuffer' in error, false);
});

test('final success without audio is rejected', async () => {
  const client = createClient({
    fetchImpl: async () => createResponse([
      jsonLine({ code: 20000000, message: 'ok', data: null }),
    ]),
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(error.code, 'FORTUNE_TTS_INVALID_RESPONSE');
});

test('invalid and non-canonical Base64 are rejected strictly', async () => {
  for (const data of ['!!!!', 'YQ', 'YR==', 'Y Q==']) {
    const client = createClient({
      fetchImpl: async () => createResponse([
        jsonLine({ code: 0, message: '', data }),
        jsonLine({
          code: 20000000,
          message: 'ok',
          data: null,
        }),
      ]),
    });

    const error = await captureError(
      client.synthesize({ text: TEXT })
    );
    assert.equal(error.code, 'FORTUNE_TTS_INVALID_RESPONSE');
  }
});

test('provider business errors are summarized without raw payloads', async () => {
  const privateMessage =
    `speaker unauthorized; ${API_KEY}; ${TEXT}`;
  const client = createClient({
    fetchImpl: async () => createResponse([
      jsonLine({
        code: 55000001,
        message: privateMessage,
        data: null,
      }),
    ]),
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(error.code, 'FORTUNE_TTS_BUSINESS_ERROR');
  assert.equal(error.providerCode, '55000001');
  assert.equal(error.message, 'TTS provider rejected the request');
  assert.equal(error.message.includes(privateMessage), false);
  assert.equal(error.upstreamSummary.includes(API_KEY), false);
  assert.equal(error.upstreamSummary.includes(TEXT), false);
  assert.ok(error.upstreamSummary.includes('[REDACTED]'));
  assert.equal('rawResponse' in error, false);
});

test('HTTP errors keep only limited redacted diagnostics', async () => {
  const rawMessage = `denied ${API_KEY} ${TEXT} ${'x'.repeat(500)}`;
  const client = createClient({
    fetchImpl: async () => createResponse([
      JSON.stringify({
        code: 'PermissionDenied',
        message: rawMessage,
      }),
    ], {
      status: 403,
      headers: { 'X-Tt-Logid': 'safe-log-id-123' },
    }),
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(error.code, 'FORTUNE_TTS_HTTP_ERROR');
  assert.equal(error.upstreamStatus, 403);
  assert.equal(error.providerCode, 'PermissionDenied');
  assert.equal(error.logId, 'safe-log-id-123');
  assert.equal(error.message, 'TTS HTTP request failed');
  assert.equal(error.upstreamSummary.includes(API_KEY), false);
  assert.equal(error.upstreamSummary.includes(TEXT), false);
  assert.ok(error.upstreamSummary.length <= 300);
  assert.equal('rawResponse' in error, false);
});

test('timeout aborts once, clears its timer, and returns no partial audio', async () => {
  let abortCount = 0;
  let clearCount = 0;
  const client = createClient({
    timeoutMs: 100,
    fetchImpl: async (_url, options) => new Promise(
      (resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          abortCount += 1;
          reject(new Error('private abort detail'));
        });
      }
    ),
    clearTimeoutImpl: (timerId) => {
      clearCount += 1;
      clearTimeout(timerId);
    },
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(error.code, 'FORTUNE_TTS_TIMEOUT');
  assert.equal(error.message, 'TTS request timed out');
  assert.equal(abortCount, 1);
  assert.equal(clearCount, 1);
  assert.equal('audioBuffer' in error, false);
});

test('network failures are generalized and do not retry', async () => {
  let calls = 0;
  const client = createClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error(`private ${API_KEY} ${TEXT}`);
    },
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(calls, 1);
  assert.equal(error.code, 'FORTUNE_TTS_NETWORK_ERROR');
  assert.equal(error.message, 'TTS network request failed');
  assert.equal(error.message.includes(API_KEY), false);
  assert.equal(error.message.includes(TEXT), false);
});

test('audio over the configured size limit is rejected atomically', async () => {
  const client = createClient({
    maxAudioBytes: 3,
    fetchImpl: async () => createResponse(
      successChunks([
        Buffer.from([1, 2]),
        Buffer.from([3, 4]),
      ])
    ),
  });

  const error = await captureError(
    client.synthesize({ text: TEXT })
  );

  assert.equal(error.code, 'FORTUNE_TTS_SIZE_LIMIT');
  assert.equal('audioBuffer' in error, false);
  assert.equal(MAX_AUDIO_BYTES, 16 * 1024 * 1024);
});

test('each synthesis uses a distinct UUID request ID', async () => {
  const requestIds = [];
  const client = createClient({
    fetchImpl: async (_url, options) => {
      requestIds.push(options.headers['X-Api-Request-Id']);
      return createResponse(
        successChunks([Buffer.from([0x49, 0x44, 0x33])])
      );
    },
  });

  await client.synthesize({ text: TEXT });
  await client.synthesize({ text: TEXT });

  assert.equal(requestIds.length, 2);
  assert.match(
    requestIds[0],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  assert.notEqual(requestIds[0], requestIds[1]);
});

test('invalid text fails before fetch', async () => {
  let fetchCalls = 0;
  const client = createClient({
    fetchImpl: async () => {
      fetchCalls += 1;
    },
  });

  for (const text of [undefined, '', ' padded ']) {
    await assert.rejects(
      client.synthesize({ text }),
      /text must be a non-empty string/
    );
  }
  assert.equal(fetchCalls, 0);
});
