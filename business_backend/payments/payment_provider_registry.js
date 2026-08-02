'use strict';

const { PAYMENT_PROVIDERS } = require('../config/payments');
const { AlipayPaymentProvider } = require('./alipay_payment_provider');
const { MockPaymentProvider } = require('./mock_payment_provider');
const { WeChatPaymentProvider } = require('./wechat_payment_provider');

function createProviderModeError(mode) {
  const disabled = mode === 'disabled';
  const error = new Error(
    disabled
      ? 'Payment provider is disabled'
      : 'Live payment provider is not configured'
  );
  error.statusCode = 503;
  error.code = disabled
    ? 'PAYMENT_PROVIDER_DISABLED'
    : 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  error.publicMessage = error.message;
  return error;
}

function createPaymentProviderRegistry({
  mode = 'disabled',
  mockProvider = new MockPaymentProvider(),
  wechatProvider = null,
  alipayProvider = null,
} = {}) {
  const liveProviders = Object.freeze({
    alipay: alipayProvider,
    wechat: wechatProvider,
  });

  function get(provider) {
    if (!PAYMENT_PROVIDERS.includes(provider)) {
      const error = new Error('Payment provider is invalid');
      error.statusCode = 400;
      error.code = 'INVALID_PAYMENT_REQUEST';
      error.publicMessage = 'Payment provider is invalid';
      throw error;
    }
    if (mode === 'mock') {
      return mockProvider;
    }
    if (mode === 'live' && liveProviders[provider]) {
      return liveProviders[provider];
    }
    if (mode !== 'mock') {
      throw createProviderModeError(mode);
    }
    throw createProviderModeError(mode);
  }

  return Object.freeze({
    get,
    liveProviders,
    mode,
    mockProvider,
  });
}

function createConfiguredPaymentProviderRegistry({
  runtimeConfig,
  wechatProviderOptions = {},
  alipayProviderOptions = {},
} = {}) {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    throw new TypeError('runtimeConfig is required');
  }
  const wechatProvider = runtimeConfig.wechat
    && runtimeConfig.wechat.configured === true
    ? new WeChatPaymentProvider({
      config: runtimeConfig.wechat,
      ...wechatProviderOptions,
    })
    : null;
  const alipayProvider = runtimeConfig.alipay
    && runtimeConfig.alipay.configured === true
    ? new AlipayPaymentProvider({
      config: runtimeConfig.alipay,
      ...alipayProviderOptions,
    })
    : null;
  return createPaymentProviderRegistry({
    mode: runtimeConfig.mode,
    wechatProvider,
    alipayProvider,
  });
}

module.exports = {
  createConfiguredPaymentProviderRegistry,
  createPaymentProviderRegistry,
  createProviderModeError,
};
