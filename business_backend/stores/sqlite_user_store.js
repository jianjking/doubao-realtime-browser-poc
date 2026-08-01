'use strict';

function mapUserRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateUser(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new TypeError('user must be an object');
  }
  for (const field of [
    'id',
    'phoneE164',
    'status',
    'createdAt',
    'updatedAt',
  ]) {
    if (typeof user[field] !== 'string' || user[field] === '') {
      throw new TypeError(`user.${field} must be a non-empty string`);
    }
  }
  if (user.status !== 'active') {
    throw new TypeError('user.status must be active');
  }
}

class SQLiteUserStore {
  #findByIdStatement;
  #findByPhoneStatement;
  #insertStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    this.#insertStatement = database.prepare(`
      INSERT INTO users (
        id,
        phone_e164,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    this.#findByIdStatement = database.prepare(`
      SELECT id, phone_e164, status, created_at, updated_at
      FROM users
      WHERE id = ?
    `);
    this.#findByPhoneStatement = database.prepare(`
      SELECT id, phone_e164, status, created_at, updated_at
      FROM users
      WHERE phone_e164 = ?
    `);
  }

  save(user) {
    validateUser(user);
    if (this.findById(user.id)) {
      throw new Error('User ID already exists');
    }
    const existingPhoneUser = this.findByPhoneE164(user.phoneE164);
    if (existingPhoneUser && existingPhoneUser.id !== user.id) {
      throw new Error('Phone number already belongs to another user');
    }

    try {
      this.#insertStatement.run(
        user.id,
        user.phoneE164,
        user.status,
        user.createdAt,
        user.updatedAt
      );
    } catch (error) {
      if (
        typeof error.code === 'string'
        && error.code.startsWith('SQLITE_CONSTRAINT')
      ) {
        if (this.findById(user.id)) {
          throw new Error('User ID already exists');
        }
        if (this.findByPhoneE164(user.phoneE164)) {
          throw new Error('Phone number already belongs to another user');
        }
      }
      throw error;
    }
  }

  findByPhoneE164(phoneE164) {
    return mapUserRow(this.#findByPhoneStatement.get(phoneE164));
  }

  findById(userId) {
    return mapUserRow(this.#findByIdStatement.get(userId));
  }
}

module.exports = {
  SQLiteUserStore,
};
