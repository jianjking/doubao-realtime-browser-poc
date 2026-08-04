'use strict';

const path = require('node:path');

const { createApp } = require('./app');
const {
  createFortuneInterpretationClientFromEnv,
} = require('./clients/fortune_interpretation_client');
const {
  createFortuneTtsClientFromEnv,
} = require('./clients/fortune_tts_client');
const {
  createBusinessStores,
} = require('./stores/business_store_factory');
const {
  parsePaymentRuntimeConfig,
} = require('./config/payments');
const {
  parseSmsRuntimeConfig,
} = require('./config/sms');
const {
  formatCnyCents,
  readFortunePricingConfig,
} = require('./config/fortune_pricing_config');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3002;

function isDevRechargeEnabled(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }
  return env.BUSINESS_ENABLE_DEV_RECHARGE === '1'
    && env.NODE_ENV !== 'production';
}

function parsePort(rawPort) {
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort)) {
    throw new Error(
      'BUSINESS_BACKEND_PORT must be an integer between 1 and 65535'
    );
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'BUSINESS_BACKEND_PORT must be an integer between 1 and 65535'
    );
  }
  return port;
}

function startServer() {
  const paymentRuntimeConfig = parsePaymentRuntimeConfig(process.env);
  const smsRuntimeConfig = parseSmsRuntimeConfig(process.env);
  const fortunePricingConfig = readFortunePricingConfig(process.env);
  const configuredHost = process.env.BUSINESS_BACKEND_HOST;
  const host = typeof configuredHost === 'string'
    && configuredHost.trim() !== ''
    ? configuredHost.trim()
    : DEFAULT_HOST;
  const rawPort = process.env.BUSINESS_BACKEND_PORT === undefined
    ? String(DEFAULT_PORT)
    : process.env.BUSINESS_BACKEND_PORT;
  const port = parsePort(rawPort);
  const fortuneInterpretationClient =
    createFortuneInterpretationClientFromEnv({
      env: process.env,
    });
  const fortuneTtsClient = createFortuneTtsClientFromEnv({
    env: process.env,
  });
  const businessStores = createBusinessStores({
    databasePath: process.env.BUSINESS_DATABASE_PATH,
    nodeEnv: process.env.NODE_ENV,
  });
  let app;
  try {
    app = createApp({
      businessStores,
      nodeEnv: process.env.NODE_ENV,
      enableDevRecharge: isDevRechargeEnabled(process.env),
      internalApiToken: process.env.BUSINESS_INTERNAL_API_TOKEN,
      mobileUiDirectory: path.resolve(
        __dirname,
        '../ui_prototypes/yuhuang_mobile_v1'
      ),
      realtimeUiDirectory: path.resolve(__dirname, '../public'),
      fortuneAudioWorkletFile: path.resolve(
        __dirname,
        '../public/pcm_capture_processor.js'
      ),
      fortuneInterpretationClient,
      fortuneTtsClient,
      fortuneDrawPriceCents: fortunePricingConfig.drawPriceCents,
      paymentRuntimeConfig,
      smsRuntimeConfig,
    });
  } catch (error) {
    businessStores.close();
    throw error;
  }

  const server = app.listen(port, host, () => {
    console.log(`business-backend listening on ${host}:${port}`);
    console.log(`sms-provider mode: ${smsRuntimeConfig.mode}`);
    if (paymentRuntimeConfig.mode === 'mock') {
      console.log('支付模式：Mock（不会产生真实扣款）');
    } else {
      console.log(`支付模式：${paymentRuntimeConfig.mode}`);
    }
    console.log(
      `求签价格：${formatCnyCents(fortunePricingConfig.drawPriceCents)} / 次`
    );
  });
  server.once('close', businessStores.close);
  server.on('error', (error) => {
    businessStores.close();
    console.error(`business-backend failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(`business-backend failed to start: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  isDevRechargeEnabled,
  parsePort,
  startServer,
};
