'use strict';

const DEFAULT_INITIAL_BALANCE_CENTS = 1250;
const DEFAULT_INITIAL_REMAINING_SECONDS = 0;

function validateInitialValue(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function createAccountService({
  accountStore,
  clock = Date.now,
  initialBalanceCents = DEFAULT_INITIAL_BALANCE_CENTS,
  initialRemainingSeconds = DEFAULT_INITIAL_REMAINING_SECONDS,
} = {}) {
  if (!accountStore) {
    throw new TypeError('accountStore is required');
  }
  validateInitialValue(initialBalanceCents, 'initialBalanceCents');
  validateInitialValue(
    initialRemainingSeconds,
    'initialRemainingSeconds'
  );

  function ensureAccountForUser(userId) {
    if (typeof userId !== 'string' || userId === '') {
      throw new TypeError('userId must be a non-empty string');
    }

    const existingAccount = accountStore.findByUserId(userId);
    if (existingAccount) {
      return existingAccount;
    }

    const now = new Date(clock()).toISOString();
    const account = {
      userId,
      currency: 'CNY',
      balanceCents: initialBalanceCents,
      remainingSeconds: initialRemainingSeconds,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    accountStore.save(account);
    return { ...account };
  }

  function getPublicAccountForUser(userId) {
    const account = accountStore.findByUserId(userId);
    if (!account || account.status !== 'active') {
      return null;
    }
    return {
      currency: account.currency,
      balanceCents: account.balanceCents,
      remainingSeconds: account.remainingSeconds,
    };
  }

  return {
    ensureAccountForUser,
    getPublicAccountForUser,
  };
}

module.exports = {
  createAccountService,
};
