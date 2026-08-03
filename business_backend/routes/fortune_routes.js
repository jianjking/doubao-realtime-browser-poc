'use strict';

const express = require('express');
const {
  SESSION_COOKIE_NAME,
  readCookie,
} = require('../middleware/require_session');

const INTERPRETATION_ERROR_STATUS_CODES = Object.freeze({
  INVALID_FORTUNE_INTERPRETATION_REQUEST: 400,
  FORTUNE_SESSION_NOT_FOUND: 404,
  FORTUNE_SESSION_ACCESS_DENIED: 404,
  FORTUNE_SESSION_NOT_DRAWN: 409,
  FORTUNE_MODEL_INVALID_OUTPUT: 502,
  FORTUNE_MODEL_UNSAFE_OUTPUT: 502,
  FORTUNE_MODEL_FAILED: 502,
  FORTUNE_MODEL_UNAVAILABLE: 503,
});
const FORTUNE_DRAW_ERROR_STATUS_CODES = Object.freeze({
  USER_LOGIN_REQUIRED: 401,
  INVALID_FORTUNE_REQUEST: 400,
  INVALID_CLIENT_REQUEST_ID: 400,
  ACCOUNT_UNAVAILABLE: 409,
  INSUFFICIENT_ACCOUNT_BALANCE: 409,
  FORTUNE_SESSION_NOT_FOUND: 404,
  FORTUNE_SESSION_ACCESS_DENIED: 404,
});
const INTERPRETATION_AUDIO_ERROR_STATUS_CODES = Object.freeze({
  INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST: 400,
  FORTUNE_SESSION_NOT_FOUND: 404,
  FORTUNE_SESSION_ACCESS_DENIED: 404,
  FORTUNE_INTERPRETATION_NOT_READY: 409,
  FORTUNE_TTS_FAILED: 502,
  FORTUNE_TTS_UNAVAILABLE: 503,
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEmptyAudioRequestBody(request) {
  if (isPlainObject(request.body)) {
    return Object.keys(request.body).length === 0;
  }
  if (request.body !== undefined) {
    return false;
  }
  const contentLength = request.headers['content-length'];
  return (
    (
      contentLength === undefined
      || contentLength === '0'
    )
    && request.headers['transfer-encoding'] === undefined
  );
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

function sendInterpretationAudioError(error, response) {
  if (
    error
    && typeof error.code === 'string'
    && INTERPRETATION_AUDIO_ERROR_STATUS_CODES[error.code]
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
      code: 'FORTUNE_INTERPRETATION_AUDIO_FAILED',
      message: 'Fortune interpretation audio could not be completed',
    },
  });
}

function sendLoginRequired(response) {
  response.status(401).json({
    error: {
      code: 'USER_LOGIN_REQUIRED',
      message: 'Phone login is required for paid Fortune drawing',
    },
  });
}

function readAuthenticatedUser(request, response, sessionService) {
  const rawToken = readCookie(
    request.headers.cookie,
    SESSION_COOKIE_NAME
  );
  const auth = sessionService.verifySession(rawToken);
  if (!auth || auth.principal.type !== 'user') {
    sendLoginRequired(response);
    return null;
  }
  return auth.principal;
}

function sendFortuneDrawError(error, response) {
  if (
    error
    && typeof error.code === 'string'
    && (
      FORTUNE_DRAW_ERROR_STATUS_CODES[error.code] === error.statusCode
      || (
        error.code === 'FORTUNE_CHARGE_FAILED'
        && (error.statusCode === 409 || error.statusCode === 500)
      )
    )
    && typeof error.publicMessage === 'string'
  ) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.publicMessage,
        ...(error.publicDetails || {}),
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

function createFortuneRouter({
  fortuneService,
  sessionService,
  pricingConfig,
} = {}) {
  if (
    !fortuneService
    || !sessionService
    || !pricingConfig
    || !Number.isSafeInteger(pricingConfig.drawPriceCents)
  ) {
    throw new TypeError(
      'fortuneService and sessionService are required'
    );
  }

  const fortuneRouter = express.Router();

  fortuneRouter.get('/fortune-config', (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(200).json({
      drawPriceCents: pricingConfig.drawPriceCents,
      currency: 'CNY',
      chargeTiming: 'fortune_session_created',
    });
  });

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
      const principal = readAuthenticatedUser(
        request,
        response,
        sessionService
      );
      if (!principal) {
        return;
      }

      const allowedFields = new Set([
        'clientRequestId',
        'characterKey',
        'situationText',
      ]);
      if (Object.keys(body).some((field) => !allowedFields.has(field))) {
        response.status(400).json({
          error: {
            code: 'INVALID_FORTUNE_REQUEST',
            message: 'Fortune request contains unsupported fields',
          },
        });
        return;
      }

      try {
        const result = fortuneService.createPaidFortuneSession({
          userId: principal.id,
          clientRequestId: body.clientRequestId,
          characterKey: body.characterKey,
          situationText: body.situationText,
        });
        response.status(result.charge.alreadyProcessed ? 200 : 201).json(
          result
        );
      } catch (error) {
        sendFortuneDrawError(error, response);
      }
    }
  );

  fortuneRouter.get(
    '/fortune-sessions/:sessionId',
    (request, response) => {
      const principal = readAuthenticatedUser(
        request,
        response,
        sessionService
      );
      if (!principal) {
        return;
      }
      try {
        response.set('Cache-Control', 'no-store');
        response.status(200).json(
          fortuneService.getPaidFortuneSession(
            principal.id,
            request.params.sessionId
          )
        );
      } catch (error) {
        sendFortuneDrawError(error, response);
      }
    }
  );

  fortuneRouter.post(
    '/fortune-sessions/:sessionId/interpretation',
    async (request, response) => {
      const principal = readAuthenticatedUser(
        request,
        response,
        sessionService
      );
      if (!principal) {
        return;
      }
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
          principal.id,
          request.params.sessionId
        );
        response.status(200).json(result);
      } catch (error) {
        sendInterpretationError(error, response);
      }
    }
  );

  fortuneRouter.post(
    '/fortune-sessions/:sessionId/interpretation-audio',
    async (request, response) => {
      const principal = readAuthenticatedUser(
        request,
        response,
        sessionService
      );
      if (!principal) {
        return;
      }
      if (!isEmptyAudioRequestBody(request)) {
        response.status(400).json({
          error: {
            code: 'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST',
            message: 'Interpretation audio request body must be empty',
          },
        });
        return;
      }

      try {
        const result =
          await fortuneService.synthesizeInterpretationAudio(
            principal.id,
            request.params.sessionId
          );
        response.status(200);
        response.set({
          'Content-Type': result.contentType,
          'Content-Length': String(result.audioBuffer.length),
          'Cache-Control': 'no-store',
        });
        response.send(result.audioBuffer);
      } catch (error) {
        sendInterpretationAudioError(error, response);
      }
    }
  );

  return fortuneRouter;
}

module.exports = {
  createFortuneRouter,
};
