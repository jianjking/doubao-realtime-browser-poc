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
  if (!isNonEmptyString(call.id)) {
    throw new TypeError('call.id must be a non-empty string');
  }
  if (!isNonEmptyString(call.userId)) {
    throw new TypeError('call.userId must be a non-empty string');
  }
  if (!isNonEmptyString(call.roleSlug)) {
    throw new TypeError('call.roleSlug must be a non-empty string');
  }
  if (!Number.isSafeInteger(call.billingUnitMs) || call.billingUnitMs <= 0) {
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
  if (!isNonEmptyString(call.createdAt)) {
    throw new TypeError('call.createdAt must be a non-empty string');
  }

  if (call.status === 'ended') {
    if (!Number.isSafeInteger(call.chargeFen) || call.chargeFen < 0) {
      throw new TypeError(
        'call.chargeFen must be a non-negative safe integer for ended'
      );
    }
  } else if (call.status === 'failed') {
    if (call.chargeFen !== 0) {
      throw new TypeError('call.chargeFen must be zero for failed');
    }
  } else if (call.chargeFen !== null) {
    throw new TypeError(`call.chargeFen must be null for ${call.status}`);
  }

  if (call.status === 'pending' || call.status === 'connecting') {
    if (call.startedAt !== null || call.endedAt !== null) {
      throw new TypeError(
        `call timestamps must be null for ${call.status}`
      );
    }
    return;
  }
  if (call.status === 'active') {
    if (!isNonEmptyString(call.startedAt) || call.endedAt !== null) {
      throw new TypeError('call timestamps must be valid for active');
    }
    return;
  }
  if (call.status === 'ended') {
    if (
      !isNonEmptyString(call.startedAt)
      || !isNonEmptyString(call.endedAt)
    ) {
      throw new TypeError('call timestamps must be valid for ended');
    }
    return;
  }
  if (
    (call.startedAt !== null && !isNonEmptyString(call.startedAt))
    || !isNonEmptyString(call.endedAt)
  ) {
    throw new TypeError('call timestamps must be valid for failed');
  }
}

function getDurationMs(call) {
  if (call.status !== 'ended' && call.status !== 'failed') {
    return null;
  }
  if (call.startedAt === null) {
    return 0;
  }
  const elapsedMs = Date.parse(call.endedAt) - Date.parse(call.startedAt);
  return Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
}

function mapCallRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    roleSlug: row.role_slug,
    billingUnitMs: row.billing_unit_ms,
    pricePerBillingUnitFen: row.price_per_billing_unit_fen,
    chargeFen: row.charge_fen,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

class SQLiteCallStore {
  #findStatement;
  #insertStatement;
  #replaceStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    const selectedColumns = `
      id,
      user_id,
      role_slug,
      billing_unit_ms,
      price_per_billing_unit_fen,
      charge_fen,
      status,
      created_at,
      started_at,
      ended_at
    `;
    this.#insertStatement = database.prepare(`
      INSERT INTO calls (
        id,
        user_id,
        role_slug,
        billing_unit_ms,
        price_per_billing_unit_fen,
        charge_fen,
        status,
        created_at,
        started_at,
        ended_at,
        duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#findStatement = database.prepare(`
      SELECT ${selectedColumns}
      FROM calls
      WHERE id = ?
    `);
    this.#replaceStatement = database.prepare(`
      UPDATE calls
      SET
        charge_fen = ?,
        status = ?,
        started_at = ?,
        ended_at = ?,
        duration_ms = ?
      WHERE
        id = ?
        AND user_id = ?
        AND role_slug = ?
        AND billing_unit_ms = ?
        AND price_per_billing_unit_fen = ?
        AND created_at = ?
    `);
  }

  save(call) {
    validateCall(call);
    if (call.status !== 'pending') {
      throw new TypeError('call.status must be pending when saved');
    }
    if (this.findById(call.id)) {
      throw new Error('Call ID already exists');
    }
    try {
      this.#insertStatement.run(
        call.id,
        call.userId,
        call.roleSlug,
        call.billingUnitMs,
        call.pricePerBillingUnitFen,
        call.chargeFen,
        call.status,
        call.createdAt,
        call.startedAt,
        call.endedAt,
        null
      );
    } catch (error) {
      if (
        typeof error.code === 'string'
        && error.code.startsWith('SQLITE_CONSTRAINT')
        && this.findById(call.id)
      ) {
        throw new Error('Call ID already exists');
      }
      throw error;
    }
  }

  replace(call) {
    validateCall(call);
    const existingCall = this.findById(call.id);
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
      (existingCall.status === 'ended' || existingCall.status === 'failed')
      && call.chargeFen !== existingCall.chargeFen
    ) {
      throw new Error('Terminal call charge cannot be changed');
    }

    const result = this.#replaceStatement.run(
      call.chargeFen,
      call.status,
      call.startedAt,
      call.endedAt,
      getDurationMs(call),
      call.id,
      call.userId,
      call.roleSlug,
      call.billingUnitMs,
      call.pricePerBillingUnitFen,
      call.createdAt
    );
    if (result.changes !== 1) {
      throw new Error('Call identity fields cannot be changed');
    }
  }

  findById(callId) {
    return mapCallRow(this.#findStatement.get(callId));
  }
}

module.exports = {
  SQLiteCallStore,
};
