'use strict';

const express = require('express');
const {
  AUTH_REQUIRED_RESPONSE,
} = require('../middleware/require_session');

const USER_LOGIN_REQUIRED_TO_RECHARGE_RESPONSE = {
  error: {
    code: 'USER_LOGIN_REQUIRED',
    message: 'Phone login is required to recharge',
  },
};

const ACCOUNT_UNAVAILABLE_RESPONSE = {
  error: {
    code: 'ACCOUNT_UNAVAILABLE',
    message: 'User account is unavailable',
  },
};

const DEV_RECHARGE_ERROR_STATUS_CODES = Object.freeze({
  INVALID_RECHARGE_AMOUNT: 400,
  ACCOUNT_UNAVAILABLE: 409,
});

function sendKnownRechargeError(error, response) {
  if (
    error
    && typeof error.code === 'string'
    && DEV_RECHARGE_ERROR_STATUS_CODES[error.code]
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

function createDevRechargeRouter({
  requireSession,
  userStore,
  accountService,
} = {}) {
  if (!requireSession || !userStore || !accountService) {
    throw new TypeError(
      'requireSession, userStore, and accountService are required'
    );
  }

  const devRechargeRouter = express.Router();

  devRechargeRouter.post(
    '/dev/recharge',
    requireSession,
    (request, response, next) => {
      if (request.auth.principal.type !== 'user') {
        response
          .status(403)
          .json(USER_LOGIN_REQUIRED_TO_RECHARGE_RESPONSE);
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
      const amountCents = (
        requestBody
        && typeof requestBody === 'object'
        && !Array.isArray(requestBody)
      )
        ? requestBody.amountCents
        : undefined;

      try {
        const updatedAccount =
          accountService.creditBalanceCentsForUser(
            user.id,
            amountCents
          );
        response.status(200).json({
          account: updatedAccount,
        });
      } catch (error) {
        if (sendKnownRechargeError(error, response)) {
          return;
        }
        next(error);
      }
    }
  );

  return devRechargeRouter;
}

module.exports = {
  createDevRechargeRouter,
};
