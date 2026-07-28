'use strict';

const CALL_FIELDS = new Set([
  'id',
  'userId',
  'roleSlug',
  'billingUnitMs',
  'pricePerBillingUnitFen',
  'chargeFen',
  'status',
  'createdAt',
  'startedAt',
  'endedAt',
]);

const CALL_STATUSES = new Set([
  'pending',
  'connecting',
  'active',
  'ended',
  'failed',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function validateCall(call) {
  if (
    !call
    || typeof call !== 'object'
    || Array.isArray(call)
    || Object.getPrototypeOf(call) !== Object.prototype
  ) {
    throw new TypeError('call must be a plain object');
  }

  const fields = Object.keys(call);
  if (
    fields.length !== CALL_FIELDS.size
    || fields.some((field) => !CALL_FIELDS.has(field))
  ) {
    throw new TypeError('call must contain exactly the supported fields');
  }
  if (typeof call.id !== 'string' || call.id === '') {
    throw new TypeError('call.id must be a non-empty string');
  }
  if (typeof call.userId !== 'string' || call.userId === '') {
    throw new TypeError('call.userId must be a non-empty string');
  }
  if (typeof call.roleSlug !== 'string' || call.roleSlug === '') {
    throw new TypeError('call.roleSlug must be a non-empty string');
  }
  if (
    !Number.isSafeInteger(call.billingUnitMs)
    || call.billingUnitMs <= 0
  ) {
    throw new TypeError(
      'call.billingUnitMs must be a positive safe integer'
    );
  }
  if (
    !Number.isSafeInteger(call.pricePerBillingUnitFen)
    || call.pricePerBillingUnitFen <= 0
  ) {
    throw new TypeError(
      'call.pricePerBillingUnitFen must be a positive safe integer'
    );
  }
  if (!CALL_STATUSES.has(call.status)) {
    throw new TypeError('call.status must be supported');
  }
  if (typeof call.createdAt !== 'string' || call.createdAt === '') {
    throw new TypeError('call.createdAt must be a non-empty string');
  }

  if (call.status === 'ended') {
    if (
      !Number.isSafeInteger(call.chargeFen)
      || call.chargeFen < 0
    ) {
      throw new TypeError(
        'call.chargeFen must be a non-negative safe integer for ended'
      );
    }
  } else if (call.status === 'failed') {
    if (call.chargeFen !== 0) {
      throw new TypeError(
        'call.chargeFen must be zero for failed'
      );
    }
  } else if (call.chargeFen !== null) {
    throw new TypeError(
      `call.chargeFen must be null for ${call.status}`
    );
  }

  if (call.status === 'pending' || call.status === 'connecting') {
    if (call.startedAt !== null) {
      throw new TypeError(
        `call.startedAt must be null for ${call.status}`
      );
    }
    if (call.endedAt !== null) {
      throw new TypeError(
        `call.endedAt must be null for ${call.status}`
      );
    }
    return;
  }

  if (call.status === 'active') {
    if (!isNonEmptyString(call.startedAt)) {
      throw new TypeError(
        'call.startedAt must be a non-empty string for active'
      );
    }
    if (call.endedAt !== null) {
      throw new TypeError('call.endedAt must be null for active');
    }
    return;
  }

  if (call.status === 'ended') {
    if (!isNonEmptyString(call.startedAt)) {
      throw new TypeError(
        'call.startedAt must be a non-empty string for ended'
      );
    }
    if (!isNonEmptyString(call.endedAt)) {
      throw new TypeError(
        'call.endedAt must be a non-empty string for ended'
      );
    }
    return;
  }

  if (
    call.startedAt !== null
    && !isNonEmptyString(call.startedAt)
  ) {
    throw new TypeError(
      'call.startedAt must be null or a non-empty string for failed'
    );
  }
  if (!isNonEmptyString(call.endedAt)) {
    throw new TypeError(
      'call.endedAt must be a non-empty string for failed'
    );
  }
}

class MemoryCallStore {
  #callsById;

  constructor() {
    this.#callsById = new Map();
  }

  save(call) {
    validateCall(call);
    if (call.status !== 'pending') {
      throw new TypeError('call.status must be pending when saved');
    }
    if (this.#callsById.has(call.id)) {
      throw new Error('Call ID already exists');
    }
    this.#callsById.set(call.id, { ...call });
  }

  replace(call) {
    validateCall(call);
    const existingCall = this.#callsById.get(call.id);
    if (!existingCall) {
      throw new Error('Call does not exist');
    }
    if (
      call.id !== existingCall.id
      || call.userId !== existingCall.userId
      || call.roleSlug !== existingCall.roleSlug
      || call.billingUnitMs !== existingCall.billingUnitMs
      || call.pricePerBillingUnitFen
        !== existingCall.pricePerBillingUnitFen
      || call.createdAt !== existingCall.createdAt
    ) {
      throw new Error('Call identity fields cannot be changed');
    }
    if (
      (existingCall.status === 'ended'
        || existingCall.status === 'failed')
      && call.chargeFen !== existingCall.chargeFen
    ) {
      throw new Error(
        'Terminal call charge cannot be changed'
      );
    }
    this.#callsById.set(call.id, { ...call });
  }

  findById(callId) {
    const call = this.#callsById.get(callId);
    return call ? { ...call } : null;
  }
}

module.exports = {
  MemoryCallStore,
};
