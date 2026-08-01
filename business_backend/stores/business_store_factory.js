'use strict';

const {
  createBusinessDatabase,
} = require('../database/business_database');
const { SQLiteAccountStore } = require('./sqlite_account_store');
const { SQLiteCallStore } = require('./sqlite_call_store');
const { SQLiteUserStore } = require('./sqlite_user_store');

function createBusinessStores({ databasePath, clock } = {}) {
  const database = createBusinessDatabase({ databasePath, clock });
  try {
    return {
      accountStore: new SQLiteAccountStore(database.connection),
      callStore: new SQLiteCallStore(database.connection),
      close: database.close,
      databasePath: database.databasePath,
      runInTransaction: database.runInTransaction,
      userStore: new SQLiteUserStore(database.connection),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

module.exports = {
  createBusinessStores,
};
