'use strict';

const crypto = require('node:crypto');

const { PAYMENT_NOTICE } = require('../config/payments');
const { PaymentProvider } = require('./payment_provider');

function createStableMockReference(prefix, order) {
  const digest = crypto
    .createHash('sha256')
    .update(`${order.id}:${order.merchantOrderNo}:${order.provider}`)
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${order.provider}_${digest}`;
}

class MockPaymentProvider extends PaymentProvider {
  async createCheckout(order) {
    return Object.freeze({
      kind: 'mock',
      provider: order.provider,
      notice: PAYMENT_NOTICE,
    });
  }

  createSuccessEvent(order, paidAt) {
    return Object.freeze({
      provider: order.provider,
      providerEventId: createStableMockReference('mock_event', order),
      providerTradeNo: createStableMockReference('mock_trade', order),
      merchantOrderNo: order.merchantOrderNo,
      amountCents: order.amountCents,
      currency: order.currency,
      paymentStatus: 'success',
      paidAt,
    });
  }

  async verifyNotification(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('Mock payment event is required');
    }
    return Object.freeze({ ...event });
  }

  async queryPayment(order) {
    return Object.freeze({
      provider: order.provider,
      status: order.status,
    });
  }

  async closePayment(order) {
    return Object.freeze({
      provider: order.provider,
      closed: order.status === 'closed',
    });
  }
}

module.exports = {
  MockPaymentProvider,
};
