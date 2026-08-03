'use strict';

const express = require('express');
const {
  AUTH_REQUIRED_RESPONSE,
} = require('../middleware/require_session');

const USER_LOGIN_REQUIRED_TO_START_CALL_RESPONSE = {
  error: {
    code: 'USER_LOGIN_REQUIRED',
    message: 'Phone login is required to start a call',
  },
};

const USER_LOGIN_REQUIRED_TO_ACCESS_CALL_RESPONSE = {
  error: {
    code: 'USER_LOGIN_REQUIRED',
    message: 'Phone login is required to access a call',
  },
};

const ACCOUNT_UNAVAILABLE_RESPONSE = {
  error: {
    code: 'ACCOUNT_UNAVAILABLE',
    message: 'User account is unavailable',
  },
};

const CALL_SERVICE_ERROR_STATUS_CODES = Object.freeze({
  INVALID_CALL_REQUEST: 400,
  INVALID_CALL_ID: 400,
  CALL_NOT_FOUND: 404,
  ROLE_NOT_FOUND: 404,
  ROLE_UNAVAILABLE: 409,
  ACCOUNT_UNAVAILABLE: 409,
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

function createCallRouter({
  requireSession,
  userStore,
  accountService,
  callService,
} = {}) {
  if (
    !requireSession
    || !userStore
    || !accountService
    || !callService
  ) {
    throw new TypeError(
      'requireSession, userStore, accountService, and callService '
        + 'are required'
    );
  }

  const callRouter = express.Router();

  callRouter.post('/calls', requireSession, (request, response, next) => {
    if (request.auth.principal.type !== 'user') {
      response
        .status(403)
        .json(USER_LOGIN_REQUIRED_TO_START_CALL_RESPONSE);
      return;
    }

    const user = userStore.findById(request.auth.principal.id);
    if (!user || user.status !== 'active') {
      response.status(401).json(AUTH_REQUIRED_RESPONSE);
      return;
    }

    const account = accountService.getPublicAccountForUser(user.id);
    if (!account) {
      response.status(409).json(ACCOUNT_UNAVAILABLE_RESPONSE);
      return;
    }

    const requestBody = request.body;
    const roleSlug = (
      requestBody
      && typeof requestBody === 'object'
      && !Array.isArray(requestBody)
    )
      ? requestBody.roleSlug
      : undefined;

    try {
      const call = callService.createPendingCall({
        userId: user.id,
        roleSlug,
      });
      response.status(201).json({ call });
    } catch (error) {
      if (sendKnownCallServiceError(error, response)) {
        return;
      }
      next(error);
    }
  });

  callRouter.get(
    '/calls/:callId/admission',
    requireSession,
    (request, response, next) => {
      if (request.auth.principal.type !== 'user') {
        response
          .status(403)
          .json(USER_LOGIN_REQUIRED_TO_ACCESS_CALL_RESPONSE);
        return;
      }

      const user = userStore.findById(request.auth.principal.id);
      if (!user || user.status !== 'active') {
        response.status(401).json(AUTH_REQUIRED_RESPONSE);
        return;
      }

      try {
        const call = callService.getPendingCallAdmissionForUser({
          userId: user.id,
          callId: request.params.callId,
        });
        response.status(200).json({ call });
      } catch (error) {
        if (sendKnownCallServiceError(error, response)) {
          return;
        }
        next(error);
      }
    }
  );

  callRouter.get(
    '/calls/:callId',
    requireSession,
    (request, response, next) => {
      if (request.auth.principal.type !== 'user') {
        response
          .status(403)
          .json(USER_LOGIN_REQUIRED_TO_ACCESS_CALL_RESPONSE);
        return;
      }

      const user = userStore.findById(request.auth.principal.id);
      if (!user || user.status !== 'active') {
        response.status(401).json(AUTH_REQUIRED_RESPONSE);
        return;
      }

      try {
        const call = callService.getPublicCallForUser({
          userId: user.id,
          callId: request.params.callId,
        });
        response.status(200).json({ call });
      } catch (error) {
        if (sendKnownCallServiceError(error, response)) {
          return;
        }
        next(error);
      }
    }
  );

  return callRouter;
}

module.exports = {
  createCallRouter,
};
