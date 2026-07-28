'use strict';

const express = require('express');
const {
  SESSION_COOKIE_NAME,
  readCookie,
} = require('../middleware/require_session');

function createFortuneRouter({
  fortuneService,
  sessionService,
} = {}) {
  if (!fortuneService || !sessionService) {
    throw new TypeError(
      'fortuneService and sessionService are required'
    );
  }

  const fortuneRouter = express.Router();

  fortuneRouter.post(
    '/fortune-sessions',
    (request, response) => {
      const body = (
        request.body
        && typeof request.body === 'object'
        && !Array.isArray(request.body)
      )
        ? request.body
        : {};
      const rawToken = readCookie(
        request.headers.cookie,
        SESSION_COOKIE_NAME
      );
      const auth = sessionService.verifySession(rawToken);
      const ownerType = auth ? auth.principal.type : 'anonymous';
      const ownerId = auth ? auth.principal.id : null;

      try {
        const fortuneSession = fortuneService.createDrawnSession({
          deityKey: body.deityKey,
          situationText: body.situationText,
          ownerType,
          ownerId,
        });
        response.status(201).json({ fortuneSession });
      } catch (error) {
        if (
          error
          && error.statusCode === 400
          && error.code === 'INVALID_FORTUNE_REQUEST'
          && typeof error.publicMessage === 'string'
        ) {
          response.status(400).json({
            error: {
              code: error.code,
              message: error.publicMessage,
            },
          });
          return;
        }
        response.status(500).json({
          error: {
            code: 'FORTUNE_SERVICE_UNAVAILABLE',
            message: 'Fortune service is temporarily unavailable',
          },
        });
      }
    }
  );

  return fortuneRouter;
}

module.exports = {
  createFortuneRouter,
};
