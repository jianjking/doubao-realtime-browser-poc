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

  authRouter.post('/auth/login', (request, response, next) => {
    try {
      const {
        rawToken,
        authMode,
        principal,
        profile,
        session,
      } = authService.login(request.body);

      setSessionCookie(response, rawToken);
      response.status(200).json({
        authMode,
        principal,
        profile,
        session,
      });
    } catch (error) {
      if (
        Number.isInteger(error.statusCode)
        && typeof error.code === 'string'
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

  return authRouter;
}

module.exports = {
  createAuthRouter,
  setSessionCookie,
};
