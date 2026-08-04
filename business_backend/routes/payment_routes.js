'use strict';

const express = require('express');
const net = require('node:net');

const {
  AUTH_REQUIRED_RESPONSE,
} = require('../middleware/require_session');

const USER_LOGIN_REQUIRED_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: 'USER_LOGIN_REQUIRED',
    message: 'Phone login is required for payment',
  }),
});

function sendKnownPaymentError(error, response) {
  if (
    error
    && Number.isInteger(error.statusCode)
    && typeof error.code === 'string'
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

function requirePaymentUser(request, response, userStore) {
  if (request.auth.principal.type !== 'user') {
    response.status(403).json(USER_LOGIN_REQUIRED_RESPONSE);
    return null;
  }
  const user = userStore.findById(request.auth.principal.id);
  if (!user || user.status !== 'active') {
    response.status(401).json(AUTH_REQUIRED_RESPONSE);
    return null;
  }
  return user;
}

function isEmptyRequestBody(requestBody) {
  return requestBody === undefined
    || (
      requestBody
      && typeof requestBody === 'object'
      && !Array.isArray(requestBody)
      && Object.keys(requestBody).length === 0
    );
}

function isLoopbackIp(address) {
  return (net.isIPv4(address) && address.startsWith('127.'))
    || address === '::1';
}

function normalizeTrustedClientIp(request) {
  const address = request && typeof request.ip === 'string'
    ? request.ip
    : '';
  const normalized = address.startsWith('::ffff:')
    ? address.slice(7)
    : address;
  if (!net.isIP(normalized)) {
    return '';
  }

  const trustProxy = request
    && request.app
    && typeof request.app.get === 'function'
    ? request.app.get('trust proxy')
    : false;
  if (
    trustProxy
    && isLoopbackIp(normalized)
    && (!Array.isArray(request.ips) || request.ips.length === 0)
  ) {
    return '';
  }
  return normalized;
}

function createPaymentRouter({
  requireSession,
  userStore,
  paymentService,
  resolveTrustedPaymentContext = () => ({}),
} = {}) {
  if (!requireSession || !userStore || !paymentService) {
    throw new TypeError(
      'requireSession, userStore, and paymentService are required'
    );
  }
  if (typeof resolveTrustedPaymentContext !== 'function') {
    throw new TypeError('resolveTrustedPaymentContext must be a function');
  }
  const router = express.Router();

  router.post('/payment-orders', requireSession, async (
    request,
    response,
    next
  ) => {
    const user = requirePaymentUser(request, response, userStore);
    if (!user) {
      return;
    }
    const requestBody = request.body;
    if (
      !requestBody
      || typeof requestBody !== 'object'
      || Array.isArray(requestBody)
      || Object.keys(requestBody).some(
        (key) => !['provider', 'amountCents', 'clientRequestId'].includes(key)
      )
    ) {
      response.status(400).json({
        error: {
          code: 'INVALID_PAYMENT_REQUEST',
          message: 'Payment request is invalid',
        },
      });
      return;
    }

    try {
      const trustedContext = await resolveTrustedPaymentContext({
        request,
        user,
      });
      const result = await paymentService.createPaymentOrder({
        userId: user.id,
        provider: requestBody.provider,
        amountCents: requestBody.amountCents,
        clientRequestId: requestBody.clientRequestId,
        context: {
          userAgent: typeof request.headers['user-agent'] === 'string'
            ? request.headers['user-agent'].slice(0, 512)
            : '',
          payerClientIp: trustedContext
            && typeof trustedContext.payerClientIp === 'string'
            ? trustedContext.payerClientIp
            : normalizeTrustedClientIp(request),
          wechatOpenId: trustedContext
            && typeof trustedContext.wechatOpenId === 'string'
            ? trustedContext.wechatOpenId
            : '',
        },
      });
      response.status(result.alreadyCreated ? 200 : 201).json({
        order: result.order,
        checkout: result.checkout,
      });
    } catch (error) {
      if (!sendKnownPaymentError(error, response)) {
        next(error);
      }
    }
  });

  router.get('/payment-orders/:orderId', requireSession, async (
    request,
    response,
    next
  ) => {
    const user = requirePaymentUser(request, response, userStore);
    if (!user) {
      return;
    }
    try {
      response.status(200).json({
        order: await paymentService.getPaymentOrderForUser(
          user.id,
          request.params.orderId
        ),
      });
    } catch (error) {
      if (!sendKnownPaymentError(error, response)) {
        next(error);
      }
    }
  });

  router.post('/payment-orders/:orderId/mock-complete', requireSession, async (
    request,
    response,
    next
  ) => {
    const user = requirePaymentUser(request, response, userStore);
    if (!user) {
      return;
    }
    if (!isEmptyRequestBody(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_PAYMENT_REQUEST',
          message: 'Mock payment completion body must be empty',
        },
      });
      return;
    }
    try {
      const result = await paymentService.completeMockPayment(
        user.id,
        request.params.orderId
      );
      response.status(200).json(result);
    } catch (error) {
      if (!sendKnownPaymentError(error, response)) {
        next(error);
      }
    }
  });

  router.post('/payment-orders/:orderId/close', requireSession, async (
    request,
    response,
    next
  ) => {
    const user = requirePaymentUser(request, response, userStore);
    if (!user) {
      return;
    }
    if (!isEmptyRequestBody(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_PAYMENT_REQUEST',
          message: 'Close payment order body must be empty',
        },
      });
      return;
    }
    try {
      response.status(200).json(
        await paymentService.closePaymentOrder(
          user.id,
          request.params.orderId
        )
      );
    } catch (error) {
      if (!sendKnownPaymentError(error, response)) {
        next(error);
      }
    }
  });

  return router;
}

module.exports = {
  createPaymentRouter,
  normalizeTrustedClientIp,
  sendKnownPaymentError,
};
