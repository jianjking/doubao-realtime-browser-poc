'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBusinessDatabase,
} = require('../database/business_database');
const { runMigrations } = require('../database/migrations');

test('paid Fortune migration is idempotent with required constraints and indexes', () => {
  const first = createBusinessDatabase({ databasePath: ':memory:' });
  try {
    const migration = first.connection.prepare(`
      SELECT name FROM schema_migrations WHERE version = 3
    `).get();
    assert.deepEqual(migration, { name: 'paid_fortune_draw' });
    const columns = first.connection.prepare(`
      PRAGMA table_info(fortune_purchases)
    `).all().map((row) => row.name);
    assert.deepEqual(columns, [
      'id',
      'user_id',
      'account_id',
      'client_request_id',
      'fortune_session_id',
      'character_key',
      'catalog_version',
      'fortune_snapshot_json',
      'price_cents',
      'currency',
      'status',
      'balance_before_cents',
      'balance_after_cents',
      'created_at',
      'charged_at',
    ]);
    const indexes = first.connection.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'fortune_purchases'
    `).all().map((row) => row.name);
    for (const name of [
      'fortune_purchases_user_id_idx',
      'fortune_purchases_account_id_idx',
      'fortune_purchases_fortune_session_id_idx',
      'fortune_purchases_created_at_idx',
    ]) {
      assert.ok(indexes.includes(name));
    }
    assert.doesNotThrow(() => runMigrations(first.connection));
  } finally {
    first.close();
  }
});

test('database rejects invalid price, currency, status, and balance relationships', () => {
  const database = createBusinessDatabase({ databasePath: ':memory:' });
  try {
    const now = '2026-08-03T12:00:00.000Z';
    database.connection.prepare(`
      INSERT INTO users (id, phone_e164, status, created_at, updated_at)
      VALUES ('user-db', '+8613800000077', 'active', ?, ?)
    `).run(now, now);
    database.connection.prepare(`
      INSERT INTO accounts (
        user_id, currency, balance_cents, remaining_seconds,
        status, created_at, updated_at
      ) VALUES ('user-db', 'CNY', 1250, 0, 'active', ?, ?)
    `).run(now, now);
    const insert = database.connection.prepare(`
      INSERT INTO fortune_purchases (
        id, user_id, account_id, client_request_id,
        fortune_session_id, character_key, catalog_version,
        fortune_snapshot_json, price_cents, currency, status,
        balance_before_cents, balance_after_cents, created_at, charged_at
      ) VALUES (?, 'user-db', 'user-db', ?, ?, 'guanyin', 'prototype-v1',
        '{}', ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const invalid of [
      { price: 0, currency: 'CNY', status: 'charged', before: 1250, after: 1250 },
      { price: 200, currency: 'USD', status: 'charged', before: 1250, after: 1050 },
      { price: 200, currency: 'CNY', status: 'pending', before: 1250, after: 1050 },
      { price: 200, currency: 'CNY', status: 'charged', before: 1250, after: 1049 },
    ]) {
      assert.throws(() => insert.run(
        `purchase-${invalid.currency}-${invalid.after}`,
        `request-${invalid.currency}-${invalid.after}`,
        `session-${invalid.currency}-${invalid.after}`,
        invalid.price,
        invalid.currency,
        invalid.status,
        invalid.before,
        invalid.after,
        now,
        now
      ));
    }
  } finally {
    database.close();
  }
});
