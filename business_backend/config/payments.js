'use strict';

const PAYMENT_NOTICE = '模拟支付，不会产生真实扣款';
const MIN_PAYMENT_AMOUNT_CENTS = 1;
const MAX_PAYMENT_AMOUNT_CENTS = 100000;
const PAYMENT_ORDER_TTL_MS = 15 * 60 * 1000;
const PAYMENT_PROVIDERS = Object.freeze(['wechat', 'alipay']);
const PAYMENT_PROVIDER_MODES = Object.freeze(['disabled', 'mock', 'live']);

function parsePaymentRuntimeConfig(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }

  const mode = env.PAYMENT_PROVIDER_MODE === undefined
    ? 'disabled'
    : env.PAYMENT_PROVIDER_MODE;
  if (!PAYMENT_PROVIDER_MODES.includes(mode)) {
    throw new Error(
      'PAYMENT_PROVIDER_MODE must be disabled, mock, or live'
    );
  }

  const rawMockConfirmation =
    env.PAYMENT_MOCK_CONFIRMATION_ENABLED === undefined
      ? '0'
      : env.PAYMENT_MOCK_CONFIRMATION_ENABLED;
  if (rawMockConfirmation !== '0' && rawMockConfirmation !== '1') {
    throw new Error(
      'PAYMENT_MOCK_CONFIRMATION_ENABLED must be 0 or 1'
    );
  }
  const mockConfirmationEnabled = rawMockConfirmation === '1';

  if (
    env.NODE_ENV === 'production'
    && (mode === 'mock' || mockConfirmationEnabled)
  ) {
    throw new Error('Mock payment is forbidden in production');
  }

  return Object.freeze({
    mode,
    mockConfirmationEnabled,
    nodeEnv: typeof env.NODE_ENV === 'string' ? env.NODE_ENV : '',
  });
}

module.exports = {
  MAX_PAYMENT_AMOUNT_CENTS,
  MIN_PAYMENT_AMOUNT_CENTS,
  PAYMENT_NOTICE,
  PAYMENT_ORDER_TTL_MS,
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_MODES,
  parsePaymentRuntimeConfig,
};
