'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  FortuneAsrSmokeTestError,
  createPcmChunks,
  executeCli,
  loadAudioFile,
  parseCliArguments,
  parseWavBuffer,
  runFortuneAsrSmokeTest,
} = require('../scripts/fortune_asr_smoke_test');

const TEST_API_KEY = 'offline-smoke-test-api-key';
const TEST_CONFIG = Object.freeze({
  url: 'wss://example.invalid/asr',
  apiKey: TEST_API_KEY,
  resourceId: 'volc.bigasr.sauc.duration',
});

function createWav({
  audioFormat = 1,
  channels = 1,
  sampleRate = 16000,
  bitsPerSample = 16,
  pcmData = Buffer.from([0x01, 0x00, 0x02, 0x00]),
  extraChunks = [],
} = {}) {
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const fmtData = Buffer.alloc(16);
  fmtData.writeUInt16LE(audioFormat, 0);
  fmtData.writeUInt16LE(channels, 2);
  fmtData.writeUInt32LE(sampleRate, 4);
  fmtData.writeUInt32LE(byteRate, 8);
  fmtData.writeUInt16LE(blockAlign, 12);
  fmtData.writeUInt16LE(bitsPerSample, 14);

  function chunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([
      header,
      data,
      data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
    ]);
  }

  const body = Buffer.concat([
    chunk('fmt ', fmtData),
    ...extraChunks.map(({ id, data }) => chunk(id, data)),
    chunk('data', pcmData),
  ]);
  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 4, 'ascii');
  riffHeader.writeUInt32LE(body.length + 4, 4);
  riffHeader.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([riffHeader, body]);
}

class FakeClient {
  constructor({ onFinish, connectPromise } = {}) {
    this.emitter = new EventEmitter();
    this.sent = [];
    this.finishCalls = 0;
    this.closeCalls = 0;
    this.onFinish = onFinish;
    this.connectPromise = connectPromise || Promise.resolve();
  }

  on(eventName, listener) {
    this.emitter.on(eventName, listener);
    return this;
  }

  connect() {
    return this.connectPromise;
  }

  sendPcmChunk(chunk) {
    this.sent.push(Buffer.from(chunk));
  }

  finish() {
    this.finishCalls += 1;
    if (this.onFinish) {
      this.onFinish(this);
    }
  }

  close() {
    this.closeCalls += 1;
    return true;
  }

  emit(eventName, value) {
    this.emitter.emit(eventName, value);
  }
}

function createLogger() {
  const lines = [];
  return {
    lines,
    info(message) {
      lines.push(`INFO ${message}`);
    },
    error(message) {
      lines.push(`ERROR ${message}`);
    },
  };
}

test('CLI arguments require exactly one --audio value', () => {
  assert.deepEqual(
    parseCliArguments(['--audio', 'voice.wav']),
    { audioPath: 'voice.wav' }
  );
  assert.throws(
    () => parseCliArguments([]),
    /用法/
  );
  assert.throws(
    () => parseCliArguments(['--key', 'secret']),
    /不支持的命令行参数/
  );
  assert.throws(
    () => parseCliArguments(['--audio']),
    /用法/
  );
});

test('audio loader reports missing files without raw filesystem errors', async () => {
  await assert.rejects(
    loadAudioFile('missing.pcm', {
      readFileImpl: async () => {
        const error = new Error('sensitive system path');
        error.code = 'ENOENT';
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.code, 'AUDIO_READ_FAILED');
      assert.equal(error.message, '无法读取音频文件：missing.pcm');
      assert.equal(error.message.includes('sensitive system path'), false);
      return true;
    }
  );
});

test('raw PCM must be non-empty with an even byte length', async () => {
  await assert.rejects(
    loadAudioFile('empty.pcm', {
      readFileImpl: async () => Buffer.alloc(0),
    }),
    /PCM 文件不能为空/
  );
  await assert.rejects(
    loadAudioFile('odd.pcm', {
      readFileImpl: async () => Buffer.alloc(3),
    }),
    /字节数必须为偶数/
  );

  const loaded = await loadAudioFile('valid.pcm', {
    readFileImpl: async () => Buffer.alloc(6400),
  });
  assert.equal(loaded.container, 'pcm');
  assert.equal(loaded.durationMs, 200);
});

test('WAV parser accepts PCM 16kHz 16bit mono and skips extra chunks', () => {
  const pcmData = Buffer.from([0x01, 0x00, 0x02, 0x00]);
  const wav = createWav({
    pcmData,
    extraChunks: [
      { id: 'JUNK', data: Buffer.from([1, 2, 3]) },
      { id: 'LIST', data: Buffer.from([4, 5]) },
    ],
  });
  assert.deepEqual(parseWavBuffer(wav), pcmData);
});

test('WAV parser rejects wrong rate, bit depth, channels and encoding', () => {
  const invalidCases = [
    [{ sampleRate: 8000 }, 'UNSUPPORTED_SAMPLE_RATE'],
    [{ bitsPerSample: 8 }, 'UNSUPPORTED_BIT_DEPTH'],
    [{ channels: 2 }, 'UNSUPPORTED_CHANNELS'],
    [{ audioFormat: 3 }, 'UNSUPPORTED_WAV_ENCODING'],
  ];
  for (const [options, expectedCode] of invalidCases) {
    assert.throws(
      () => parseWavBuffer(createWav(options)),
      (error) => {
        assert.equal(error.code, expectedCode);
        return true;
      }
    );
  }
});

test('WAV parser rejects non-WAV and missing or truncated chunks', () => {
  assert.throws(
    () => parseWavBuffer(Buffer.from('not a wav')),
    /RIFF\/WAVE/
  );

  const missingData = createWav();
  missingData.write('JUNK', missingData.indexOf(Buffer.from('data')), 4, 'ascii');
  assert.throws(
    () => parseWavBuffer(missingData),
    /缺少 data chunk/
  );

  const truncated = createWav();
  assert.throws(
    () => parseWavBuffer(truncated.subarray(0, truncated.length - 1)),
    /小于 RIFF 声明长度/
  );
});

test('PCM chunking uses 6400-byte blocks and preserves an even tail', () => {
  const pcmData = Buffer.alloc(12802, 1);
  const chunks = createPcmChunks(pcmData);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [6400, 6400, 2]
  );
  assert.deepEqual(Buffer.concat(chunks), pcmData);
});

test('runner sends near real time and succeeds only after post-finish final', async () => {
  const logger = createLogger();
  const delays = [];
  let clock = 0;
  const client = new FakeClient({
    onFinish(instance) {
      instance.emit('partial', { text: '请' });
      instance.emit('final', { text: '请赐一签' });
      instance.emit('final', { text: '请赐一签' });
    },
  });

  const result = await runFortuneAsrSmokeTest({
    audioPath: 'voice.pcm',
    config: TEST_CONFIG,
    readFileImpl: async () => Buffer.alloc(6500, 1),
    clientFactory: () => client,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      clock += delayMs;
    },
    now: () => clock,
    logger,
    signalTarget: new EventEmitter(),
  });

  assert.deepEqual(client.sent.map((chunk) => chunk.length), [6400, 100]);
  assert.deepEqual(delays, [200, 3.125]);
  assert.equal(client.finishCalls, 1);
  assert.equal(client.closeCalls >= 1, true);
  assert.equal(result.finalText, '请赐一签');
  assert.equal(result.chunkCount, 2);
  assert.equal(
    logger.lines.filter((line) => line.includes('final：')).length,
    1
  );
  assert.equal(logger.lines.some((line) => line.includes(TEST_API_KEY)), false);
});

test('runner fails when only partial is received and always closes', async () => {
  const client = new FakeClient({
    onFinish(instance) {
      instance.emit('partial', { text: '只有临时文本' });
    },
  });
  await assert.rejects(
    runFortuneAsrSmokeTest({
      audioPath: 'voice.pcm',
      config: TEST_CONFIG,
      readFileImpl: async () => Buffer.alloc(2),
      clientFactory: () => client,
      sleep: async () => {},
      logger: createLogger(),
      signalTarget: new EventEmitter(),
      finalTimeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.code, 'FINAL_TIMEOUT');
      assert.match(error.message, /未收到非空 final/);
      return true;
    }
  );
  assert.equal(client.closeCalls >= 1, true);
});

test('runner sanitizes server errors and closes without reconnecting', async () => {
  const client = new FakeClient({
    onFinish(instance) {
      instance.emit('error', {
        message: `upstream rejected ${TEST_API_KEY}`,
      });
    },
  });
  await assert.rejects(
    runFortuneAsrSmokeTest({
      audioPath: 'voice.pcm',
      config: TEST_CONFIG,
      readFileImpl: async () => Buffer.alloc(2),
      clientFactory: () => client,
      sleep: async () => {},
      logger: createLogger(),
      signalTarget: new EventEmitter(),
    }),
    (error) => {
      assert.equal(error.code, 'ASR_ERROR');
      assert.equal(error.message.includes(TEST_API_KEY), false);
      return true;
    }
  );
  assert.equal(client.finishCalls, 1);
  assert.equal(client.closeCalls >= 1, true);
});

test('connect timeout is finite and closes the client', async () => {
  const client = new FakeClient({
    connectPromise: new Promise(() => {}),
  });
  await assert.rejects(
    runFortuneAsrSmokeTest({
      audioPath: 'voice.pcm',
      config: TEST_CONFIG,
      readFileImpl: async () => Buffer.alloc(2),
      clientFactory: () => client,
      logger: createLogger(),
      signalTarget: new EventEmitter(),
      connectTimeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.code, 'CONNECT_TIMEOUT');
      return true;
    }
  );
  assert.equal(client.sent.length, 0);
  assert.equal(client.closeCalls >= 1, true);
});

test('SIGINT stops pacing and closes the client', async () => {
  const signalTarget = new EventEmitter();
  const client = new FakeClient();
  await assert.rejects(
    runFortuneAsrSmokeTest({
      audioPath: 'voice.pcm',
      config: TEST_CONFIG,
      readFileImpl: async () => Buffer.alloc(12800, 1),
      clientFactory: () => client,
      sleep: async () => {
        signalTarget.emit('SIGINT');
      },
      logger: createLogger(),
      signalTarget,
    }),
    (error) => {
      assert.equal(error.code, 'INTERRUPTED');
      return true;
    }
  );
  assert.equal(client.closeCalls >= 1, true);
  assert.equal(client.finishCalls, 0);
  assert.equal(client.sent.length, 1);
});

test('CLI missing configuration returns 2 without creating a client', async () => {
  const logger = createLogger();
  let runCalls = 0;
  const exitCode = await executeCli({
    argv: ['--audio', 'voice.pcm'],
    env: {},
    logger,
    configFactory() {
      throw new TypeError('DOUBAO_ASR_API_KEY is missing');
    },
    async runSmokeTest() {
      runCalls += 1;
    },
  });
  assert.equal(exitCode, 2);
  assert.equal(runCalls, 0);
  assert.equal(
    logger.lines.some((line) => line.includes('DOUBAO_ASR_API_KEY')),
    true
  );
});

test('CLI maps success, failure and SIGINT to stable exit codes', async () => {
  const scenarios = [
    [null, 0],
    [
      new FortuneAsrSmokeTestError(
        'FAILED',
        `failed ${TEST_API_KEY}`
      ),
      1,
    ],
    [new FortuneAsrSmokeTestError('INTERRUPTED', 'stopped'), 130],
  ];
  for (const [failure, expectedExitCode] of scenarios) {
    const logger = createLogger();
    const exitCode = await executeCli({
      argv: ['--audio', 'voice.pcm'],
      env: {},
      logger,
      configFactory: () => TEST_CONFIG,
      async runSmokeTest() {
        if (failure) {
          throw failure;
        }
      },
    });
    assert.equal(exitCode, expectedExitCode);
    assert.equal(logger.lines.some(
      (line) => line.includes(TEST_API_KEY)
    ), false);
  }
});
