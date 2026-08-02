'use strict';

const express = require('express');

const {
  parseAlipayFormBodyStrict,
} = require('../payments/alipay_crypto');
const {
  createProviderModeError,
} = require('../payments/payment_provider_registry');
const {
  isKnownPaymentError,
} = require('../payments/payment_errors');

const PAYMENT_NOTIFICATION_BODY_LIMIT = '32kb';

function requireLiveProvider(providerRegistry, provider) {
  if (providerRegistry.mode !== 'live') {
    throw createProviderModeError(
      providerRegistry.mode === 'disabled' ? 'disabled' : 'live'
    );
  }
  return providerRegistry.get(provider);
}

function createPaymentNotificationRouter({
  providerRegistry,
  paymentService,
} = {}) {
  if (!providerRegistry || !paymentService) {
    throw new TypeError('providerRegistry and paymentService are required');
  }
  const router = express.Router();

  router.post(
    '/payment-notifications/wechat',
    express.raw({
      type: 'application/json',
      limit: PAYMENT_NOTIFICATION_BODY_LIMIT,
    }),
    async (request, response) => {
      if (!request.is('application/json') || !Buffer.isBuffer(request.body)) {
        response.status(415).json({
          error: {
            code: 'PAYMENT_NOTIFICATION_INVALID',
            message: 'WeChat payment notification must use JSON',
          },
        });
        return;
      }
      try {
        const provider = requireLiveProvider(providerRegistry, 'wechat');
        const verifiedEvent = await provider.verifyNotification({
          headers: request.headers,
          rawBody: request.body,
        });
        paymentService.processVerifiedProviderEvent(verifiedEvent);
        response.status(204).end();
      } catch (error) {
        if (isKnownPaymentError(error)) {
          response.status(error.statusCode >= 500 ? 503 : error.statusCode)
            .json({
              error: {
                code: error.code,
                message: 'Payment notification was rejected',
              },
            });
          return;
        }
        response.status(500).json({
          error: {
            code: 'PAYMENT_NOTIFICATION_PROCESSING_FAILED',
            message: 'Payment notification could not be processed',
          },
        });
      }
    }
  );

  router.post(
    '/payment-notifications/alipay',
    express.raw({
      type: 'application/x-www-form-urlencoded',
      limit: PAYMENT_NOTIFICATION_BODY_LIMIT,
    }),
    async (request, response) => {
      response.type('text/plain');
      if (
        !request.is('application/x-www-form-urlencoded')
        || !Buffer.isBuffer(request.body)
      ) {
        response.status(415).send('failure');
        return;
      }
      try {
        const parameters = parseAlipayFormBodyStrict(request.body);
        const provider = requireLiveProvider(providerRegistry, 'alipay');
        const verifiedEvent = await provider.verifyNotification({
          parameters,
          rawBody: request.body,
        });
        paymentService.processVerifiedProviderEvent(verifiedEvent);
        response.status(200).send('success');
      } catch (error) {
        if (isKnownPaymentError(error)) {
          response.status(error.statusCode >= 500 ? 503 : 400).send('failure');
          return;
        }
        response.status(500).send('failure');
      }
    }
  );

  router.use((error, request, response, next) => {
    if (error && error.type === 'entity.too.large') {
      if (request.path.endsWith('/alipay')) {
        response.type('text/plain').status(413).send('failure');
      } else {
        response.status(413).json({
          error: {
            code: 'PAYMENT_NOTIFICATION_TOO_LARGE',
            message: 'Payment notification body is too large',
          },
        });
      }
      return;
    }
    next(error);
  });

  return router;
}

module.exports = {
  PAYMENT_NOTIFICATION_BODY_LIMIT,
  createPaymentNotificationRouter,
  requireLiveProvider,
};
