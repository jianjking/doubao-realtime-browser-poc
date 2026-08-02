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

function createBusinessStores({ databasePath, clock } = {}) {
  const database = createBusinessDatabase({ databasePath, clock });
  try {
    return {
      accountStore: new SQLiteAccountStore(database.connection),
      accountLedgerStore: new SQLiteAccountLedgerStore(
        database.connection
      ),
      callStore: new SQLiteCallStore(database.connection),
      close: database.close,
      databasePath: database.databasePath,
      paymentNotificationStore: new SQLitePaymentNotificationStore(
        database.connection
      ),
      paymentOrderStore: new SQLitePaymentOrderStore(
        database.connection
      ),
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
