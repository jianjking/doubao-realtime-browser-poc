'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseAlipayFormBodyStrict,
} = require('../payments/alipay_crypto');
const {
  AlipayPaymentProvider,
} = require('../payments/alipay_payment_provider');
const {
  createPaymentProviderRegistry,
} = require('../payments/payment_provider_registry');
const {
  createPaymentHarness,
  seedUserAndAccount,
} = require('./payment_test_helpers');
const {
  createAlipayNotification,
  createTemporaryPaymentKeys,
  createTestAlipayConfig,
} = require('./payment_live_test_helpers');

function insertOrder(stores, {
  id = 'pay_alipay_notice',
  merchantOrderNo = 'MO_ALIPAY_NOTICE',
  amountCents = 725,
  clientRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} = {}) {
  const now = new Date().toISOString();
  stores.paymentOrderStore.insert({
    id,
    userId: 'payment-user-1',
    accountId: 'payment-user-1',
    provider: 'alipay',
    requestedScene: 'alipay_wap',
    merchantOrderNo,
    clientRequestId,
    amountCents,
    currency: 'CNY',
    createdAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  return stores.paymentOrderStore.findById(id);
}

test('Alipay notifications use notify ID and credit once under concurrency', async () => {
  const keys = createTemporaryPaymentKeys();
  const provider = new AlipayPaymentProvider({
    config: createTestAlipayConfig(keys),
  });
  const harness = createPaymentHarness({
    mode: 'live',
    providerRegistry: createPaymentProviderRegistry({
      mode: 'live',
      alipayProvider: provider,
    }),
  });
  try {
    seedUserAndAccount(harness.stores);
    const order = insertOrder(harness.stores);
    const notification = createAlipayNotification(keys, {
      out_trade_no: order.merchantOrderNo,
      trade_no: 'ALI_NOTICE_TRADE',
      notify_id: 'ALI_NOTICE_IDEMPOTENT',
      total_amount: '7.25',
      receipt_amount: '7.25',
    });
    const results = await Promise.all(Array.from({ length: 10 }, async () => {
      const parameters = parseAlipayFormBodyStrict(notification.rawBody);
      const event = await provider.verifyNotification({
        parameters,
        rawBody: notification.rawBody,
      });
      return harness.paymentService.processVerifiedProviderEvent(event);
    }));
    assert.equal(results.filter((result) => !result.alreadyProcessed).length, 1);
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1').balanceCents,
      1975
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId('payment-user-1').length,
      1
    );
    assert.equal(
      harness.stores.paymentNotificationStore
        .findByPaymentOrderId(order.id).length,
      1
    );
  } finally {
    harness.close();
    keys.cleanup();
  }
});

test('Alipay notification rejects signature, identity, status, and amount errors', async () => {
  const keys = createTemporaryPaymentKeys();
  const provider = new AlipayPaymentProvider({
    config: createTestAlipayConfig(keys),
  });
  const harness = createPaymentHarness({
    mode: 'live',
    providerRegistry: createPaymentProviderRegistry({
      mode: 'live',
      alipayProvider: provider,
    }),
  });
  try {
    seedUserAndAccount(harness.stores);
    const order = insertOrder(harness.stores);
    for (const overrides of [
      { app_id: '0000000000000001' },
      { seller_id: '0000000000000001' },
      { trade_status: 'WAIT_BUYER_PAY' },
    ]) {
      const notification = createAlipayNotification(keys, {
        out_trade_no: order.merchantOrderNo,
        total_amount: '7.25',
        receipt_amount: '7.25',
        ...overrides,
      });
      const parameters = parseAlipayFormBodyStrict(notification.rawBody);
      await assert.rejects(
        provider.verifyNotification({
          parameters,
          rawBody: notification.rawBody,
        }),
        (error) => error && error.code === 'PAYMENT_NOTIFICATION_INVALID'
      );
    }
    const badSignature = createAlipayNotification(keys, {
      out_trade_no: order.merchantOrderNo,
      total_amount: '7.25',
      receipt_amount: '7.25',
    });
    const signedParameters = parseAlipayFormBodyStrict(badSignature.rawBody);
    await assert.rejects(
      provider.verifyNotification({
        parameters: { ...signedParameters, sign: `${signedParameters.sign}A` },
        rawBody: badSignature.rawBody,
      }),
      (error) => error && error.code === 'PAYMENT_SIGNATURE_INVALID'
    );

    const wrongAmount = createAlipayNotification(keys, {
      out_trade_no: order.merchantOrderNo,
      trade_no: 'ALI_WRONG_AMOUNT',
      notify_id: 'ALI_WRONG_AMOUNT_NOTICE',
      total_amount: '7.26',
      receipt_amount: '7.26',
    });
    const wrongEvent = await provider.verifyNotification({
      parameters: parseAlipayFormBodyStrict(wrongAmount.rawBody),
      rawBody: wrongAmount.rawBody,
    });
    assert.throws(
      () => harness.paymentService.processVerifiedProviderEvent(wrongEvent),
      (error) => error && error.code === 'PAYMENT_AMOUNT_MISMATCH'
    );
    const unknownOrder = createAlipayNotification(keys, {
      out_trade_no: 'MO_ALIPAY_UNKNOWN',
      trade_no: 'ALI_UNKNOWN_ORDER',
      notify_id: 'ALI_UNKNOWN_ORDER_NOTICE',
      total_amount: '7.25',
      receipt_amount: '7.25',
    });
    const unknownEvent = await provider.verifyNotification({
      parameters: parseAlipayFormBodyStrict(unknownOrder.rawBody),
      rawBody: unknownOrder.rawBody,
    });
    assert.throws(
      () => harness.paymentService.processVerifiedProviderEvent(unknownEvent),
      (error) => error && error.code === 'PAYMENT_ORDER_NOT_FOUND'
    );
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1').balanceCents,
      1250
    );
  } finally {
    harness.close();
    keys.cleanup();
  }
});

test('Alipay missing notify ID uses a deterministic verified digest', async () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const provider = new AlipayPaymentProvider({
      config: createTestAlipayConfig(keys),
    });
    const notification = createAlipayNotification(keys, { notify_id: null });
    const parameters = parseAlipayFormBodyStrict(notification.rawBody);
    const first = await provider.verifyNotification({
      parameters,
      rawBody: notification.rawBody,
    });
    const second = await provider.verifyNotification({
      parameters,
      rawBody: notification.rawBody,
    });
    assert.match(first.providerEventId, /^alipay_digest_[0-9a-f]{64}$/);
    assert.equal(first.providerEventId, second.providerEventId);
  } finally {
    keys.cleanup();
  }
});
