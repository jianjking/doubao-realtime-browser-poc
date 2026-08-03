'use strict';

const {
  AliyunSmsVerificationProvider,
} = require('./aliyun_sms_verification_provider');
const {
  MockSmsVerificationProvider,
} = require('./mock_sms_verification_provider');
const { SmsProviderError } = require('./sms_provider_error');

class DisabledSmsVerificationProvider {
  async send() {
    throw new SmsProviderError(
      'SMS_PROVIDER_DISABLED',
      'SMS verification is disabled'
    );
  }

  async verify() {
    throw new SmsProviderError(
      'SMS_PROVIDER_DISABLED',
      'SMS verification is disabled'
    );
  }
}

function createConfiguredSmsVerificationProvider({
  clock,
  runtimeConfig,
} = {}) {
  if (!runtimeConfig || typeof runtimeConfig.mode !== 'string') {
    throw new TypeError('SMS runtime config is required');
  }
  if (runtimeConfig.mode === 'disabled') {
    return new DisabledSmsVerificationProvider();
  }
  if (runtimeConfig.mode === 'mock') {
    return new MockSmsVerificationProvider({
      clock,
      exposeCode: runtimeConfig.mockExposeCode,
    });
  }
  if (runtimeConfig.mode === 'aliyun') {
    return new AliyunSmsVerificationProvider({
      settings: runtimeConfig.aliyun,
    });
  }
  throw new Error('Unsupported SMS provider mode');
}

module.exports = {
  DisabledSmsVerificationProvider,
  createConfiguredSmsVerificationProvider,
};
