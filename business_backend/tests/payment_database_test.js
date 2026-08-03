'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBusinessDatabase,
} = require('../database/business_database');
const { runMigrations } = require('../database/migrations');
const {
  createPaymentHarness,
  seedUserAndAccount,
} = require('./payment_test_helpers');

const CHILD_MODE = process.argv[2];
const USER_ID = 'cross-process-payment-user';
const CLIENT_REQUEST_ID = '55555555-5555-4555-8555-555555555555';

async function runChild(mode, databasePath, metadataPath) {
  const harness = createPaymentHarness({ databasePath });
  try {
    if (mode === 'create') {
      seedUserAndAccount(harness.stores, {
        userId: USER_ID,
        phoneE164: '+8613700000000',
      });
      const result = await harness.paymentService.createPaymentOrder({
        userId: USER_ID,
        provider: 'alipay',
        amountCents: 2301,
        clientRequestId: CLIENT_REQUEST_ID,
      });
      fs.writeFileSync(metadataPath, JSON.stringify({
        orderId: result.order.id,
      }), 'utf8');
      process.stdout.write('created:pending\n');
      return;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const result = await harness.paymentService.completeMockPayment(
      USER_ID,
      metadata.orderId
    );
    const ledger = harness.stores.accountLedgerStore.findByAccountId(USER_ID);
    const notifications =
      harness.stores.paymentNotificationStore.findByPaymentOrderId(
        metadata.orderId
      );
    assert.equal(result.order.status, 'credited');
    assert.equal(result.account.balanceCents, 3551);
    assert.equal(ledger.length, 1);
    assert.equal(notifications.length, 1);
    if (mode === 'complete') {
      assert.equal(result.alreadyProcessed, false);
      process.stdout.write('completed:credited:3551:1:1\n');
      return;
    }
    assert.equal(mode, 'repeat');
    assert.equal(result.alreadyProcessed, true);
    process.stdout.write('repeated:credited:3551:1:1\n');
  } finally {
    harness.close();
  }
}

if (CHILD_MODE && CHILD_MODE.startsWith('child:')) {
  runChild(
    CHILD_MODE.slice('child:'.length),
    process.argv[3],
    process.argv[4]
  ).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
} else {
  test('payment migration is idempotent and creates required constraints', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'payment-migration-')
    );
    const databasePath = path.join(temporaryDirectory, 'payment.sqlite3');
    let database;
    try {
      database = createBusinessDatabase({ databasePath });
      runMigrations(database.connection);
      runMigrations(database.connection);
      assert.deepEqual(
        database.connection.prepare(`
          SELECT version, name
          FROM schema_migrations
          ORDER BY version
        `).all(),
        [
          { version: 1, name: 'initial_schema' },
          { version: 2, name: 'payment_foundation' },
          { version: 3, name: 'paid_fortune_draw' },
        ]
      );
      for (const tableName of [
        'payment_orders',
        'account_ledger',
        'payment_notifications',
      ]) {
        assert.equal(
          database.connection.prepare(`
            SELECT COUNT(*) AS count
            FROM sqlite_master
            WHERE type = 'table' AND name = ?
          `).get(tableName).count,
          1
        );
      }
      const orderIndexes = database.connection
        .prepare('PRAGMA index_list(payment_orders)')
        .all();
      assert.equal(orderIndexes.some((index) => index.unique === 1), true);
      const notificationIndexes = database.connection
        .prepare('PRAGMA index_list(payment_notifications)')
        .all();
      assert.equal(
        notificationIndexes.some((index) => index.unique === 1),
        true
      );
    } finally {
      if (database) {
        database.close();
      }
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      assert.equal(fs.existsSync(temporaryDirectory), false);
    }
  });

  test('SQLite payment survives three processes without duplicate credit', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'payment-process-')
    );
    const databasePath = path.join(temporaryDirectory, 'payment.sqlite3');
    const metadataPath = path.join(temporaryDirectory, 'order.json');
    try {
      const childResults = [];
      for (const mode of ['create', 'complete', 'repeat']) {
        const result = spawnSync(
          process.execPath,
          [__filename, `child:${mode}`, databasePath, metadataPath],
          {
            cwd: path.resolve(__dirname, '../..'),
            encoding: 'utf8',
            timeout: 20000,
            windowsHide: true,
          }
        );
        assert.equal(
          result.status,
          0,
          `${mode} child failed: ${result.stderr}`
        );
        childResults.push(result.stdout.trim());
      }
      assert.deepEqual(childResults, [
        'created:pending',
        'completed:credited:3551:1:1',
        'repeated:credited:3551:1:1',
      ]);

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const finalHarness = createPaymentHarness({ databasePath });
      try {
        assert.equal(
          finalHarness.stores.accountStore.findByUserId(USER_ID).balanceCents,
          3551
        );
        assert.equal(
          finalHarness.stores.paymentOrderStore.findById(metadata.orderId)
            .status,
          'credited'
        );
        assert.deepEqual(
          finalHarness.stores.paymentOrderStore.findByUserId(USER_ID)
            .map((order) => order.id),
          [metadata.orderId]
        );
        assert.equal(
          finalHarness.stores.accountLedgerStore.findByAccountId(USER_ID)
            .length,
          1
        );
        assert.equal(
          finalHarness.stores.paymentNotificationStore
            .findByPaymentOrderId(metadata.orderId).length,
          1
        );
      } finally {
        finalHarness.close();
      }
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      assert.equal(fs.existsSync(temporaryDirectory), false);
    }
  });
}
