'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { gzipSync, gunzipSync } = require('node:zlib');

const {
  COMPRESSION,
  DEFAULT_FORTUNE_ASR_URL,
  FORTUNE_ASR_STATES,
  createFortuneAsrClient,
  createFortuneAsrConfigFromEnv,
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  parseAsrServerPacket,
} = require('../fortune_asr_client');

const TEST_API_KEY = 'test-fortune-asr-api-key';
const TEST_RESOURCE_ID = 'volc.bigasr.sauc.duration';
const TEST_REQUEST_ID = '00000000-0000-4000-8000-000000000001';

class FakeWebSocket extends EventEmitter {
  static instances = [];

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.sent = [];
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  send(data, options) {
    this.sent.push({
      data: Buffer.from(data),
      options,
    });
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
  }

  emitOpen() {
    this.emit('open');
  }

  emitBinary(data) {
    this.emit('message', data, true);
  }

  emitText(text) {
    this.emit('message', text, false);
  }

  emitClose(code = 1000, reason = '') {
    this.emit('close', code, Buffer.from(reason));
  }
}

function resetFakeWebSockets() {
  FakeWebSocket.instances.length = 0;
}

function createTestClient(overrides = {}) {
  return createFortuneAsrClient({
    config: {
      url: DEFAULT_FORTUNE_ASR_URL,
      apiKey: TEST_API_KEY,
      resourceId: TEST_RESOURCE_ID,
    },
    WebSocketImpl: FakeWebSocket,
    requestIdFactory: () => TEST_REQUEST_ID,
    ...overrides,
  });
}

function decodeClientPacket(packet) {
  const headerSize = (packet[0] & 0x0f) * 4;
  const flags = packet[1] & 0x0f;
  const compression = packet[2] & 0x0f;
  let offset = headerSize;
  let sequence = null;
  if ((flags & 0x1) !== 0) {
    sequence = packet.readInt32BE(offset);
    offset += 4;
  }
  const payloadSize = packet.readUInt32BE(offset);
  offset += 4;
  const encodedPayload = packet.subarray(offset);
  const payload = compression === COMPRESSION.GZIP
    ? gunzipSync(encodedPayload)
    : encodedPayload;
  return {
    version: packet[0] >> 4,
    headerSize,
    messageType: packet[1] >> 4,
    flags,
    serialization: packet[2] >> 4,
    compression,
    sequence,
    payloadSize,
    encodedPayload,
    payload,
  };
}

function buildResultPacket(
  rawResult,
  {
    sequence = null,
    isLast = false,
    compression = COMPRESSION.GZIP,
  } = {}
) {
  const payload = Buffer.from(JSON.stringify(rawResult), 'utf8');
  const encodedPayload = compression === COMPRESSION.GZIP
    ? gzipSync(payload)
    : payload;
  const hasSequence = sequence !== null;
  const flags = hasSequence
    ? (isLast ? 0x3 : 0x1)
    : (isLast ? 0x2 : 0x0);
  const header = Buffer.from([
    0x11,
    0x90 | flags,
    0x10 | compression,
    0x00,
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(encodedPayload.length);
  const parts = [header];
  if (hasSequence) {
    const sequenceBuffer = Buffer.alloc(4);
    sequenceBuffer.writeInt32BE(sequence);
    parts.push(sequenceBuffer);
  }
  parts.push(size, encodedPayload);
  return Buffer.concat(parts);
}

function buildErrorPacket(errorCode, errorBody) {
  const payload = Buffer.from(JSON.stringify(errorBody), 'utf8');
  const code = Buffer.alloc(4);
  const size = Buffer.alloc(4);
  code.writeUInt32BE(errorCode);
  size.writeUInt32BE(payload.length);
  return Buffer.concat([
    Buffer.from([0x11, 0xf0, 0x10, 0x00]),
    code,
    size,
    payload,
  ]);
}

async function connectAndOpen(client) {
  const connectPromise = client.connect();
  const socket = FakeWebSocket.instances[0];
  socket.emitOpen();
  await connectPromise;
  return socket;
}

test('module loading is offline and environment config uses dedicated names', () => {
  resetFakeWebSockets();
  assert.equal(FakeWebSocket.instances.length, 0);

  const config = createFortuneAsrConfigFromEnv({
    DOUBAO_ASR_API_KEY: TEST_API_KEY,
    DOUBAO_ASR_RESOURCE_ID: TEST_RESOURCE_ID,
  });
  assert.deepEqual(config, {
    url: DEFAULT_FORTUNE_ASR_URL,
    apiKey: TEST_API_KEY,
    resourceId: TEST_RESOURCE_ID,
  });

  for (const missingName of [
    'DOUBAO_ASR_API_KEY',
    'DOUBAO_ASR_RESOURCE_ID',
  ]) {
    const env = {
      DOUBAO_ASR_API_KEY: TEST_API_KEY,
      DOUBAO_ASR_RESOURCE_ID: TEST_RESOURCE_ID,
    };
    delete env[missingName];
    assert.throws(
      () => createFortuneAsrConfigFromEnv(env),
      (error) => {
        assert.equal(error.message.includes(missingName), true);
        assert.equal(error.message.includes(TEST_API_KEY), false);
        return true;
      }
    );
  }
});

test('packet encoders use big-endian sequence, gzip and official flags', () => {
  const fullPacket = encodeFullClientRequest({
    request: { audio: { format: 'pcm' } },
    sequence: 1,
  });
  const decodedFull = decodeClientPacket(fullPacket);
  assert.deepEqual({
    version: decodedFull.version,
    headerSize: decodedFull.headerSize,
    messageType: decodedFull.messageType,
    flags: decodedFull.flags,
    serialization: decodedFull.serialization,
    compression: decodedFull.compression,
    sequence: decodedFull.sequence,
    payloadSize: decodedFull.payloadSize,
  }, {
    version: 1,
    headerSize: 4,
    messageType: 1,
    flags: 1,
    serialization: 1,
    compression: 1,
    sequence: 1,
    payloadSize: decodedFull.encodedPayload.length,
  });
  assert.deepEqual(
    JSON.parse(decodedFull.payload.toString('utf8')),
    { audio: { format: 'pcm' } }
  );

  const pcmChunk = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const audioPacket = encodeAudioOnlyRequest({
    pcmChunk,
    sequence: 2,
  });
  const decodedAudio = decodeClientPacket(audioPacket);
  assert.equal(decodedAudio.messageType, 2);
  assert.equal(decodedAudio.flags, 1);
  assert.equal(decodedAudio.serialization, 0);
  assert.equal(decodedAudio.sequence, 2);
  assert.deepEqual(decodedAudio.payload, pcmChunk);

  const finalPacket = encodeAudioOnlyRequest({
    pcmChunk,
    sequence: 3,
    isLast: true,
  });
  const decodedFinal = decodeClientPacket(finalPacket);
  assert.equal(decodedFinal.flags, 3);
  assert.equal(decodedFinal.sequence, -3);
  assert.equal(decodedFinal.payloadSize, decodedFinal.encodedPayload.length);

  const uncompressed = encodeFullClientRequest({
    request: { request: { model_name: 'bigmodel' } },
    sequence: 4,
    compression: COMPRESSION.NONE,
  });
  assert.equal(decodeClientPacket(uncompressed).compression, 0);
});

test('audio encoder rejects non-buffer, empty and incomplete samples', () => {
  assert.throws(
    () => encodeAudioOnlyRequest({ pcmChunk: 'pcm', sequence: 1 }),
    /pcmChunk must be a Buffer/
  );
  assert.throws(
    () => encodeAudioOnlyRequest({ pcmChunk: Buffer.alloc(0), sequence: 1 }),
    /pcmChunk must not be empty/
  );
  assert.throws(
    () => encodeAudioOnlyRequest({ pcmChunk: Buffer.alloc(1), sequence: 1 }),
    /complete 16-bit PCM samples/
  );
});

test('connect creates one socket with safe current-console auth headers', async () => {
  resetFakeWebSockets();
  const client = createTestClient();
  const firstConnect = client.connect();
  const secondConnect = client.connect();

  assert.equal(firstConnect, secondConnect);
  assert.equal(FakeWebSocket.instances.length, 1);
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, DEFAULT_FORTUNE_ASR_URL);
  assert.deepEqual(socket.options, {
    headers: {
      'X-Api-Key': TEST_API_KEY,
      'X-Api-Resource-Id': TEST_RESOURCE_ID,
      'X-Api-Request-Id': TEST_REQUEST_ID,
      'X-Api-Sequence': '-1',
    },
    perMessageDeflate: false,
  });

  socket.emitOpen();
  await Promise.all([firstConnect, secondConnect]);
  await client.connect();
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(client.state, FORTUNE_ASR_STATES.OPEN);
});

test('open sends full PCM request and emits ready', async () => {
  resetFakeWebSockets();
  const client = createTestClient();
  const readyEvents = [];
  client.on('ready', (event) => readyEvents.push(event));
  const socket = await connectAndOpen(client);

  assert.equal(socket.sent.length, 1);
  assert.deepEqual(socket.sent[0].options, { binary: true });
  const decoded = decodeClientPacket(socket.sent[0].data);
  assert.equal(decoded.sequence, 1);
  assert.deepEqual(JSON.parse(decoded.payload.toString('utf8')), {
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
  });
  assert.deepEqual(readyEvents, [{ requestId: TEST_REQUEST_ID }]);
});

test('PCM packets increment sequence and finish is sent once', async () => {
  resetFakeWebSockets();
  const client = createTestClient();
  const socket = await connectAndOpen(client);

  client.sendPcmChunk(Buffer.from([0x01, 0x00, 0x02, 0x00]));
  client.sendPcmChunk(Buffer.from([0x03, 0x00]));
  assert.equal(decodeClientPacket(socket.sent[1].data).sequence, 2);
  assert.equal(decodeClientPacket(socket.sent[2].data).sequence, 3);

  assert.equal(client.finish(), true);
  assert.equal(client.finish(), false);
  assert.equal(socket.sent.length, 4);
  const finalPacket = decodeClientPacket(socket.sent[3].data);
  assert.equal(finalPacket.messageType, 2);
  assert.equal(finalPacket.flags, 3);
  assert.equal(finalPacket.sequence, -4);
  assert.equal(finalPacket.payload.length, 0);
  assert.equal(client.state, FORTUNE_ASR_STATES.FINISHING);
  assert.throws(
    () => client.sendPcmChunk(Buffer.from([0x04, 0x00])),
    /cannot send audio while finishing/
  );
});

test('audio cannot be sent before open', () => {
  resetFakeWebSockets();
  const client = createTestClient();
  assert.throws(
    () => client.sendPcmChunk(Buffer.from([0x01, 0x00])),
    /cannot send audio while idle/
  );
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('parser handles partial, definite and last responses without concatenating', async () => {
  resetFakeWebSockets();
  const client = createTestClient();
  const partialEvents = [];
  const finalEvents = [];
  client.on('partial', (event) => partialEvents.push(event));
  client.on('final', (event) => finalEvents.push(event));
  const socket = await connectAndOpen(client);

  socket.emitBinary(buildResultPacket({
    result: {
      text: '请赐',
      utterances: [{ text: '请赐', definite: false }],
    },
  }, { sequence: 2 }));
  socket.emitBinary(buildResultPacket({
    result: {
      text: '请赐一签',
      utterances: [{ text: '请赐一签', definite: true }],
    },
  }, { sequence: 3, compression: COMPRESSION.NONE }));

  assert.deepEqual(
    partialEvents.map((event) => event.text),
    ['请赐']
  );
  assert.deepEqual(
    finalEvents.map((event) => event.text),
    ['请赐一签']
  );
  assert.equal(finalEvents[0].sequence, 3);
  assert.equal(client.state, FORTUNE_ASR_STATES.OPEN);

  client.finish();
  socket.emitBinary(buildResultPacket({
    result: {
      text: '请赐一签',
      utterances: [{ text: '请赐一签', definite: true }],
    },
  }, { sequence: 4, isLast: true }));
  assert.equal(client.state, FORTUNE_ASR_STATES.FINISHED);
  assert.deepEqual(
    finalEvents.map((event) => event.text),
    ['请赐一签', '请赐一签']
  );
});

test('parser supports result packets with and without sequence', () => {
  const withSequence = parseAsrServerPacket(buildResultPacket({
    result: { text: '甲' },
  }, { sequence: 7 }));
  const withoutSequence = parseAsrServerPacket(buildResultPacket({
    result: { text: '乙' },
  }));
  assert.equal(withSequence.sequence, 7);
  assert.equal(withSequence.rawResult.result.text, '甲');
  assert.equal(withoutSequence.sequence, null);
  assert.equal(withoutSequence.rawResult.result.text, '乙');
});

test('server error becomes a sanitized error event and failed state', async () => {
  resetFakeWebSockets();
  const client = createTestClient();
  const errors = [];
  client.on('error', (error) => errors.push(error));
  const socket = await connectAndOpen(client);

  socket.emitBinary(buildErrorPacket(45000001, {
    message: `bad request ${TEST_API_KEY}`,
  }));
  assert.equal(client.state, FORTUNE_ASR_STATES.FAILED);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'UPSTREAM_ASR_ERROR');
  assert.equal(errors[0].upstreamCode, 45000001);
  assert.equal(errors[0].message.includes(TEST_API_KEY), false);
  assert.equal(errors[0].message.includes('[redacted]'), true);
  assert.equal(JSON.stringify(errors[0]).includes(TEST_API_KEY), false);
});

test('truncated, invalid JSON and text packets report errors without throwing', async () => {
  for (const emitInvalidPacket of [
    (socket) => socket.emitBinary(Buffer.from([0x11, 0x91])),
    (socket) => {
      const invalidJson = Buffer.from('{', 'utf8');
      const size = Buffer.alloc(4);
      size.writeUInt32BE(invalidJson.length);
      socket.emitBinary(Buffer.concat([
        Buffer.from([0x11, 0x90, 0x10, 0x00]),
        size,
        invalidJson,
      ]));
    },
    (socket) => socket.emitText('not binary'),
  ]) {
    resetFakeWebSockets();
    const client = createTestClient();
    const errors = [];
    client.on('error', (error) => errors.push(error));
    const socket = await connectAndOpen(client);

    assert.doesNotThrow(() => emitInvalidPacket(socket));
    assert.equal(client.state, FORTUNE_ASR_STATES.FAILED);
    assert.equal(errors.length, 1);
  }
});

test('WebSocket error and abnormal close fail once without reconnecting', async () => {
  resetFakeWebSockets();
  const errorClient = createTestClient();
  const socketErrors = [];
  errorClient.on('error', (error) => socketErrors.push(error));
  const errorSocket = await connectAndOpen(errorClient);
  errorSocket.emit('error', new Error('network'));
  errorSocket.emit('error', new Error('network again'));
  assert.equal(errorClient.state, FORTUNE_ASR_STATES.FAILED);
  assert.equal(socketErrors.length, 1);
  assert.equal(FakeWebSocket.instances.length, 1);

  resetFakeWebSockets();
  const closeClient = createTestClient();
  const closeErrors = [];
  const closedEvents = [];
  closeClient.on('error', (error) => closeErrors.push(error));
  closeClient.on('closed', (event) => closedEvents.push(event));
  const closeSocket = await connectAndOpen(closeClient);
  closeSocket.emitClose(1011, 'upstream failed');
  closeSocket.emitOpen();

  assert.equal(closeClient.state, FORTUNE_ASR_STATES.FAILED);
  assert.equal(closeErrors.length, 1);
  assert.equal(closeErrors[0].code, 'UPSTREAM_ABNORMAL_CLOSE');
  assert.equal(closedEvents.length, 1);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('close is idempotent and late events cannot reopen the client', async () => {
  resetFakeWebSockets();
  const client = createTestClient();
  const closedEvents = [];
  client.on('closed', (event) => closedEvents.push(event));
  const socket = await connectAndOpen(client);

  assert.equal(client.close(), true);
  assert.equal(client.close(), false);
  socket.emitClose(1000, 'closed');
  socket.emitOpen();

  assert.equal(client.state, FORTUNE_ASR_STATES.CLOSED);
  assert.deepEqual(socket.closeCalls, [
    { code: 1000, reason: 'client closed' },
  ]);
  assert.equal(closedEvents.length, 1);
});
