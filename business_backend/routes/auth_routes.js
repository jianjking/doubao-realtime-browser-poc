'use strict';

const express = require('express');
const {
  SESSION_COOKIE_NAME,
} = require('../middleware/require_session');
const {
  GUEST_SESSION_TTL_SECONDS,
} = require('../services/session_service');

function createSessionCookieHeader(rawToken, { secure = false } = {}) {
  const attributes = [
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${GUEST_SESSION_TTL_SECONDS}`,
  ];
  if (secure) {
    attributes.push('Secure');
  }
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; `
    + attributes.join('; ');
}

function setSessionCookie(response, rawToken, options) {
  response.setHeader(
    'Set-Cookie',
    createSessionCookieHeader(rawToken, options)
  );
}

function createAuthRouter({ sessionService, authService, nodeEnv = '' }) {
  const authRouter = express.Router();
  const sessionCookieOptions = Object.freeze({
    secure: nodeEnv === 'production',
  });

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

    setSessionCookie(response, rawToken, sessionCookieOptions);
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

      setSessionCookie(response, rawToken, sessionCookieOptions);
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
  createSessionCookieHeader,
  createAuthRouter,
  setSessionCookie,
};
