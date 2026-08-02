'use strict';

class PaymentProvider {
  async createCheckout(_order, _context) {
    throw new Error('createCheckout is not implemented');
  }

  async verifyNotification(_request) {
    throw new Error('verifyNotification is not implemented');
  }

  async queryPayment(_order) {
    throw new Error('queryPayment is not implemented');
  }

  async closePayment(_order) {
    throw new Error('closePayment is not implemented');
  }
}

module.exports = {
  PaymentProvider,
};
