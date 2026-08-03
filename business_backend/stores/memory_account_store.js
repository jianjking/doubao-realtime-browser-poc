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

class MemoryAccountStore {
  #accountsByUserId;

  constructor() {
    this.#accountsByUserId = new Map();
  }

  save(account) {
    validateAccount(account);
    if (this.#accountsByUserId.has(account.userId)) {
      throw new Error('Account already exists for userId');
    }
    this.#accountsByUserId.set(account.userId, { ...account });
  }

  findByUserId(userId) {
    const account = this.#accountsByUserId.get(userId);
    return account ? { ...account } : null;
  }

  replace(account) {
    validateAccount(account, { allowNegativeBalance: true });
    const existingAccount = this.#accountsByUserId.get(account.userId);
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
    this.#accountsByUserId.set(account.userId, { ...account });
  }

  debitBalanceCentsForFortune({ userId, amountCents, updatedAt }) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      throw new TypeError('Fortune debit amount must be a positive integer');
    }
    const account = this.#accountsByUserId.get(userId);
    if (
      !account
      || account.status !== 'active'
      || account.currency !== 'CNY'
      || account.balanceCents < amountCents
    ) {
      return 0;
    }
    this.#accountsByUserId.set(userId, {
      ...account,
      balanceCents: account.balanceCents - amountCents,
      updatedAt,
    });
    return 1;
  }
}

module.exports = {
  MemoryAccountStore,
};
