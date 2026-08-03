'use strict';

const path = require('node:path');

const { createApp } = require('../app');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');

const TEST_INTERPRETATION = Object.freeze({
  text: '这支签提醒您先安住心绪，再看清眼前能做的事。把最重要的一件小事写下来，稳稳完成，再继续前行。',
});

function createTestAudio() {
  const sampleRate = 8000;
  const sampleCount = 800;
  const audio = Buffer.alloc(44 + sampleCount * 2);
  audio.write('RIFF', 0, 'ascii');
  audio.writeUInt32LE(36 + sampleCount * 2, 4);
  audio.write('WAVE', 8, 'ascii');
  audio.write('fmt ', 12, 'ascii');
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24);
  audio.writeUInt32LE(sampleRate * 2, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36, 'ascii');
  audio.writeUInt32LE(sampleCount * 2, 40);
  return audio;
}

function parseInteger(rawValue, name, minimum, maximum) {
  if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`${name} is outside the accepted range`);
  }
  return value;
}

function startAcceptanceServer() {
  const port = parseInteger(process.argv[2], 'port', 0, 65535);
  const databasePath = process.argv[3];
  const initialBalanceCents = parseInteger(
    process.argv[4],
    'initial balance',
    0,
    1000000
  );
  if (typeof databasePath !== 'string' || databasePath === '') {
    throw new Error('database path is required');
  }

  const stores = createBusinessStores({ databasePath });
  const app = createApp({
    businessStores: stores,
    developmentVerificationCode: '123456',
    fortuneDrawPriceCents: 200,
    fortuneInterpretationClient: {
      async generateInterpretation() {
        return { ...TEST_INTERPRETATION };
      },
    },
    fortuneTtsClient: {
      async synthesize() {
        return {
          audioBuffer: createTestAudio(),
          contentType: 'audio/mpeg',
        };
      },
    },
    initialBalanceCents,
    mobileUiDirectory: path.resolve(
      __dirname,
      '../../ui_prototypes/yuhuang_mobile_v1'
    ),
    fortuneAudioWorkletFile: path.resolve(
      __dirname,
      '../../public/pcm_capture_processor.js'
    ),
    paymentRuntimeConfig: {
      mode: 'mock',
      mockConfirmationEnabled: true,
      nodeEnv: 'test',
    },
  });

  const server = app.listen(port, '127.0.0.1', () => {
    process.stdout.write(`READY ${server.address().port}\n`);
  });
  let closing = false;
  function close() {
    if (closing) {
      return;
    }
    closing = true;
    server.close(() => {
      stores.close();
      process.exit(0);
    });
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  server.on('error', (error) => {
    stores.close();
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

if (require.main === module) {
  startAcceptanceServer();
}

module.exports = {
  startAcceptanceServer,
};
