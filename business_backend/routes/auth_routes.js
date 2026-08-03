'use strict';

const express = require('express');
const {
  SESSION_COOKIE_NAME,
} = require('../middleware/require_session');
const {
  GUEST_SESSION_TTL_SECONDS,
} = require('../services/session_service');

function setSessionCookie(response, rawToken) {
  // Production HTTPS deployments must add the Secure attribute.
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; `
      + `HttpOnly; SameSite=Lax; Path=/; `
      + `Max-Age=${GUEST_SESSION_TTL_SECONDS}`
  );
}

function createAuthRouter({ sessionService, authService }) {
  const authRouter = express.Router();

  function sendPublicError(response, error) {
    if (
      !Number.isInteger(error.statusCode)
      || typeof error.code !== 'string'
      || typeof error.publicMessage !== 'string'
    ) {
      return false;
    }
    if (Number.isInteger(error.retryAfterSeconds)) {
      response.setHeader('Retry-After', error.retryAfterSeconds);
    }
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.publicMessage,
        ...(Number.isInteger(error.retryAfterSeconds)
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    });
    return true;
  }

  authRouter.post('/auth/guest', (_request, response) => {
    const {
      rawToken,
      authMode,
      principal,
      session,
    } = sessionService.createGuestSession();

    setSessionCookie(response, rawToken);
    response.status(201).json({
      authMode,
      principal,
      session,
    });
  });

  authRouter.post('/auth/sms/send', async (request, response, next) => {
    try {
      const result = await authService.sendSmsCode(request.body, {
        requestIp: request.ip || request.socket.remoteAddress,
      });
      response.status(201).json(result);
    } catch (error) {
      if (!sendPublicError(response, error)) {
        next(error);
      }
    }
  });

  authRouter.post('/auth/login', async (request, response, next) => {
    try {
      const {
        rawToken,
        authMode,
        principal,
        profile,
        session,
        verifyResult,
      } = await authService.login(request.body);

      setSessionCookie(response, rawToken);
      response.status(200).json({
        authMode,
        principal,
        profile,
        session,
        verification: {
          verifyResult,
        },
      });
    } catch (error) {
      if (!sendPublicError(response, error)) {
        next(error);
      }
    }
  });

  return authRouter;
}

module.exports = {
  createAuthRouter,
  setSessionCookie,
};
