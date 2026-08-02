'use strict';

const crypto = require('node:crypto');

const {
  MAX_PAYMENT_AMOUNT_CENTS,
  MIN_PAYMENT_AMOUNT_CENTS,
  PAYMENT_ORDER_TTL_MS,
  PAYMENT_PROVIDERS,
} = require('../config/payments');

const CLIENT_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createPaymentError(statusCode, code, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function validateUserId(userId) {
  if (typeof userId !== 'string' || userId === '') {
    throw new TypeError('userId must be a non-empty string');
  }
}

function validateOrderId(orderId) {
  if (typeof orderId !== 'string' || orderId === '') {
    throw createPaymentError(
      404,
      'PAYMENT_ORDER_NOT_FOUND',
      'Payment order was not found'
    );
  }
}

function validateCreateRequest({ provider, amountCents, clientRequestId }) {
  if (!PAYMENT_PROVIDERS.includes(provider)) {
    throw createPaymentError(
      400,
      'INVALID_PAYMENT_REQUEST',
      'Payment provider is invalid'
    );
  }
  if (
    !Number.isSafeInteger(amountCents)
    || amountCents < MIN_PAYMENT_AMOUNT_CENTS
    || amountCents > MAX_PAYMENT_AMOUNT_CENTS
  ) {
    throw createPaymentError(
      400,
      'INVALID_PAYMENT_AMOUNT',
      'Payment amount is invalid'
    );
  }
  if (
    typeof clientRequestId !== 'string'
    || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)
  ) {
    throw createPaymentError(
      400,
      'INVALID_PAYMENT_REQUEST',
      'A valid clientRequestId is required'
    );
  }
}

function toPublicOrder(order) {
  if (!order) {
    return null;
  }
  return Object.freeze({
    id: order.id,
    provider: order.provider,
    requestedScene: order.requestedScene,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    creditedAt: order.creditedAt,
    closedAt: order.closedAt,
    failureCode: order.failureCode,
  });
}

function toPublicAccount(account) {
  if (!account || account.status !== 'active') {
    return null;
  }
  return Object.freeze({
    currency: account.currency,
    balanceCents: account.balanceCents,
    remainingSeconds: account.remainingSeconds,
  });
}

function digestVerifiedEvent(event) {
  const canonicalPayload = JSON.stringify({
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerTradeNo: event.providerTradeNo,
    merchantOrderNo: event.merchantOrderNo,
    amountCents: event.amountCents,
    currency: event.currency,
    paymentStatus: event.paymentStatus,
    paidAt: event.paidAt,
    requestedScene: event.requestedScene || '',
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

function createPaymentService({
  userStore,
  accountStore,
  paymentOrderStore,
  paymentNotificationStore,
  accountLedgerStore,
  providerRegistry,
  runInTransaction,
  clock = Date.now,
  idGenerator = () => crypto.randomUUID(),
  mockConfirmationEnabled = false,
  nodeEnv = '',
  orderTtlMs = PAYMENT_ORDER_TTL_MS,
} = {}) {
  if (
    !userStore
    || !accountStore
    || !paymentOrderStore
    || !paymentNotificationStore
    || !accountLedgerStore
    || !providerRegistry
    || typeof runInTransaction !== 'function'
  ) {
    throw new TypeError('Payment service dependencies are required');
  }
  if (typeof clock !== 'function' || typeof idGenerator !== 'function') {
    throw new TypeError('clock and idGenerator must be functions');
  }
  if (!Number.isSafeInteger(orderTtlMs) || orderTtlMs < 1) {
    throw new TypeError('orderTtlMs must be a positive safe integer');
  }

  function requireActiveUserAndAccount(userId) {
    validateUserId(userId);
    const user = userStore.findById(userId);
    if (!user || user.status !== 'active') {
      throw createPaymentError(
        401,
        'USER_LOGIN_REQUIRED',
        'Phone login is required for payment'
      );
    }
    const account = accountStore.findByUserId(userId);
    if (!account || account.status !== 'active') {
      throw createPaymentError(
        409,
        'ACCOUNT_UNAVAILABLE',
        'User account is unavailable'
      );
    }
    return account;
  }

  function requireOwnedOrder(userId, orderId) {
    validateUserId(userId);
    validateOrderId(orderId);
    const order = paymentOrderStore.findById(orderId);
    if (!order || order.userId !== userId) {
      throw createPaymentError(
        404,
        'PAYMENT_ORDER_NOT_FOUND',
        'Payment order was not found'
      );
    }
    return order;
  }

  async function createCheckout(order, context = {}) {
    const provider = providerRegistry.get(order.provider);
    return provider.createCheckout(order, context);
  }

  async function createPaymentOrder({
    userId,
    provider,
    amountCents,
    clientRequestId,
    context = {},
  }) {
    validateCreateRequest({ provider, amountCents, clientRequestId });
    const paymentProvider = providerRegistry.get(provider);
    const account = requireActiveUserAndAccount(userId);

    const existingOrder =
      paymentOrderStore.findByUserAndClientRequestId(
        userId,
        clientRequestId
      );
    if (existingOrder) {
      return {
        order: toPublicOrder(existingOrder),
        checkout: await createCheckout(existingOrder, context),
        alreadyCreated: true,
      };
    }

    const createdAtMs = clock();
    const createdAt = new Date(createdAtMs).toISOString();
    const requestedScene = typeof paymentProvider.getRequestedScene === 'function'
      ? paymentProvider.getRequestedScene(context)
      : providerRegistry.mode === 'mock'
        ? 'mock'
        : '';
    if (![
      'wechat_jsapi',
      'wechat_h5',
      'alipay_wap',
      'mock',
    ].includes(requestedScene)) {
      throw createPaymentError(
        400,
        'INVALID_PAYMENT_REQUEST',
        'Payment scene is invalid'
      );
    }
    const order = {
      id: `pay_${idGenerator()}`,
      userId,
      accountId: account.userId,
      provider,
      requestedScene,
      merchantOrderNo: `MO${String(idGenerator()).replace(/-/g, '')}`,
      clientRequestId,
      providerTradeNo: null,
      amountCents,
      currency: 'CNY',
      status: 'pending',
      createdAt,
      expiresAt: new Date(createdAtMs + orderTtlMs).toISOString(),
      paidAt: null,
      creditedAt: null,
      closedAt: null,
      failureCode: null,
    };
    const inserted = paymentOrderStore.insert(order);
    const storedOrder = inserted
      ? paymentOrderStore.findById(order.id)
      : paymentOrderStore.findByUserAndClientRequestId(
        userId,
        clientRequestId
      );
    if (!storedOrder) {
      throw new Error('Payment order could not be persisted');
    }

    return {
      order: toPublicOrder(storedOrder),
      checkout: await createCheckout(storedOrder, context),
      alreadyCreated: !inserted,
    };
  }

  async function getPaymentOrderForUser(userId, orderId) {
    requireActiveUserAndAccount(userId);
    const order = requireOwnedOrder(userId, orderId);
    if (
      providerRegistry.mode === 'live'
      && ['pending', 'paid'].includes(order.status)
    ) {
      try {
        const provider = providerRegistry.get(order.provider);
        const queryResult = await provider.queryPayment(order);
        if (queryResult && queryResult.verifiedEvent) {
          return processVerifiedProviderEvent(queryResult.verifiedEvent).order;
        }
      } catch {
        // A transient or uncertain provider query never changes local funds.
      }
    }
    return toPublicOrder(paymentOrderStore.findById(order.id));
  }

  function validateVerifiedEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw createPaymentError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Payment notification is invalid'
      );
    }
    for (const field of [
      'provider',
      'providerEventId',
      'providerTradeNo',
      'merchantOrderNo',
      'currency',
      'paymentStatus',
      'paidAt',
    ]) {
      if (typeof event[field] !== 'string' || event[field] === '') {
        throw createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment notification is invalid'
        );
      }
    }
    if (!Number.isSafeInteger(event.amountCents) || event.amountCents < 1) {
      throw createPaymentError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Payment notification is invalid'
      );
    }
    if (
      event.rawDigest !== undefined
      && (
        typeof event.rawDigest !== 'string'
        || !/^[0-9a-f]{64}$/.test(event.rawDigest)
      )
    ) {
      throw createPaymentError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Payment notification is invalid'
      );
    }
    if (
      event.requestedScene !== undefined
      && !['wechat_jsapi', 'wechat_h5', 'alipay_wap', 'mock']
        .includes(event.requestedScene)
    ) {
      throw createPaymentError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Payment notification is invalid'
      );
    }
  }

  function processVerifiedProviderEvent(event) {
    validateVerifiedEvent(event);
    const payloadDigest = event.rawDigest || digestVerifiedEvent(event);
    const receivedAt = new Date(clock()).toISOString();
    let transactionResult;
    let processingError = null;

    runInTransaction(() => {
      const order = paymentOrderStore.findByMerchantOrderNo(
        event.merchantOrderNo
      );
      const insertion = paymentNotificationStore.insertVerified({
        id: `notice_${idGenerator()}`,
        provider: event.provider,
        providerEventId: event.providerEventId,
        paymentOrderId: order ? order.id : null,
        payloadDigest,
        receivedAt,
      });

      if (!insertion.inserted) {
        const existingNotification = insertion.notification;
        if (
          existingNotification.payloadDigest !== payloadDigest
          || existingNotification.verificationStatus !== 'verified'
        ) {
          processingError = createPaymentError(
            400,
            'PAYMENT_NOTIFICATION_INVALID',
            'Payment notification is invalid'
          );
          return;
        }
        if (existingNotification.processingStatus === 'processed') {
          const processedOrder = paymentOrderStore.findById(
            existingNotification.paymentOrderId
          );
          const processedAccount = processedOrder
            ? accountStore.findByUserId(processedOrder.userId)
            : null;
          transactionResult = {
            order: toPublicOrder(processedOrder),
            account: toPublicAccount(processedAccount),
            alreadyProcessed: true,
          };
          return;
        }
        processingError = createPaymentError(
          409,
          existingNotification.failureCode || 'PAYMENT_NOTIFICATION_INVALID',
          'Payment notification could not be processed'
        );
        return;
      }

      const notification = insertion.notification;
      function rejectEvent(error) {
        paymentNotificationStore.markFailed(
          notification.id,
          receivedAt,
          error.code
        );
        processingError = error;
      }

      if (!order) {
        rejectEvent(createPaymentError(
          404,
          'PAYMENT_ORDER_NOT_FOUND',
          'Payment order was not found'
        ));
        return;
      }
      if (event.provider !== order.provider) {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment provider does not match the order'
        ));
        return;
      }
      if (
        event.requestedScene
        && event.requestedScene !== order.requestedScene
      ) {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment scene does not match the order'
        ));
        return;
      }
      if (event.amountCents !== order.amountCents) {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_AMOUNT_MISMATCH',
          'Payment amount does not match the order'
        ));
        return;
      }
      if (event.currency !== order.currency || event.currency !== 'CNY') {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment currency does not match the order'
        ));
        return;
      }
      if (event.paymentStatus !== 'success') {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment was not successful'
        ));
        return;
      }
      if (Number.isNaN(Date.parse(event.paidAt))) {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment time is invalid'
        ));
        return;
      }
      if (
        order.providerTradeNo
        && order.providerTradeNo !== event.providerTradeNo
      ) {
        rejectEvent(createPaymentError(
          400,
          'PAYMENT_NOTIFICATION_INVALID',
          'Payment trade number does not match the order'
        ));
        return;
      }
      if (order.status === 'credited') {
        paymentNotificationStore.markProcessed(
          notification.id,
          receivedAt
        );
        transactionResult = {
          order: toPublicOrder(order),
          account: toPublicAccount(accountStore.findByUserId(order.userId)),
          alreadyProcessed: true,
        };
        return;
      }
      if (!['pending', 'paid'].includes(order.status)) {
        rejectEvent(createPaymentError(
          409,
          'PAYMENT_ORDER_NOT_PAYABLE',
          'Payment order is not payable'
        ));
        return;
      }

      const account = accountStore.findByUserId(order.accountId);
      if (
        !account
        || account.userId !== order.userId
        || account.status !== 'active'
        || account.currency !== 'CNY'
      ) {
        rejectEvent(createPaymentError(
          409,
          'ACCOUNT_UNAVAILABLE',
          'User account is unavailable'
        ));
        return;
      }
      const balanceAfterCents = account.balanceCents + order.amountCents;
      if (!Number.isSafeInteger(balanceAfterCents)) {
        rejectEvent(createPaymentError(
          400,
          'INVALID_PAYMENT_AMOUNT',
          'Payment amount is invalid'
        ));
        return;
      }

      const creditedAt = receivedAt;
      const updatedAccountRows = accountStore.creditBalanceCentsForPayment({
        userId: account.userId,
        balanceBeforeCents: account.balanceCents,
        balanceAfterCents,
        updatedAt: creditedAt,
      });
      if (updatedAccountRows !== 1) {
        throw new Error('Concurrent payment account update failed');
      }
      accountLedgerStore.insertRecharge({
        id: `ledger_${idGenerator()}`,
        accountId: order.accountId,
        userId: order.userId,
        paymentOrderId: order.id,
        amountCents: order.amountCents,
        balanceBeforeCents: account.balanceCents,
        balanceAfterCents,
        createdAt: creditedAt,
      });
      if (
        paymentOrderStore.markCredited(
          order.id,
          event.providerTradeNo,
          event.paidAt,
          creditedAt
        ) !== 1
      ) {
        throw new Error('Concurrent payment order update failed');
      }
      if (
        paymentNotificationStore.markProcessed(
          notification.id,
          creditedAt
        ) !== 1
      ) {
        throw new Error('Payment notification update failed');
      }

      transactionResult = {
        order: toPublicOrder(paymentOrderStore.findById(order.id)),
        account: toPublicAccount(accountStore.findByUserId(order.userId)),
        alreadyProcessed: false,
      };
    });

    if (processingError) {
      throw processingError;
    }
    if (!transactionResult || !transactionResult.order) {
      throw new Error('Payment event did not produce a result');
    }
    return transactionResult;
  }

  async function completeMockPayment(userId, orderId) {
    requireActiveUserAndAccount(userId);
    if (
      providerRegistry.mode !== 'mock'
      || !mockConfirmationEnabled
      || nodeEnv === 'production'
    ) {
      throw createPaymentError(
        403,
        'PAYMENT_MOCK_CONFIRMATION_DISABLED',
        'Mock payment confirmation is disabled'
      );
    }

    const order = requireOwnedOrder(userId, orderId);
    if (order.status === 'credited') {
      return {
        order: toPublicOrder(order),
        account: toPublicAccount(accountStore.findByUserId(userId)),
        alreadyProcessed: true,
      };
    }
    if (Date.parse(order.expiresAt) <= clock()) {
      throw createPaymentError(
        409,
        'PAYMENT_ORDER_EXPIRED',
        'Payment order has expired'
      );
    }
    if (!['pending', 'paid'].includes(order.status)) {
      throw createPaymentError(
        409,
        'PAYMENT_ORDER_NOT_PAYABLE',
        'Payment order is not payable'
      );
    }

    const provider = providerRegistry.get(order.provider);
    const paidAt = new Date(clock()).toISOString();
    const mockEvent = provider.createSuccessEvent(order, paidAt);
    const verifiedEvent = await provider.verifyNotification(mockEvent);
    return processVerifiedProviderEvent(verifiedEvent);
  }

  async function closePaymentOrder(userId, orderId) {
    requireActiveUserAndAccount(userId);
    const order = requireOwnedOrder(userId, orderId);
    if (order.status === 'closed') {
      return { order: toPublicOrder(order), alreadyClosed: true };
    }
    if (order.status !== 'pending') {
      throw createPaymentError(
        409,
        'PAYMENT_ORDER_NOT_PAYABLE',
        'Only pending payment orders can be closed'
      );
    }
    const provider = providerRegistry.get(order.provider);
    if (providerRegistry.mode === 'live') {
      const providerResult = await provider.closePayment(order);
      if (providerResult && providerResult.verifiedEvent) {
        const credited = processVerifiedProviderEvent(
          providerResult.verifiedEvent
        );
        return {
          order: credited.order,
          alreadyClosed: false,
          credited: true,
        };
      }
      if (!providerResult || providerResult.closed !== true) {
        throw createPaymentError(
          409,
          'PAYMENT_ORDER_STATUS_UNCERTAIN',
          'Payment order status is not safe to close'
        );
      }
    }

    if (
      paymentOrderStore.closePending(
        order.id,
        userId,
        new Date(clock()).toISOString()
      ) !== 1
    ) {
      throw createPaymentError(
        409,
        'PAYMENT_ORDER_NOT_PAYABLE',
        'Payment order is not payable'
      );
    }
    const closedOrder = paymentOrderStore.findById(order.id);
    if (providerRegistry.mode === 'mock') {
      await provider.closePayment(closedOrder);
    }
    return { order: toPublicOrder(closedOrder), alreadyClosed: false };
  }

  return Object.freeze({
    closePaymentOrder,
    completeMockPayment,
    createCheckout,
    createPaymentOrder,
    getPaymentOrderForUser,
    processVerifiedProviderEvent,
  });
}

module.exports = {
  createPaymentError,
  createPaymentService,
  digestVerifiedEvent,
  toPublicOrder,
};
