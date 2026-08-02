'use strict';

const { PAYMENT_PROVIDERS } = require('../config/payments');
const { MockPaymentProvider } = require('./mock_payment_provider');

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
} = {}) {
  function get(provider) {
    if (!PAYMENT_PROVIDERS.includes(provider)) {
      const error = new Error('Payment provider is invalid');
      error.statusCode = 400;
      error.code = 'INVALID_PAYMENT_REQUEST';
      error.publicMessage = 'Payment provider is invalid';
      throw error;
    }
    if (mode !== 'mock') {
      throw createProviderModeError(mode);
    }
    return mockProvider;
  }

  return Object.freeze({
    get,
    mode,
    mockProvider,
  });
}

module.exports = {
  createPaymentProviderRegistry,
  createProviderModeError,
};
