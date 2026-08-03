'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  DEFAULT_FORTUNE_DRAW_PRICE_CENTS,
  formatCnyCents,
  parseFortuneDrawPriceCents,
  readFortunePricingConfig,
} = require('../config/fortune_pricing_config');
const {
  FORTUNE_CATALOG_VERSION,
  FORTUNE_LOTS,
} = require('../config/fortune_lots');
const { createFortuneService } = require('../services/fortune_service');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');
const {
  MemoryFortuneSessionStore,
} = require('../stores/memory_fortune_session_store');
const { seedUserAndAccount } = require('./payment_test_helpers');

const USER_ID = 'paid-fortune-user';
const REQUEST_ID = '91111111-1111-4111-8111-111111111111';

function createHarness({
  databasePath = ':memory:',
  balanceCents = 1250,
  priceCents = 200,
  seed = true,
  accountStore,
  fortunePurchaseStore,
  snapshotSerializer,
  idPrefix = 'paid',
} = {}) {
  const stores = createBusinessStores({ databasePath });
  if (seed) {
    seedUserAndAccount(stores, {
      userId: USER_ID,
      phoneE164: '+8613800000088',
      balanceCents,
      now: '2026-08-03T06:00:00.000Z',
    });
  }
  const sessionStore = new MemoryFortuneSessionStore();
  let nextSession = 1;
  let nextPurchase = 1;
  const service = createFortuneService({
    fortuneSessionStore: sessionStore,
    fortunePurchaseStore: fortunePurchaseStore || stores.fortunePurchaseStore,
    userStore: stores.userStore,
    accountStore: accountStore || stores.accountStore,
    runInTransaction: stores.runInTransaction,
    drawPriceCents: priceCents,
    catalogVersion: FORTUNE_CATALOG_VERSION,
    lots: FORTUNE_LOTS,
    clock: () => Date.parse('2026-08-03T06:30:00.000Z'),
    idGenerator: () => `fortune-${idPrefix}-${nextSession++}`,
    purchaseIdGenerator: () => `fortune-purchase-${idPrefix}-${nextPurchase++}`,
    randomInt: () => 1,
    snapshotSerializer,
    interpretationClient: {
      async generateInterpretation() {
        return { text: '道童解签测试正文。' };
      },
    },
  });
  return { service, sessionStore, stores };
}

function draw(service, overrides = {}) {
  return service.createPaidFortuneSession({
    userId: USER_ID,
    clientRequestId: REQUEST_ID,
    characterKey: 'guanyin',
    situationText: '愿家人平安，测试正文不得持久化',
    ...overrides,
  });
}

function makeTemporaryDatabasePath() {
  return path.join(
    os.tmpdir(),
    `paid-fortune-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`
  );
}

function removeTemporaryDatabase(databasePath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${databasePath}${suffix}`;
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  }
}

test('Fortune pricing accepts only canonical bounded positive integers', () => {
  assert.equal(DEFAULT_FORTUNE_DRAW_PRICE_CENTS, 200);
  assert.equal(parseFortuneDrawPriceCents(undefined), 200);
  assert.equal(parseFortuneDrawPriceCents('300'), 300);
  assert.equal(formatCnyCents(200), '¥2.00');
  assert.deepEqual(readFortunePricingConfig({
    FORTUNE_DRAW_PRICE_CENTS: '250',
  }), {
    drawPriceCents: 250,
    currency: 'CNY',
    chargeTiming: 'fortune_session_created',
  });
  for (const invalid of [
    '0', '-1', '2.5', '200x', '100001', '2e2', 'NaN', 'Infinity', ' 200',
  ]) {
    assert.throws(() => parseFortuneDrawPriceCents(invalid));
  }
});

test('paid draw debits once and ten sequential or concurrent retries reuse one snapshot', async () => {
  const harness = createHarness();
  try {
    const first = draw(harness.service);
    assert.equal(first.charge.balanceBeforeCents, 1250);
    assert.equal(first.charge.balanceAfterCents, 1050);
    assert.equal(first.charge.alreadyProcessed, false);

    const sequential = Array.from({ length: 9 }, () => draw(harness.service));
    assert.ok(sequential.every((result) => (
      result.fortuneSession.id === first.fortuneSession.id
      && result.fortuneSession.lot.number === first.fortuneSession.lot.number
      && result.charge.alreadyProcessed === true
    )));
    const concurrent = await Promise.all(Array.from(
      { length: 10 },
      () => Promise.resolve().then(() => draw(harness.service))
    ));
    assert.ok(concurrent.every((result) => (
      result.fortuneSession.id === first.fortuneSession.id
      && result.charge.alreadyProcessed === true
    )));
    assert.equal(
      harness.stores.accountStore.findByUserId(USER_ID).balanceCents,
      1050
    );
    const purchase =
      harness.stores.fortunePurchaseStore.findByUserAndClientRequestId(
        USER_ID,
        REQUEST_ID
      );
    assert.ok(purchase);
    assert.equal(purchase.priceCents, 200);
    assert.equal(purchase.balanceBeforeCents, 1250);
    assert.equal(purchase.balanceAfterCents, 1050);
    assert.equal(
      purchase.fortuneSnapshotJson.includes('愿家人平安'),
      false
    );
  } finally {
    harness.stores.close();
  }
});

test('exact balance succeeds while insufficient balance creates no purchase or Session', () => {
  const exact = createHarness({ balanceCents: 200 });
  try {
    assert.equal(draw(exact.service).charge.balanceAfterCents, 0);
  } finally {
    exact.stores.close();
  }

  const insufficient = createHarness({ balanceCents: 199 });
  try {
    assert.throws(() => draw(insufficient.service), (error) => (
      error.code === 'INSUFFICIENT_ACCOUNT_BALANCE'
      && error.publicDetails.priceCents === 200
      && error.publicDetails.balanceCents === 199
      && error.publicDetails.shortfallCents === 1
    ));
    assert.equal(
      insufficient.stores.accountStore.findByUserId(USER_ID).balanceCents,
      199
    );
    assert.equal(
      insufficient.stores.fortunePurchaseStore
        .findByUserAndClientRequestId(USER_ID, REQUEST_ID),
      null
    );
    assert.equal(insufficient.sessionStore.findById('fortune-paid-1'), null);
  } finally {
    insufficient.stores.close();
  }
});

test('account, purchase, and serialization failures roll back every durable effect', () => {
  for (const failure of ['account', 'purchase', 'serialize']) {
    const stores = createBusinessStores({ databasePath: ':memory:' });
    seedUserAndAccount(stores, {
      userId: USER_ID,
      phoneE164: '+8613800000088',
      balanceCents: 1250,
      now: '2026-08-03T06:00:00.000Z',
    });
    const accountStore = failure === 'account'
      ? {
        findByUserId: stores.accountStore.findByUserId.bind(stores.accountStore),
        debitBalanceCentsForFortune(input) {
          stores.accountStore.debitBalanceCentsForFortune(input);
          throw new Error('injected account failure');
        },
      }
      : stores.accountStore;
    const purchaseStore = failure === 'purchase'
      ? {
        findByUserAndClientRequestId:
          stores.fortunePurchaseStore.findByUserAndClientRequestId
            .bind(stores.fortunePurchaseStore),
        findByFortuneSessionId:
          stores.fortunePurchaseStore.findByFortuneSessionId
            .bind(stores.fortunePurchaseStore),
        getPublicSessionSnapshot:
          stores.fortunePurchaseStore.getPublicSessionSnapshot
            .bind(stores.fortunePurchaseStore),
        createChargedPurchase(purchase) {
          stores.fortunePurchaseStore.createChargedPurchase(purchase);
          throw new Error('injected purchase failure');
        },
      }
      : stores.fortunePurchaseStore;
    const sessionStore = new MemoryFortuneSessionStore();
    const service = createFortuneService({
      fortuneSessionStore: sessionStore,
      fortunePurchaseStore: purchaseStore,
      userStore: stores.userStore,
      accountStore,
      runInTransaction: stores.runInTransaction,
      drawPriceCents: 200,
      catalogVersion: FORTUNE_CATALOG_VERSION,
      lots: FORTUNE_LOTS,
      clock: () => Date.parse('2026-08-03T06:30:00.000Z'),
      idGenerator: () => 'fortune-rollback',
      purchaseIdGenerator: () => 'purchase-rollback',
      randomInt: () => 0,
      snapshotSerializer: failure === 'serialize'
        ? () => { throw new Error('injected serialization failure'); }
        : JSON.stringify,
    });
    try {
      assert.throws(() => draw(service));
      assert.equal(stores.accountStore.findByUserId(USER_ID).balanceCents, 1250);
      assert.equal(
        stores.fortunePurchaseStore.findByUserAndClientRequestId(
          USER_ID,
          REQUEST_ID
        ),
        null
      );
      assert.equal(sessionStore.findById('fortune-rollback'), null);
    } finally {
      stores.close();
    }
  }
});

test('price snapshot survives configuration changes and new requests use the new price', () => {
  const databasePath = makeTemporaryDatabasePath();
  try {
    const first = createHarness({ databasePath, priceCents: 200 });
    const original = draw(first.service);
    first.stores.close();

    const second = createHarness({
      databasePath,
      priceCents: 300,
      seed: false,
      idPrefix: 'new-price',
    });
    try {
      const duplicate = draw(second.service);
      assert.equal(duplicate.fortuneSession.id, original.fortuneSession.id);
      assert.equal(duplicate.charge.priceCents, 200);
      assert.equal(duplicate.charge.alreadyProcessed, true);
      const newer = draw(second.service, {
        clientRequestId: '92222222-2222-4222-8222-222222222222',
      });
      assert.equal(newer.charge.priceCents, 300);
      assert.equal(newer.charge.balanceAfterCents, 750);
    } finally {
      second.stores.close();
    }
  } finally {
    removeTemporaryDatabase(databasePath);
  }
});

test('a corrupted persisted snapshot fails closed without another debit', () => {
  const databasePath = makeTemporaryDatabasePath();
  try {
    const first = createHarness({ databasePath });
    draw(first.service);
    first.stores.close();

    const database = new Database(databasePath);
    database.prepare(`
      UPDATE fortune_purchases
      SET fortune_snapshot_json = 'not-json'
      WHERE user_id = ? AND client_request_id = ?
    `).run(USER_ID, REQUEST_ID);
    database.close();

    const second = createHarness({ databasePath, seed: false });
    try {
      assert.throws(() => draw(second.service), (error) => (
        error.code === 'FORTUNE_CHARGE_FAILED'
      ));
      assert.equal(
        second.stores.accountStore.findByUserId(USER_ID).balanceCents,
        1050
      );
    } finally {
      second.stores.close();
    }
  } finally {
    removeTemporaryDatabase(databasePath);
  }
});

test('ten real processes charge once, then restart recovery and duplicate retry stay free', async () => {
  const databasePath = makeTemporaryDatabasePath();
  const workerPath = path.join(
    __dirname,
    'paid_fortune_cross_process_worker.js'
  );
  const runWorker = (phase) => new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [
      workerPath,
      phase,
      databasePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${phase} failed: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

  try {
    assert.deepEqual(await runWorker('seed'), { seeded: true });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runWorker('draw'))
    );
    assert.equal(new Set(results.map((value) => value.sessionId)).size, 1);
    assert.equal(new Set(results.map((value) => value.lotNumber)).size, 1);
    assert.ok(results.every((value) => value.balanceCents === 1050));
    assert.equal(
      results.filter((value) => value.alreadyProcessed === false).length,
      1
    );
    const recovered = await runWorker('interpret');
    assert.match(recovered.text, /持久化签文恢复/);
    assert.equal(recovered.balanceCents, 1050);
    const duplicate = await runWorker('duplicate');
    assert.equal(duplicate.sessionId, 'fortune-cross-process');
    assert.equal(duplicate.balanceCents, 1050);
    assert.equal(duplicate.alreadyProcessed, true);
  } finally {
    removeTemporaryDatabase(databasePath);
  }
});
