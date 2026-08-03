'use strict';

const express = require('express');

const INVALID_CALL_ID_RESPONSE = {
  error: {
    code: 'INVALID_CALL_ID',
    message: 'A valid callId is required',
  },
};

const CALL_SERVICE_ERROR_STATUS_CODES = Object.freeze({
  ACCOUNT_UNAVAILABLE: 409,
  CALL_NOT_FOUND: 404,
  INSUFFICIENT_BALANCE: 409,
  INVALID_CALL_TRANSITION: 409,
});

function sendKnownCallServiceError(error, response) {
  if (
    error
    && typeof error.code === 'string'
    && CALL_SERVICE_ERROR_STATUS_CODES[error.code]
      === error.statusCode
    && typeof error.publicMessage === 'string'
  ) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.publicMessage,
      },
    });
    return true;
  }
  return false;
}

function createLifecycleHandler(markCall) {
  return function lifecycleHandler(request, response, next) {
    const { callId } = request.params;
    if (
      typeof callId !== 'string'
      || callId === ''
      || callId.trim() === ''
      || callId.trim() !== callId
    ) {
      response.status(400).json(INVALID_CALL_ID_RESPONSE);
      return;
    }

    try {
      const call = markCall({ callId });
      response.status(200).json({ call });
    } catch (error) {
      if (sendKnownCallServiceError(error, response)) {
        return;
      }
      next(error);
    }
  };
}

function createInternalCallRouter({
  requireInternalToken,
  callService,
} = {}) {
  if (
    typeof requireInternalToken !== 'function'
    || !callService
    || typeof callService.markCallConnecting !== 'function'
    || typeof callService.markCallActive !== 'function'
    || typeof callService.markCallEnded !== 'function'
    || typeof callService.markCallFailed !== 'function'
  ) {
    throw new TypeError(
      'requireInternalToken and callService are required'
    );
  }

  const internalCallRouter = express.Router();

  internalCallRouter.post(
    '/calls/:callId/connecting',
    requireInternalToken,
    createLifecycleHandler(callService.markCallConnecting)
  );
  internalCallRouter.post(
    '/calls/:callId/active',
    requireInternalToken,
    createLifecycleHandler(callService.markCallActive)
  );
  internalCallRouter.post(
    '/calls/:callId/ended',
    requireInternalToken,
    createLifecycleHandler(callService.markCallEnded)
  );
  internalCallRouter.post(
    '/calls/:callId/failed',
    requireInternalToken,
    createLifecycleHandler(callService.markCallFailed)
  );

  return internalCallRouter;
}

module.exports = {
  createInternalCallRouter,
};
