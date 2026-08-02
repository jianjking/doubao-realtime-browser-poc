'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parsePaymentRuntimeConfig,
} = require('../config/payments');
const {
  createPaymentHarness,
  seedUserAndAccount,
} = require('./payment_test_helpers');

const CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111111';

async function createOrder(harness, overrides = {}) {
  return harness.paymentService.createPaymentOrder({
    userId: 'payment-user-1',
    provider: 'wechat',
    amountCents: 1000,
    clientRequestId: CLIENT_REQUEST_ID,
    ...overrides,
  });
}

test('payment mode defaults closed and production rejects mock', () => {
  assert.deepEqual(parsePaymentRuntimeConfig({}), {
    alipay: {
      configured: false,
      enabled: false,
    },
    mode: 'disabled',
    mockConfirmationEnabled: false,
    nodeEnv: '',
    wechat: {
      configured: false,
      enabled: false,
    },
  });
  assert.throws(
    () => parsePaymentRuntimeConfig({
      NODE_ENV: 'production',
      PAYMENT_PROVIDER_MODE: 'mock',
      PAYMENT_MOCK_CONFIRMATION_ENABLED: '1',
    }),
    /forbidden in production/
  );
  assert.throws(
    () => parsePaymentRuntimeConfig({ PAYMENT_PROVIDER_MODE: 'unknown' }),
    /PAYMENT_PROVIDER_MODE/
  );
});

test('order creation validates money and is idempotent by client request ID', async () => {
  const harness = createPaymentHarness();
  try {
    seedUserAndAccount(harness.stores);
    for (const amountCents of [
      0,
      -1,
      1.5,
      '1000',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      100001,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await assert.rejects(
        createOrder(harness, { amountCents }),
        (error) => error && error.code === 'INVALID_PAYMENT_AMOUNT'
      );
    }

    const first = await createOrder(harness);
    const repeated = await createOrder(harness, {
      amountCents: 2000,
      provider: 'alipay',
    });
    assert.equal(first.order.id, repeated.order.id);
    assert.equal(repeated.alreadyCreated, true);
    assert.equal(repeated.order.amountCents, 1000);
    assert.equal(repeated.order.provider, 'wechat');
    assert.equal(first.checkout.kind, 'mock');
    assert.equal(first.checkout.notice, '模拟支付，不会产生真实扣款');
  } finally {
    harness.close();
  }
});

test('duplicate and ten concurrent mock completions credit exactly once', async () => {
  const harness = createPaymentHarness();
  try {
    seedUserAndAccount(harness.stores);
    const created = await createOrder(harness);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => (
        harness.paymentService.completeMockPayment(
          'payment-user-1',
          created.order.id
        )
      ))
    );
    assert.equal(
      results.filter((result) => !result.alreadyProcessed).length,
      1
    );
    assert.equal(
      results.filter((result) => result.alreadyProcessed).length,
      9
    );

    const order = harness.stores.paymentOrderStore.findById(
      created.order.id
    );
    const creditedAt = order.creditedAt;
    const tradeNo = order.providerTradeNo;
    const repeated = await harness.paymentService.completeMockPayment(
      'payment-user-1',
      created.order.id
    );
    assert.equal(repeated.alreadyProcessed, true);
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1')
        .balanceCents,
      2250
    );
    assert.equal(
      harness.stores.accountLedgerStore.findByAccountId('payment-user-1')
        .length,
      1
    );
    assert.equal(
      harness.stores.paymentNotificationStore.findByPaymentOrderId(
        created.order.id
      ).length,
      1
    );
    assert.equal(
      harness.stores.paymentOrderStore.findById(created.order.id).creditedAt,
      creditedAt
    );
    assert.equal(
      harness.stores.paymentOrderStore.findById(created.order.id)
        .providerTradeNo,
      tradeNo
    );
  } finally {
    harness.close();
  }
});

test('verified event rejects amount, provider, and currency tampering', async () => {
  for (const mutation of [
    (event) => ({ ...event, amountCents: event.amountCents + 1,
      providerEventId: `${event.providerEventId}_amount` }),
    (event) => ({ ...event, provider: 'alipay',
      providerEventId: `${event.providerEventId}_provider` }),
    (event) => ({ ...event, currency: 'USD',
      providerEventId: `${event.providerEventId}_currency` }),
  ]) {
    const harness = createPaymentHarness();
    try {
      seedUserAndAccount(harness.stores);
      const created = await createOrder(harness);
      const internalOrder = harness.stores.paymentOrderStore.findById(
        created.order.id
      );
      const event = harness.providerRegistry.mockProvider.createSuccessEvent(
        internalOrder,
        new Date(harness.clock()).toISOString()
      );
      assert.throws(
        () => harness.paymentService.processVerifiedProviderEvent(
          mutation(event)
        ),
        (error) => error && [
          'PAYMENT_AMOUNT_MISMATCH',
          'PAYMENT_NOTIFICATION_INVALID',
        ].includes(error.code)
      );
      assert.equal(
        harness.stores.accountStore.findByUserId('payment-user-1')
          .balanceCents,
        1250
      );
      assert.equal(
        harness.stores.paymentOrderStore.findById(created.order.id).status,
        'pending'
      );
      assert.equal(
        harness.stores.accountLedgerStore.findByAccountId('payment-user-1')
          .length,
        0
      );
    } finally {
      harness.close();
    }
  }
});

test('closed, failed, and expired orders cannot be credited', async () => {
  const initialNow = Date.now();
  const harness = createPaymentHarness({ initialNow, orderTtlMs: 1000 });
  try {
    seedUserAndAccount(harness.stores);
    const closed = await createOrder(harness);
    await harness.paymentService.closePaymentOrder(
      'payment-user-1',
      closed.order.id
    );
    await assert.rejects(
      harness.paymentService.completeMockPayment(
        'payment-user-1',
        closed.order.id
      ),
      (error) => error && error.code === 'PAYMENT_ORDER_NOT_PAYABLE'
    );

    const expired = await createOrder(harness, {
      clientRequestId: '22222222-2222-4222-8222-222222222222',
    });
    harness.setNow(initialNow + 1001);
    await assert.rejects(
      harness.paymentService.completeMockPayment(
        'payment-user-1',
        expired.order.id
      ),
      (error) => error && error.code === 'PAYMENT_ORDER_EXPIRED'
    );

    harness.setNow(initialNow);
    const failed = await createOrder(harness, {
      clientRequestId: '33333333-3333-4333-8333-333333333333',
    });
    harness.stores.paymentOrderStore.markFailed(
      failed.order.id,
      'SYNTHETIC_FAILURE'
    );
    await assert.rejects(
      harness.paymentService.completeMockPayment(
        'payment-user-1',
        failed.order.id
      ),
      (error) => error && error.code === 'PAYMENT_ORDER_NOT_PAYABLE'
    );
    assert.equal(
      harness.stores.accountStore.findByUserId('payment-user-1')
        .balanceCents,
      1250
    );
  } finally {
    harness.close();
  }
});

test('ledger, account, and order failures roll back the whole transaction', async () => {
  const failureCases = [
    ['accountStore', 'creditBalanceCentsForPayment'],
    ['accountLedgerStore', 'insertRecharge'],
    ['paymentOrderStore', 'markCredited'],
  ];
  for (const [storeName, methodName] of failureCases) {
    const harness = createPaymentHarness();
    try {
      seedUserAndAccount(harness.stores);
      const created = await createOrder(harness);
      const store = harness.stores[storeName];
      const original = store[methodName].bind(store);
      store[methodName] = () => {
        throw new Error(`synthetic ${methodName} failure`);
      };
      await assert.rejects(
        harness.paymentService.completeMockPayment(
          'payment-user-1',
          created.order.id
        ),
        new RegExp(`synthetic ${methodName} failure`)
      );
      store[methodName] = original;
      assert.equal(
        harness.stores.accountStore.findByUserId('payment-user-1')
          .balanceCents,
        1250
      );
      assert.equal(
        harness.stores.paymentOrderStore.findById(created.order.id).status,
        'pending'
      );
      assert.equal(
        harness.stores.accountLedgerStore.findByAccountId('payment-user-1')
          .length,
        0
      );
      assert.equal(
        harness.stores.paymentNotificationStore.findByPaymentOrderId(
          created.order.id
        ).length,
        0
      );
    } finally {
      harness.close();
    }
  }
});

test('disabled and live provider modes fail closed', async () => {
  for (const [mode, expectedCode] of [
    ['disabled', 'PAYMENT_PROVIDER_DISABLED'],
    ['live', 'PAYMENT_PROVIDER_NOT_CONFIGURED'],
  ]) {
    const harness = createPaymentHarness({ mode });
    try {
      seedUserAndAccount(harness.stores);
      await assert.rejects(
        createOrder(harness),
        (error) => error && error.code === expectedCode
      );
      assert.equal(
        harness.stores.paymentOrderStore.findByUserAndClientRequestId(
          'payment-user-1',
          CLIENT_REQUEST_ID
        ),
        null
      );
    } finally {
      harness.close();
    }
  }
});
