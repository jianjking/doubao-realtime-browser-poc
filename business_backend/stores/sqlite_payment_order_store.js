'use strict';

function mapPaymentOrderRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    provider: row.provider,
    requestedScene: row.requested_scene,
    merchantOrderNo: row.merchant_order_no,
    clientRequestId: row.client_request_id,
    providerTradeNo: row.provider_trade_no,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    creditedAt: row.credited_at,
    closedAt: row.closed_at,
    failureCode: row.failure_code,
  };
}

const ORDER_COLUMNS = `
  id,
  user_id,
  account_id,
  provider,
  requested_scene,
  merchant_order_no,
  client_request_id,
  provider_trade_no,
  amount_cents,
  currency,
  status,
  created_at,
  expires_at,
  paid_at,
  credited_at,
  closed_at,
  failure_code
`;

class SQLitePaymentOrderStore {
  #insertStatement;
  #findByIdStatement;
  #findByUserStatement;
  #findByUserClientRequestStatement;
  #findByMerchantOrderStatement;
  #closePendingStatement;
  #creditStatement;
  #failStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    this.#insertStatement = database.prepare(`
      INSERT INTO payment_orders (
        id,
        user_id,
        account_id,
        provider,
        requested_scene,
        merchant_order_no,
        client_request_id,
        provider_trade_no,
        amount_cents,
        currency,
        status,
        created_at,
        expires_at,
        paid_at,
        credited_at,
        closed_at,
        failure_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL)
    `);
    this.#findByIdStatement = database.prepare(`
      SELECT ${ORDER_COLUMNS}
      FROM payment_orders
      WHERE id = ?
    `);
    this.#findByUserStatement = database.prepare(`
      SELECT ${ORDER_COLUMNS}
      FROM payment_orders
      WHERE user_id = ?
      ORDER BY created_at, id
    `);
    this.#findByUserClientRequestStatement = database.prepare(`
      SELECT ${ORDER_COLUMNS}
      FROM payment_orders
      WHERE user_id = ? AND client_request_id = ?
    `);
    this.#findByMerchantOrderStatement = database.prepare(`
      SELECT ${ORDER_COLUMNS}
      FROM payment_orders
      WHERE merchant_order_no = ?
    `);
    this.#closePendingStatement = database.prepare(`
      UPDATE payment_orders
      SET status = 'closed', closed_at = ?, failure_code = NULL
      WHERE id = ? AND user_id = ? AND status = 'pending'
    `);
    this.#creditStatement = database.prepare(`
      UPDATE payment_orders
      SET
        status = 'credited',
        provider_trade_no = ?,
        paid_at = ?,
        credited_at = ?,
        closed_at = NULL,
        failure_code = NULL
      WHERE
        id = ?
        AND status IN ('pending', 'paid')
        AND (provider_trade_no IS NULL OR provider_trade_no = ?)
    `);
    this.#failStatement = database.prepare(`
      UPDATE payment_orders
      SET status = 'failed', failure_code = ?
      WHERE id = ? AND status IN ('pending', 'paid')
    `);
  }

  insert(order) {
    try {
      this.#insertStatement.run(
        order.id,
        order.userId,
        order.accountId,
        order.provider,
        order.requestedScene,
        order.merchantOrderNo,
        order.clientRequestId,
        order.amountCents,
        order.currency,
        order.createdAt,
        order.expiresAt
      );
      return true;
    } catch (error) {
      if (
        typeof error.code === 'string'
        && error.code.startsWith('SQLITE_CONSTRAINT')
        && this.findByUserAndClientRequestId(
          order.userId,
          order.clientRequestId
        )
      ) {
        return false;
      }
      throw error;
    }
  }

  findById(orderId) {
    return mapPaymentOrderRow(this.#findByIdStatement.get(orderId));
  }

  findByUserId(userId) {
    return this.#findByUserStatement.all(userId).map(mapPaymentOrderRow);
  }

  findByUserAndClientRequestId(userId, clientRequestId) {
    return mapPaymentOrderRow(
      this.#findByUserClientRequestStatement.get(userId, clientRequestId)
    );
  }

  findByMerchantOrderNo(merchantOrderNo) {
    return mapPaymentOrderRow(
      this.#findByMerchantOrderStatement.get(merchantOrderNo)
    );
  }

  closePending(orderId, userId, closedAt) {
    return this.#closePendingStatement.run(
      closedAt,
      orderId,
      userId
    ).changes;
  }

  markCredited(orderId, providerTradeNo, paidAt, creditedAt) {
    return this.#creditStatement.run(
      providerTradeNo,
      paidAt,
      creditedAt,
      orderId,
      providerTradeNo
    ).changes;
  }

  markFailed(orderId, failureCode) {
    return this.#failStatement.run(failureCode, orderId).changes;
  }
}

module.exports = {
  SQLitePaymentOrderStore,
};
