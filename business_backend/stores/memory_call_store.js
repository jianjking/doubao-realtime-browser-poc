'use strict';

const CALL_FIELDS = new Set([
  'id',
  'userId',
  'roleSlug',
  'status',
  'createdAt',
  'startedAt',
  'endedAt',
]);

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
  if (call.status !== 'pending') {
    throw new TypeError('call.status must be pending');
  }
  if (typeof call.createdAt !== 'string' || call.createdAt === '') {
    throw new TypeError('call.createdAt must be a non-empty string');
  }
  if (call.startedAt !== null) {
    throw new TypeError('call.startedAt must be null');
  }
  if (call.endedAt !== null) {
    throw new TypeError('call.endedAt must be null');
  }
}

class MemoryCallStore {
  #callsById;

  constructor() {
    this.#callsById = new Map();
  }

  save(call) {
    validateCall(call);
    if (this.#callsById.has(call.id)) {
      throw new Error('Call ID already exists');
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
