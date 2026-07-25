'use strict';

function validateAccount(account) {
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
    || account.balanceCents < 0
  ) {
    throw new TypeError(
      'account.balanceCents must be a non-negative safe integer'
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
}

module.exports = {
  MemoryAccountStore,
};
