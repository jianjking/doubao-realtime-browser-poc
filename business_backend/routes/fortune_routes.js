'use strict';

const express = require('express');
const {
  SESSION_COOKIE_NAME,
  readCookie,
} = require('../middleware/require_session');

const INTERPRETATION_ERROR_STATUS_CODES = Object.freeze({
  INVALID_FORTUNE_INTERPRETATION_REQUEST: 400,
  FORTUNE_SESSION_NOT_FOUND: 404,
  FORTUNE_SESSION_NOT_DRAWN: 409,
  FORTUNE_MODEL_INVALID_OUTPUT: 502,
  FORTUNE_MODEL_UNSAFE_OUTPUT: 502,
  FORTUNE_MODEL_FAILED: 502,
  FORTUNE_MODEL_UNAVAILABLE: 503,
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sendInterpretationError(error, response) {
  if (
    error
    && typeof error.code === 'string'
    && INTERPRETATION_ERROR_STATUS_CODES[error.code]
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
  response.status(500).json({
    error: {
      code: 'FORTUNE_INTERPRETATION_FAILED',
      message: 'Fortune interpretation could not be completed',
    },
  });
}

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

  fortuneRouter.post(
    '/fortune-sessions/:sessionId/interpretation',
    async (request, response) => {
      const bodyIsAllowed = (
        request.body === undefined
        || (
          isPlainObject(request.body)
          && Object.keys(request.body).length === 0
        )
      );
      if (!bodyIsAllowed) {
        response.status(400).json({
          error: {
            code: 'INVALID_FORTUNE_INTERPRETATION_REQUEST',
            message: 'Interpretation request body must be empty',
          },
        });
        return;
      }

      try {
        const result = await fortuneService.interpretSession(
          request.params.sessionId
        );
        response.status(200).json(result);
      } catch (error) {
        sendInterpretationError(error, response);
      }
    }
  );

  return fortuneRouter;
}

module.exports = {
  createFortuneRouter,
};
