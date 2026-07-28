'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createFortuneAsrClient,
  createFortuneAsrConfigFromEnv,
} = require('../fortune_asr_client');

const PCM_BYTES_PER_SECOND = 32000;
const DEFAULT_CHUNK_BYTES = 6400;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_FINAL_TIMEOUT_MS = 20000;

class FortuneAsrSmokeTestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FortuneAsrSmokeTestError';
    this.code = code;
  }
}

function parseCliArguments(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }

  let audioPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--audio') {
      throw new FortuneAsrSmokeTestError(
        'INVALID_ARGUMENTS',
        '存在不支持的命令行参数'
      );
    }
    if (audioPath !== null || index + 1 >= argv.length) {
      throw new FortuneAsrSmokeTestError(
        'INVALID_ARGUMENTS',
        '用法：node scripts/fortune_asr_smoke_test.js --audio <本地文件路径>'
      );
    }
    audioPath = argv[index + 1];
    index += 1;
  }

  if (typeof audioPath !== 'string' || audioPath.length === 0) {
    throw new FortuneAsrSmokeTestError(
      'INVALID_ARGUMENTS',
      '用法：node scripts/fortune_asr_smoke_test.js --audio <本地文件路径>'
    );
  }
  return { audioPath };
}

function validatePcmBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('PCM data must be a Buffer');
  }
  if (buffer.length === 0) {
    throw new FortuneAsrSmokeTestError(
      'EMPTY_AUDIO',
      'PCM 文件不能为空'
    );
  }
  if (buffer.length % 2 !== 0) {
    throw new FortuneAsrSmokeTestError(
      'INVALID_PCM_LENGTH',
      'PCM 文件字节数必须为偶数'
    );
  }
  return buffer;
}

function parseWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('WAV data must be a Buffer');
  }
  if (
    buffer.length < 12
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new FortuneAsrSmokeTestError(
      'INVALID_WAV_CONTAINER',
      'WAV 文件缺少有效的 RIFF/WAVE 头'
    );
  }

  const declaredEnd = buffer.readUInt32LE(4) + 8;
  if (declaredEnd > buffer.length) {
    throw new FortuneAsrSmokeTestError(
      'TRUNCATED_WAV',
      'WAV 文件长度小于 RIFF 声明长度'
    );
  }

  let format = null;
  let pcmData = null;
  let offset = 12;
  while (offset + 8 <= declaredEnd) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > declaredEnd) {
      throw new FortuneAsrSmokeTestError(
        'TRUNCATED_WAV_CHUNK',
        `WAV ${chunkId.trim() || 'unknown'} chunk 已截断`
      );
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new FortuneAsrSmokeTestError(
          'INVALID_WAV_FORMAT',
          'WAV fmt chunk 长度不足'
        );
      }
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data' && pcmData === null) {
      pcmData = buffer.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format) {
    throw new FortuneAsrSmokeTestError(
      'MISSING_WAV_FORMAT',
      'WAV 文件缺少 fmt chunk'
    );
  }
  if (format.audioFormat !== 1) {
    throw new FortuneAsrSmokeTestError(
      'UNSUPPORTED_WAV_ENCODING',
      'WAV 必须使用未压缩 PCM 编码'
    );
  }
  if (format.sampleRate !== 16000) {
    throw new FortuneAsrSmokeTestError(
      'UNSUPPORTED_SAMPLE_RATE',
      'WAV 采样率必须为 16000Hz'
    );
  }
  if (format.bitsPerSample !== 16) {
    throw new FortuneAsrSmokeTestError(
      'UNSUPPORTED_BIT_DEPTH',
      'WAV 位深必须为 16bit'
    );
  }
  if (format.channels !== 1) {
    throw new FortuneAsrSmokeTestError(
      'UNSUPPORTED_CHANNELS',
      'WAV 必须为单声道'
    );
  }
  if (format.blockAlign !== 2 || format.byteRate !== PCM_BYTES_PER_SECOND) {
    throw new FortuneAsrSmokeTestError(
      'INVALID_WAV_FORMAT',
      'WAV fmt chunk 与 16kHz/16bit/单声道 PCM 不一致'
    );
  }
  if (pcmData === null) {
    throw new FortuneAsrSmokeTestError(
      'MISSING_WAV_DATA',
      'WAV 文件缺少 data chunk'
    );
  }

  return validatePcmBuffer(pcmData);
}

async function loadAudioFile(audioPath, { readFileImpl = fs.readFile } = {}) {
  if (typeof readFileImpl !== 'function') {
    throw new TypeError('readFileImpl must be a function');
  }

  const extension = path.extname(audioPath).toLowerCase();
  if (extension !== '.pcm' && extension !== '.wav') {
    throw new FortuneAsrSmokeTestError(
      'UNSUPPORTED_AUDIO_FILE',
      '音频文件扩展名必须为 .pcm 或 .wav'
    );
  }

  let fileBuffer;
  try {
    fileBuffer = await readFileImpl(audioPath);
  } catch {
    throw new FortuneAsrSmokeTestError(
      'AUDIO_READ_FAILED',
      `无法读取音频文件：${path.basename(audioPath)}`
    );
  }
  if (!Buffer.isBuffer(fileBuffer)) {
    fileBuffer = Buffer.from(fileBuffer);
  }

  const pcmData = extension === '.wav'
    ? parseWavBuffer(fileBuffer)
    : validatePcmBuffer(fileBuffer);
  return {
    audioPath,
    container: extension === '.wav' ? 'wav' : 'pcm',
    pcmData,
    byteLength: pcmData.length,
    durationMs: pcmData.length / PCM_BYTES_PER_SECOND * 1000,
  };
}

function createPcmChunks(pcmData, chunkBytes = DEFAULT_CHUNK_BYTES) {
  validatePcmBuffer(pcmData);
  if (
    !Number.isInteger(chunkBytes)
    || chunkBytes <= 0
    || chunkBytes % 2 !== 0
  ) {
    throw new TypeError('chunkBytes must be a positive even integer');
  }

  const chunks = [];
  for (let offset = 0; offset < pcmData.length; offset += chunkBytes) {
    chunks.push(pcmData.subarray(
      offset,
      Math.min(offset + chunkBytes, pcmData.length)
    ));
  }
  return chunks;
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function sendPcmInRealtime({
  client,
  pcmData,
  chunkBytes = DEFAULT_CHUNK_BYTES,
  sleep = defaultSleep,
  now = Date.now,
  onProgress = () => {},
  assertCanContinue = () => {},
}) {
  if (!client || typeof client.sendPcmChunk !== 'function') {
    throw new TypeError('client.sendPcmChunk must be a function');
  }
  if (typeof sleep !== 'function' || typeof now !== 'function') {
    throw new TypeError('sleep and now must be functions');
  }

  const chunks = createPcmChunks(pcmData, chunkBytes);
  const startedAt = now();
  let sentBytes = 0;
  for (const chunk of chunks) {
    assertCanContinue();
    client.sendPcmChunk(chunk);
    sentBytes += chunk.length;
    const sentDurationMs = sentBytes / PCM_BYTES_PER_SECOND * 1000;
    onProgress({
      sentBytes,
      sentDurationMs,
      totalBytes: pcmData.length,
    });

    const remainingDelayMs = startedAt + sentDurationMs - now();
    if (remainingDelayMs > 0) {
      await sleep(remainingDelayMs);
    }
    assertCanContinue();
  }
  return {
    chunkCount: chunks.length,
    sentBytes,
    sentDurationMs: sentBytes / PCM_BYTES_PER_SECOND * 1000,
  };
}

function withTimeout(promise, timeoutMs, timeoutError, timerApi) {
  const setTimer = timerApi && timerApi.setTimeout
    ? timerApi.setTimeout
    : setTimeout;
  const clearTimer = timerApi && timerApi.clearTimeout
    ? timerApi.clearTimeout
    : clearTimeout;
  let timerId;
  const timeoutPromise = new Promise((resolve, reject) => {
    timerId = setTimer(() => reject(timeoutError), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimer(timerId);
  });
}

function sanitizedText(value, secrets = []) {
  let text = typeof value === 'string' ? value : String(value || '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.split(secret).join('[已脱敏]');
    }
  }
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .slice(0, 2000);
}

async function runFortuneAsrSmokeTest({
  audioPath,
  config,
  readFileImpl = fs.readFile,
  clientFactory = ({ clientConfig }) => createFortuneAsrClient({
    config: clientConfig,
  }),
  sleep = defaultSleep,
  now = Date.now,
  logger = console,
  signalTarget = process,
  timerApi,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  finalTimeoutMs = DEFAULT_FINAL_TIMEOUT_MS,
}) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }
  if (typeof clientFactory !== 'function') {
    throw new TypeError('clientFactory must be a function');
  }

  const secrets = [config.apiKey];
  const audio = await loadAudioFile(audioPath, { readFileImpl });
  logger.info(
    `音频：${path.basename(audioPath)}，格式 ${audio.container.toUpperCase()}，`
      + `${audio.byteLength} 字节，约 ${(audio.durationMs / 1000).toFixed(2)} 秒`
  );

  const client = clientFactory({ clientConfig: config });
  let failure = null;
  let finishSent = false;
  let receivedFinalAfterFinish = false;
  let latestFinalText = '';
  let lastPartialText = null;
  let lastFinalText = null;
  let finalWaiter = null;
  let expectedClose = false;
  let interrupted = false;

  function fail(error) {
    if (!failure) {
      failure = error;
    }
    if (finalWaiter) {
      finalWaiter.reject(failure);
      finalWaiter = null;
    }
  }

  function handlePartial(event) {
    const text = sanitizedText(event && event.text, secrets).trim();
    if (text && text !== lastPartialText) {
      lastPartialText = text;
      logger.info(`partial：${text}`);
    }
  }

  function handleFinal(event) {
    const text = sanitizedText(event && event.text, secrets).trim();
    if (!text) {
      return;
    }
    latestFinalText = text;
    if (text !== lastFinalText) {
      lastFinalText = text;
      logger.info(`final：${text}`);
    }
    if (finishSent) {
      receivedFinalAfterFinish = true;
      if (finalWaiter) {
        finalWaiter.resolve(text);
        finalWaiter = null;
      }
    }
  }

  function handleError(error) {
    fail(new FortuneAsrSmokeTestError(
      'ASR_ERROR',
      sanitizedText(error && error.message, secrets)
        || 'ASR 服务返回错误'
    ));
  }

  function handleClosed(event) {
    const abnormal = Boolean(event && event.abnormal);
    if (
      !expectedClose
      && !receivedFinalAfterFinish
      && !failure
    ) {
      fail(new FortuneAsrSmokeTestError(
        abnormal ? 'ABNORMAL_CLOSE' : 'CLOSED_BEFORE_FINAL',
        abnormal
          ? 'ASR 连接异常关闭'
          : 'ASR 连接在收到非空 final 前关闭'
      ));
    }
  }

  function handleSigint() {
    if (interrupted) {
      return;
    }
    interrupted = true;
    fail(new FortuneAsrSmokeTestError(
      'INTERRUPTED',
      '用户已中断 ASR 冒烟测试'
    ));
    expectedClose = true;
    client.close();
  }

  client.on('partial', handlePartial);
  client.on('final', handleFinal);
  client.on('error', handleError);
  client.on('closed', handleClosed);
  if (signalTarget && typeof signalTarget.on === 'function') {
    signalTarget.on('SIGINT', handleSigint);
  }

  try {
    logger.info('正在连接豆包流式 ASR...');
    await withTimeout(
      client.connect(),
      connectTimeoutMs,
      new FortuneAsrSmokeTestError(
        'CONNECT_TIMEOUT',
        `连接 ASR 超过 ${connectTimeoutMs}ms`
      ),
      timerApi
    );
    if (failure) {
      throw failure;
    }
    logger.info('已连接，开始按实时节奏发送 PCM');

    const sendResult = await sendPcmInRealtime({
      client,
      pcmData: audio.pcmData,
      sleep,
      now,
      onProgress({ sentDurationMs }) {
        logger.info(
          `已发送 ${(sentDurationMs / 1000).toFixed(2)} / `
            + `${(audio.durationMs / 1000).toFixed(2)} 秒`
        );
      },
      assertCanContinue() {
        if (failure) {
          throw failure;
        }
      },
    });
    if (failure) {
      throw failure;
    }

    const finalPromise = new Promise((resolve, reject) => {
      finalWaiter = { resolve, reject };
    });
    finishSent = true;
    client.finish();

    const finalText = await withTimeout(
      finalPromise,
      finalTimeoutMs,
      new FortuneAsrSmokeTestError(
        'FINAL_TIMEOUT',
        latestFinalText
          ? 'finish 后未收到新的非空 final 结果'
          : '只收到 partial 或空结果，未收到非空 final'
      ),
      timerApi
    );
    if (failure) {
      throw failure;
    }

    expectedClose = true;
    client.close();
    logger.info('ASR 真实识别正常完成');
    return {
      audio,
      finalText,
      finishSent,
      chunkCount: sendResult.chunkCount,
      sentBytes: sendResult.sentBytes,
    };
  } finally {
    expectedClose = true;
    client.close();
    if (
      signalTarget
      && typeof signalTarget.removeListener === 'function'
    ) {
      signalTarget.removeListener('SIGINT', handleSigint);
    }
  }
}

async function executeCli({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  configFactory = createFortuneAsrConfigFromEnv,
  runSmokeTest = runFortuneAsrSmokeTest,
  runOptions = {},
} = {}) {
  let options;
  try {
    options = parseCliArguments(argv);
  } catch (error) {
    logger.error(sanitizedText(error && error.message));
    return 1;
  }

  let config;
  try {
    config = configFactory(env);
  } catch (error) {
    logger.error(`配置错误：${sanitizedText(error && error.message)}`);
    return 2;
  }

  try {
    await runSmokeTest({
      ...runOptions,
      audioPath: options.audioPath,
      config,
      logger,
    });
    return 0;
  } catch (error) {
    logger.error(`ASR 冒烟测试失败：${
      sanitizedText(error && error.message, [config.apiKey])
    }`);
    return error && error.code === 'INTERRUPTED' ? 130 : 1;
  }
}

if (require.main === module) {
  executeCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_FINAL_TIMEOUT_MS,
  FortuneAsrSmokeTestError,
  createPcmChunks,
  executeCli,
  loadAudioFile,
  parseCliArguments,
  parseWavBuffer,
  runFortuneAsrSmokeTest,
  sendPcmInRealtime,
  validatePcmBuffer,
};
