'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'initial_schema',
    sql: fs.readFileSync(
      path.join(__dirname, 'migrations', '001_initial_schema.sql'),
      'utf8'
    ),
  }),
  Object.freeze({
    version: 2,
    name: 'payment_foundation',
    sql: fs.readFileSync(
      path.join(__dirname, 'migrations', '002_payment_foundation.sql'),
      'utf8'
    ),
  }),
]);

function runMigrations(database, { clock = Date.now } = {}) {
  if (!database || typeof database.exec !== 'function') {
    throw new TypeError('database is required');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  const findMigration = database.prepare(`
    SELECT name
    FROM schema_migrations
    WHERE version = ?
  `);
  const recordMigration = database.prepare(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, ?)
  `);

  for (const migration of MIGRATIONS) {
    const appliedMigration = findMigration.get(migration.version);
    if (appliedMigration) {
      if (appliedMigration.name !== migration.name) {
        throw new Error(
          `Migration ${migration.version} has an unexpected name`
        );
      }
      continue;
    }

    const applyMigration = database.transaction(() => {
      database.exec(migration.sql);
      recordMigration.run(
        migration.version,
        migration.name,
        new Date(clock()).toISOString()
      );
    });
    applyMigration.immediate();
  }
}

module.exports = {
  MIGRATIONS,
  runMigrations,
};
