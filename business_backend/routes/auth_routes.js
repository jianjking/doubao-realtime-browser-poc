'use strict';

const express = require('express');
const {
  SESSION_COOKIE_NAME,
} = require('../middleware/require_session');
const {
  GUEST_SESSION_TTL_SECONDS,
} = require('../services/session_service');

function createAuthRouter({ sessionService }) {
  const authRouter = express.Router();

  authRouter.post('/auth/guest', (_request, response) => {
    const {
      rawToken,
      authMode,
      principal,
      session,
    } = sessionService.createGuestSession();

    // Production HTTPS deployments must add the Secure attribute.
    response.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; `
        + `HttpOnly; SameSite=Lax; Path=/; `
        + `Max-Age=${GUEST_SESSION_TTL_SECONDS}`
    );
    response.status(201).json({
      authMode,
      principal,
      session,
    });
  });

  return authRouter;
}

module.exports = {
  createAuthRouter,
};
