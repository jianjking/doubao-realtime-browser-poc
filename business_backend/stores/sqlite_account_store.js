'use strict';

function validateAccount(account, {
  allowNegativeBalance = false,
} = {}) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new TypeError('account must be an object');
  }
  if (typeof account.userId !== 'string' || account.userId === '') {
    throw new TypeError('account.userId must be a non-empty string');
  }
  if (account.currency !== 'CNY') {
    throw new TypeError('account.currency must be CNY');
  }
  if (
    !Number.isSafeInteger(account.balanceCents)
    || (!allowNegativeBalance && account.balanceCents < 0)
  ) {
    throw new TypeError(
      allowNegativeBalance
        ? 'account.balanceCents must be a safe integer'
        : 'account.balanceCents must be a non-negative safe integer'
    );
  }
  if (
    !Number.isSafeInteger(account.remainingSeconds)
    || account.remainingSeconds < 0
  ) {
    throw new TypeError(
      'account.remainingSeconds must be a non-negative safe integer'
    );
  }
  if (account.status !== 'active') {
    throw new TypeError('account.status must be active');
  }
  if (
    typeof account.createdAt !== 'string'
    || typeof account.updatedAt !== 'string'
  ) {
    throw new TypeError(
      'account.createdAt and account.updatedAt must be strings'
    );
  }
}

function mapAccountRow(row) {
  if (!row) {
    return null;
  }
  return {
    userId: row.user_id,
    currency: row.currency,
    balanceCents: row.balance_cents,
    remainingSeconds: row.remaining_seconds,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SQLiteAccountStore {
  #findStatement;
  #insertStatement;
  #replaceStatement;
  #creditForPaymentStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    this.#insertStatement = database.prepare(`
      INSERT INTO accounts (
        user_id,
        currency,
        balance_cents,
        remaining_seconds,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#findStatement = database.prepare(`
      SELECT
        user_id,
        currency,
        balance_cents,
        remaining_seconds,
        status,
        created_at,
        updated_at
      FROM accounts
      WHERE user_id = ?
    `);
    this.#replaceStatement = database.prepare(`
      UPDATE accounts
      SET
        balance_cents = ?,
        remaining_seconds = ?,
        status = ?,
        updated_at = ?
      WHERE
        user_id = ?
        AND currency = ?
        AND created_at = ?
    `);
    this.#creditForPaymentStatement = database.prepare(`
      UPDATE accounts
      SET balance_cents = ?, updated_at = ?
      WHERE
        user_id = ?
        AND currency = 'CNY'
        AND status = 'active'
        AND balance_cents = ?
    `);
  }

  save(account) {
    validateAccount(account);
    if (this.findByUserId(account.userId)) {
      throw new Error('Account already exists for userId');
    }
    try {
      this.#insertStatement.run(
        account.userId,
        account.currency,
        account.balanceCents,
        account.remainingSeconds,
        account.status,
        account.createdAt,
        account.updatedAt
      );
    } catch (error) {
      if (
        typeof error.code === 'string'
        && error.code.startsWith('SQLITE_CONSTRAINT')
        && this.findByUserId(account.userId)
      ) {
        throw new Error('Account already exists for userId');
      }
      throw error;
    }
  }

  findByUserId(userId) {
    return mapAccountRow(this.#findStatement.get(userId));
  }

  replace(account) {
    validateAccount(account, { allowNegativeBalance: true });
    const existingAccount = this.findByUserId(account.userId);
    if (!existingAccount) {
      throw new Error('Account does not exist');
    }
    if (
      account.userId !== existingAccount.userId
      || account.currency !== existingAccount.currency
      || account.createdAt !== existingAccount.createdAt
    ) {
      throw new Error('Account identity fields cannot be changed');
    }

    const result = this.#replaceStatement.run(
      account.balanceCents,
      account.remainingSeconds,
      account.status,
      account.updatedAt,
      account.userId,
      account.currency,
      account.createdAt
    );
    if (result.changes !== 1) {
      throw new Error('Account identity fields cannot be changed');
    }
  }

  creditBalanceCentsForPayment({
    userId,
    balanceBeforeCents,
    balanceAfterCents,
    updatedAt,
  }) {
    if (
      !Number.isSafeInteger(balanceBeforeCents)
      || !Number.isSafeInteger(balanceAfterCents)
      || balanceAfterCents < balanceBeforeCents
    ) {
      throw new TypeError('Payment balance values must be safe integers');
    }
    return this.#creditForPaymentStatement.run(
      balanceAfterCents,
      updatedAt,
      userId,
      balanceBeforeCents
    ).changes;
  }
}

module.exports = {
  SQLiteAccountStore,
};
