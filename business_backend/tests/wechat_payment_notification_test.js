'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPaymentProviderRegistry,
} = require('../payments/payment_provider_registry');
const {
  WeChatPaymentProvider,
} = require('../payments/wechat_payment_provider');
const {
  createPaymentHarness,
  seedUserAndAccount,
} = require('./payment_test_helpers');
const {
  createTemporaryPaymentKeys,
  createTestWechatConfig,
  createWechatNotification,
} = require('./payment_live_test_helpers');

function insertOrder(stores, {
  id = 'pay_wechat_notice',
  merchantOrderNo = 'MO_WECHAT_NOTICE',
  amountCents = 1000,
  clientRequestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
} = {}) {
  const now = new Date().toISOString();
  stores.paymentOrderStore.insert({
    id,
    userId: 'payment-user-1',
    accountId: 'payment-user-1',
    provider: 'wechat',
    requestedScene: 'wechat_h5',
    merchantOrderNo,
    clientRequestId,
    amountCents,
    currency: 'CNY',
    createdAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  return stores.paymentOrderStore.findById(id);
}

function createTransaction(order, overrides = {}) {
  return {
    appid: 'wxTESTAPPID001',
    mchid: '0000000000',
    out_trade_no: order.merchantOrderNo,
    transaction_id: `WX_TRADE_${order.id}`,
    trade_state: 'SUCCESS',
    trade_type: 'MWEB',
    amount: {
      total: order.amountCents,
      payer_total: order.amountCents,
      currency: 'CNY',
    },
    success_time: '2026-08-02T08:00:00.000Z',
    ...overrides,
  };
}

test('WeChat verified notifications are idempotent under ten completions', async () => {
  const keys = createTemporaryPaymentKeys();
  const provider = new WeChatPaymentProvider({
    config: createTestWechatConfig(keys),
    allowTestUrls: true,
    apiBaseUrl: 'http://127.0.0.1:1',
  });
  const harness = createPaymentHarness({
    mode: 'live',
    providerRegistry: createPaymentProviderRegistry({
      mode: 'live',
      wechatProvider: provider,
    }),
  });
  try {
    seedUserAndAccount(harness.stores);
    const order = insertOrder(harness.stores);
    const notification = createWechatNotification(
      keys,
      createTransaction(order),
      { eventId: 'WX_NOTICE_IDEMPOTENT' }
    );
    const results = await Promise.all(Array.from({ length: 10 }, async () => {
      const event = await provider.verifyNotification(notification);
      return harness.paymentService.processVerifiedProviderEvent(event);
    }));
    assert.equal(results.filter((result) => !result.alreadyProcessed).length, 1);
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1').balanceCents,
      2250
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

    const secondOrder = insertOrder(harness.stores, {
      id: 'pay_wechat_notice_second',
      merchantOrderNo: 'MO_WECHAT_NOTICE_SECOND',
      clientRequestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    const duplicateTradeNotification = createWechatNotification(
      keys,
      createTransaction(secondOrder, {
        transaction_id: `WX_TRADE_${order.id}`,
      }),
      { eventId: 'WX_NOTICE_DUPLICATE_TRADE' }
    );
    const duplicateTradeEvent = await provider.verifyNotification(
      duplicateTradeNotification
    );
    assert.throws(
      () => harness.paymentService.processVerifiedProviderEvent(
        duplicateTradeEvent
      ),
      /UNIQUE constraint failed/
    );
    assert.equal(
      harness.stores.paymentOrderStore.findById(secondOrder.id).status,
      'pending'
    );
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1').balanceCents,
      2250
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId('payment-user-1').length,
      1
    );
  } finally {
    harness.close();
    keys.cleanup();
  }
});

test('WeChat notification rejects identity and amount tampering', async () => {
  const keys = createTemporaryPaymentKeys();
  const provider = new WeChatPaymentProvider({
    config: createTestWechatConfig(keys),
    allowTestUrls: true,
    apiBaseUrl: 'http://127.0.0.1:1',
  });
  const harness = createPaymentHarness({
    mode: 'live',
    providerRegistry: createPaymentProviderRegistry({
      mode: 'live',
      wechatProvider: provider,
    }),
  });
  try {
    seedUserAndAccount(harness.stores);
    const order = insertOrder(harness.stores);
    for (const transaction of [
      createTransaction(order, { appid: 'wxWRONGAPPID' }),
      createTransaction(order, { mchid: '0000000001' }),
    ]) {
      await assert.rejects(
        provider.verifyNotification(createWechatNotification(keys, transaction)),
        (error) => error && error.code === 'PAYMENT_NOTIFICATION_INVALID'
      );
    }
    const wrongAmount = createWechatNotification(
      keys,
      createTransaction(order, {
        amount: { total: 999, payer_total: 999, currency: 'CNY' },
      }),
      { eventId: 'WX_NOTICE_WRONG_AMOUNT' }
    );
    const wrongEvent = await provider.verifyNotification(wrongAmount);
    assert.throws(
      () => harness.paymentService.processVerifiedProviderEvent(wrongEvent),
      (error) => error && error.code === 'PAYMENT_AMOUNT_MISMATCH'
    );
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1').balanceCents,
      1250
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId('payment-user-1').length,
      0
    );
  } finally {
    harness.close();
    keys.cleanup();
  }
});
