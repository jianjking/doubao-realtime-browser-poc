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
  nodeEnv = '',
} = {}) {
  const liveProviders = Object.freeze({
    alipay: alipayProvider,
    wechat: wechatProvider,
  });

  function isLiveProviderAvailable(provider) {
    if (mode === 'live') {
      return Boolean(liveProviders[provider]);
    }
    return mode === 'alipay'
      && provider === 'alipay'
      && Boolean(liveProviders.alipay);
  }

  function get(provider) {
    if (!PAYMENT_PROVIDERS.includes(provider)) {
      const error = new Error('Payment provider is invalid');
      error.statusCode = 400;
      error.code = 'INVALID_PAYMENT_REQUEST';
      error.publicMessage = 'Payment provider is invalid';
      throw error;
    }
    if (mode === 'mock' && nodeEnv !== 'production') {
      return mockProvider;
    }
    if (isLiveProviderAvailable(provider)) {
      return liveProviders[provider];
    }
    if (mode !== 'mock') {
      throw createProviderModeError(mode);
    }
    throw createProviderModeError(mode);
  }

  function getCapabilities() {
    const mockAvailable = mode === 'mock'
      && nodeEnv !== 'production'
      && Boolean(mockProvider);
    const paymentProviders = Object.freeze({
      alipay: ['live', 'alipay'].includes(mode)
        ? isLiveProviderAvailable('alipay')
        : mockAvailable,
      wechat: mode === 'live'
        ? isLiveProviderAvailable('wechat')
        : mockAvailable,
    });
    return Object.freeze({
      canRecharge: paymentProviders.alipay || paymentProviders.wechat,
      paymentProviders,
    });
  }

  return Object.freeze({
    get,
    getCapabilities,
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
  const wechatProvider = runtimeConfig.mode === 'live'
    && runtimeConfig.wechat
    && runtimeConfig.wechat.enabled === true
    && runtimeConfig.wechat.configured === true
    ? new WeChatPaymentProvider({
      config: runtimeConfig.wechat,
      ...wechatProviderOptions,
    })
    : null;
  const alipayProvider = ['live', 'alipay'].includes(runtimeConfig.mode)
    && runtimeConfig.alipay
    && runtimeConfig.alipay.enabled === true
    && runtimeConfig.alipay.configured === true
    ? new AlipayPaymentProvider({
      config: runtimeConfig.alipay,
      ...alipayProviderOptions,
    })
    : null;
  return createPaymentProviderRegistry({
    mode: runtimeConfig.mode,
    nodeEnv: runtimeConfig.nodeEnv,
    wechatProvider,
    alipayProvider,
  });
}

module.exports = {
  createConfiguredPaymentProviderRegistry,
  createPaymentProviderRegistry,
  createProviderModeError,
};
