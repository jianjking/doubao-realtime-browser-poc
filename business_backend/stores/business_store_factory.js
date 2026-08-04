'use strict';

const {
  createBusinessDatabase,
} = require('../database/business_database');
const { SQLiteAccountStore } = require('./sqlite_account_store');
const {
  SQLiteAccountLedgerStore,
} = require('./sqlite_account_ledger_store');
const { SQLiteCallStore } = require('./sqlite_call_store');
const { SQLiteUserStore } = require('./sqlite_user_store');
const {
  SQLitePaymentNotificationStore,
} = require('./sqlite_payment_notification_store');
const {
  SQLitePaymentOrderStore,
} = require('./sqlite_payment_order_store');
const {
  SQLiteFortunePurchaseStore,
} = require('./sqlite_fortune_purchase_store');
const {
  SQLiteSmsChallengeStore,
} = require('./sqlite_sms_challenge_store');

function createBusinessStores({
  databasePath,
  clock,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const database = createBusinessDatabase({
    databasePath,
    clock,
    nodeEnv,
  });
  try {
    return {
      accountStore: new SQLiteAccountStore(database.connection),
      accountLedgerStore: new SQLiteAccountLedgerStore(
        database.connection
      ),
      callStore: new SQLiteCallStore(database.connection),
      close: database.close,
      databasePath: database.databasePath,
      fortunePurchaseStore: new SQLiteFortunePurchaseStore(
        database.connection
      ),
      paymentNotificationStore: new SQLitePaymentNotificationStore(
        database.connection
      ),
      paymentOrderStore: new SQLitePaymentOrderStore(
        database.connection
      ),
      runInTransaction: database.runInTransaction,
      smsChallengeStore: new SQLiteSmsChallengeStore(
        database.connection
      ),
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
