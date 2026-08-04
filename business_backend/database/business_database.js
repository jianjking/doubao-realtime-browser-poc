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

function isPathInsideOrEqual(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    );
}

function resolveBusinessDatabasePath(configuredPath, {
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  if (nodeEnv === 'production') {
    if (
      typeof configuredPath !== 'string'
      || configuredPath.trim() === ''
      || configuredPath.trim() !== configuredPath
      || !path.isAbsolute(configuredPath)
    ) {
      throw new Error(
        'BUSINESS_DATABASE_PATH must be an absolute path in production'
      );
    }
    const resolvedProductionPath = path.resolve(configuredPath);
    if (isPathInsideOrEqual(PROJECT_ROOT, resolvedProductionPath)) {
      throw new Error(
        'BUSINESS_DATABASE_PATH must be outside the project directory in production'
      );
    }
    return resolvedProductionPath;
  }
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
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const resolvedPath = resolveBusinessDatabasePath(databasePath, {
    nodeEnv,
  });
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
