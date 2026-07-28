'use strict';

const DEFAULT_INITIAL_BALANCE_CENTS = 1250;
const DEFAULT_INITIAL_REMAINING_SECONDS = 0;

function validateInitialValue(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function validateUserId(userId) {
  if (typeof userId !== 'string' || userId === '') {
    throw new TypeError('userId must be a non-empty string');
  }
}

function createAccountUnavailableError() {
  const error = new Error('User account is unavailable');
  error.statusCode = 409;
  error.code = 'ACCOUNT_UNAVAILABLE';
  error.publicMessage = 'User account is unavailable';
  return error;
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
    validateUserId(userId);

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

  function debitBalanceCentsForUser(userId, amountCents) {
    validateUserId(userId);
    if (
      !Number.isSafeInteger(amountCents)
      || amountCents < 0
    ) {
      throw new TypeError(
        'amountCents must be a non-negative safe integer'
      );
    }

    const account = accountStore.findByUserId(userId);
    if (!account || account.status !== 'active') {
      throw createAccountUnavailableError();
    }
    if (amountCents === 0) {
      return getPublicAccountForUser(userId);
    }

    const balanceCents = account.balanceCents - amountCents;
    if (!Number.isSafeInteger(balanceCents)) {
      throw new RangeError(
        'resulting balanceCents must be a safe integer'
      );
    }

    accountStore.replace({
      ...account,
      balanceCents,
      updatedAt: new Date(clock()).toISOString(),
    });
    return getPublicAccountForUser(userId);
  }

  return {
    debitBalanceCentsForUser,
    ensureAccountForUser,
    getPublicAccountForUser,
  };
}

module.exports = {
  createAccountService,
};
