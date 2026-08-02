'use strict';

const {
  createPaymentProviderRegistry,
} = require('../payments/payment_provider_registry');
const { createPaymentService } = require('../services/payment_service');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');

function seedUserAndAccount(stores, {
  userId = 'payment-user-1',
  phoneE164 = '+8613800000000',
  balanceCents = 1250,
  now = new Date().toISOString(),
} = {}) {
  stores.userStore.save({
    id: userId,
    phoneE164,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  stores.accountStore.save({
    userId,
    currency: 'CNY',
    balanceCents,
    remainingSeconds: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  return userId;
}

function createPaymentHarness({
  databasePath = ':memory:',
  initialNow = Date.now(),
  mode = 'mock',
  mockConfirmationEnabled = true,
  nodeEnv = 'test',
  orderTtlMs,
} = {}) {
  let now = initialNow;
  const clock = () => now;
  const stores = createBusinessStores({ databasePath, clock });
  const providerRegistry = createPaymentProviderRegistry({ mode });
  const paymentService = createPaymentService({
    ...stores,
    providerRegistry,
    clock,
    mockConfirmationEnabled,
    nodeEnv,
    orderTtlMs,
  });
  return {
    clock,
    close: stores.close,
    paymentService,
    providerRegistry,
    setNow(value) {
      now = value;
    },
    stores,
  };
}

module.exports = {
  createPaymentHarness,
  seedUserAndAccount,
};
