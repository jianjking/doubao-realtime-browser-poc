'use strict';

const fs = require('node:fs');
const path = require('node:path');

const Database = require('better-sqlite3');

const { runMigrations } = require('./migrations');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BUSINESS_DATABASE_PATH = path.resolve(
  __dirname,
  '../data/business.sqlite3'
);

function resolveBusinessDatabasePath(configuredPath) {
  if (configuredPath === undefined) {
    return DEFAULT_BUSINESS_DATABASE_PATH;
  }
  if (
    typeof configuredPath !== 'string'
    || configuredPath === ''
    || configuredPath.trim() !== configuredPath
  ) {
    throw new TypeError(
      'BUSINESS_DATABASE_PATH must be a non-empty path'
    );
  }
  if (configuredPath === ':memory:') {
    return configuredPath;
  }
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(PROJECT_ROOT, configuredPath);
}

function createBusinessDatabase({
  databasePath,
  clock = Date.now,
} = {}) {
  const resolvedPath = resolveBusinessDatabasePath(databasePath);
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  let connection;
  try {
    connection = new Database(resolvedPath);
    connection.pragma('foreign_keys = ON');
    connection.pragma('busy_timeout = 5000');
    if (resolvedPath !== ':memory:') {
      connection.pragma('journal_mode = WAL');
    }
    runMigrations(connection, { clock });
  } catch (error) {
    if (connection && connection.open) {
      connection.close();
    }
    throw error;
  }

  let closed = false;

  function runInTransaction(operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('transaction operation must be a function');
    }
    if (closed) {
      throw new Error('Business database is closed');
    }
    if (connection.inTransaction) {
      return operation();
    }
    return connection.transaction(operation).immediate();
  }

  function close() {
    if (closed) {
      return;
    }
    connection.close();
    closed = true;
  }

  return {
    close,
    connection,
    databasePath: resolvedPath,
    runInTransaction,
  };
}

module.exports = {
  DEFAULT_BUSINESS_DATABASE_PATH,
  createBusinessDatabase,
  resolveBusinessDatabasePath,
};
