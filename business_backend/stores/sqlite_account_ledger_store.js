'use strict';

function mapLedgerRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    accountId: row.account_id,
    userId: row.user_id,
    paymentOrderId: row.payment_order_id,
    entryType: row.entry_type,
    amountCents: row.amount_cents,
    balanceBeforeCents: row.balance_before_cents,
    balanceAfterCents: row.balance_after_cents,
    createdAt: row.created_at,
  };
}

class SQLiteAccountLedgerStore {
  #insertStatement;
  #findByPaymentOrderStatement;
  #findByAccountStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    this.#insertStatement = database.prepare(`
      INSERT INTO account_ledger (
        id,
        account_id,
        user_id,
        payment_order_id,
        entry_type,
        amount_cents,
        balance_before_cents,
        balance_after_cents,
        created_at
      ) VALUES (?, ?, ?, ?, 'recharge', ?, ?, ?, ?)
    `);
    this.#findByPaymentOrderStatement = database.prepare(`
      SELECT
        id,
        account_id,
        user_id,
        payment_order_id,
        entry_type,
        amount_cents,
        balance_before_cents,
        balance_after_cents,
        created_at
      FROM account_ledger
      WHERE payment_order_id = ? AND entry_type = 'recharge'
    `);
    this.#findByAccountStatement = database.prepare(`
      SELECT
        id,
        account_id,
        user_id,
        payment_order_id,
        entry_type,
        amount_cents,
        balance_before_cents,
        balance_after_cents,
        created_at
      FROM account_ledger
      WHERE account_id = ?
      ORDER BY created_at, id
    `);
  }

  insertRecharge(entry) {
    this.#insertStatement.run(
      entry.id,
      entry.accountId,
      entry.userId,
      entry.paymentOrderId,
      entry.amountCents,
      entry.balanceBeforeCents,
      entry.balanceAfterCents,
      entry.createdAt
    );
  }

  findRechargeByPaymentOrderId(paymentOrderId) {
    return mapLedgerRow(
      this.#findByPaymentOrderStatement.get(paymentOrderId)
    );
  }

  findByAccountId(accountId) {
    return this.#findByAccountStatement.all(accountId).map(mapLedgerRow);
  }
}

module.exports = {
  SQLiteAccountLedgerStore,
};
