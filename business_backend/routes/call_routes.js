'use strict';

const express = require('express');
const {
  AUTH_REQUIRED_RESPONSE,
} = require('../middleware/require_session');

const USER_LOGIN_REQUIRED_RESPONSE = {
  error: {
    code: 'USER_LOGIN_REQUIRED',
    message: 'Phone login is required to start a call',
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
  ROLE_NOT_FOUND: 404,
  ROLE_UNAVAILABLE: 409,
});

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
      response.status(403).json(USER_LOGIN_REQUIRED_RESPONSE);
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
        return;
      }
      next(error);
    }
  });

  return callRouter;
}

module.exports = {
  createCallRouter,
};
