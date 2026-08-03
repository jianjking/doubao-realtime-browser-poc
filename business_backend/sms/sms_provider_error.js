'use strict';

class SmsProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SmsProviderError';
    this.code = code;
  }
}

module.exports = {
  SmsProviderError,
};
