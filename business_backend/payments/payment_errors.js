'use strict';

function createPaymentProtocolError(
  statusCode,
  code,
  publicMessage,
  { cause, retryable = false } = {}
) {
  const error = new Error(publicMessage, cause ? { cause } : undefined);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  error.retryable = retryable;
  return error;
}

function isKnownPaymentError(error) {
  return Boolean(
    error
    && Number.isInteger(error.statusCode)
    && typeof error.code === 'string'
    && typeof error.publicMessage === 'string'
  );
}

module.exports = {
  createPaymentProtocolError,
  isKnownPaymentError,
};
