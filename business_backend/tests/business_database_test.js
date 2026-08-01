'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBusinessDatabase,
} = require('../database/business_database');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');
const { PUBLIC_ROLES } = require('../config/public_roles');
const { createAccountService } = require('../services/account_service');
const { createCallService } = require('../services/call_service');
const { createRoleService } = require('../services/role_service');

function createTemporaryDatabasePath() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'business-database-test-')
  );
  return {
    directory,
    databasePath: path.join(directory, 'business.sqlite3'),
  };
}

async function withTemporaryStores(callback) {
  const temporary = createTemporaryDatabasePath();
  let stores;
  try {
    stores = createBusinessStores({ databasePath: temporary.databasePath });
    return await callback(stores, temporary.databasePath);
  } finally {
    if (stores) {
      stores.close();
    }
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
}

function saveUserAndAccount(stores, {
  userId = 'user-sqlite-1',
  phoneE164 = '+8613812345678',
  balanceCents = 1250,
} = {}) {
  const now = '2026-08-01T00:00:00.000Z';
  stores.userStore.save({
    id: userId,
    phoneE164,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  stores.accountStore.save({
    userId,
    currency: 'CNY',
    balanceCents,
    remainingSeconds: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

function createServices(stores, {
  now = 0,
  idGenerator,
} = {}) {
  let clockValue = now;
  let callNumber = 0;
  const callIdGenerator = idGenerator === undefined
    ? () => `call-sqlite-${callNumber += 1}`
    : idGenerator;
  const clock = () => clockValue;
  const accountService = createAccountService({
    accountStore: stores.accountStore,
    clock,
  });
  const roleService = createRoleService({ roles: PUBLIC_ROLES });
  const callService = createCallService({
    accountService,
    callStore: stores.callStore,
    clock,
    idGenerator: callIdGenerator,
    roleService,
    runInTransaction: stores.runInTransaction,
  });
  return {
    accountService,
    callService,
    setNow(value) {
      clockValue = value;
    },
  };
}

test('SQLite user and account records survive a new connection', () => {
  const temporary = createTemporaryDatabasePath();
  let firstStores;
  let secondStores;
  try {
    firstStores = createBusinessStores({ databasePath: temporary.databasePath });
    saveUserAndAccount(firstStores, { balanceCents: 888 });
    firstStores.accountStore.replace({
      ...firstStores.accountStore.findByUserId('user-sqlite-1'),
      balanceCents: 777,
      updatedAt: '2026-08-01T00:01:00.000Z',
    });
    firstStores.close();
    firstStores = null;

    secondStores = createBusinessStores({ databasePath: temporary.databasePath });
    assert.deepEqual(
      secondStores.userStore.findById('user-sqlite-1'),
      {
        id: 'user-sqlite-1',
        phoneE164: '+8613812345678',
        status: 'active',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }
    );
    assert.equal(
      secondStores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      777
    );
  } finally {
    if (firstStores) {
      firstStores.close();
    }
    if (secondStores) {
      secondStores.close();
    }
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('Call lifecycle, frozen price, and ended charge survive restart', () => {
  const temporary = createTemporaryDatabasePath();
  let stores;
  let restartedStores;
  let finalStores;
  try {
    stores = createBusinessStores({ databasePath: temporary.databasePath });
    saveUserAndAccount(stores);
    const services = createServices(stores);
    const pending = services.callService.createPendingCall({
      roleSlug: 'yuhuang',
      userId: 'user-sqlite-1',
    });
    assert.equal(pending.status, 'pending');
    services.callService.markCallConnecting({ callId: pending.id });
    services.setNow(6000);
    const active = services.callService.markCallActive({ callId: pending.id });
    assert.equal(active.startedAt, '1970-01-01T00:00:06.000Z');
    stores.close();
    stores = null;

    restartedStores = createBusinessStores({ databasePath: temporary.databasePath });
    const restoredActiveCall = restartedStores.callStore.findById(pending.id);
    assert.equal(restoredActiveCall.status, 'active');
    assert.equal(restoredActiveCall.startedAt, active.startedAt);
    assert.equal(restoredActiveCall.roleSlug, 'yuhuang');
    assert.equal(restoredActiveCall.billingUnitMs, 6000);
    assert.equal(restoredActiveCall.pricePerBillingUnitFen, 10);
    const restartedServices = createServices(restartedStores, {
      now: 18000,
    });
    const ended = restartedServices.callService.markCallEnded({
      callId: pending.id,
    });
    assert.equal(ended.durationMs, 12000);
    assert.equal(
      restartedStores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      1230
    );
    restartedStores.close();
    restartedStores = null;

    finalStores = createBusinessStores({ databasePath: temporary.databasePath });
    const finalServices = createServices(finalStores, { now: 999999 });
    assert.deepEqual(
      finalServices.callService.getPublicCallForUser({
        callId: pending.id,
        userId: 'user-sqlite-1',
      }),
      ended
    );
    assert.deepEqual(
      finalServices.callService.markCallEnded({ callId: pending.id }),
      ended
    );
    assert.equal(
      finalStores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      1230
    );
  } finally {
    if (stores) {
      stores.close();
    }
    if (restartedStores) {
      restartedStores.close();
    }
    if (finalStores) {
      finalStores.close();
    }
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('failed calls persist without charging and cannot later end', () => {
  const temporary = createTemporaryDatabasePath();
  let stores;
  let restartedStores;
  try {
    stores = createBusinessStores({ databasePath: temporary.databasePath });
    saveUserAndAccount(stores, { balanceCents: 100 });
    const services = createServices(stores, {
      idGenerator: () => 'call-sqlite-failed',
    });
    const pending = services.callService.createPendingCall({
      roleSlug: 'yuhuang',
      userId: 'user-sqlite-1',
    });
    services.setNow(1000);
    const failed = services.callService.markCallFailed({ callId: pending.id });
    assert.equal(failed.status, 'failed');
    assert.equal(
      stores.callStore.findById(pending.id).chargeFen,
      0
    );
    assert.equal(
      stores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      100
    );
    stores.close();
    stores = null;

    restartedStores = createBusinessStores({ databasePath: temporary.databasePath });
    const restartedServices = createServices(restartedStores);
    assert.equal(
      restartedStores.callStore.findById(pending.id).status,
      'failed'
    );
    assert.equal(
      restartedStores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      100
    );
    assert.throws(() => {
      restartedServices.callService.markCallEnded({ callId: pending.id });
    }, (error) => error.code === 'INVALID_CALL_TRANSITION');
  } finally {
    if (stores) {
      stores.close();
    }
    if (restartedStores) {
      restartedStores.close();
    }
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('migration application is idempotent across repeated opens', () => {
  const temporary = createTemporaryDatabasePath();
  let firstDatabase;
  let secondDatabase;
  try {
    firstDatabase = createBusinessDatabase({
      databasePath: temporary.databasePath,
    });
    firstDatabase.close();
    firstDatabase = null;
    secondDatabase = createBusinessDatabase({
      databasePath: temporary.databasePath,
    });
    assert.equal(
      secondDatabase.connection
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get().count,
      1
    );
    assert.equal(
      secondDatabase.connection
        .prepare("SELECT name FROM schema_migrations WHERE version = 1")
        .get().name,
      'initial_schema'
    );
  } finally {
    if (firstDatabase) {
      firstDatabase.close();
    }
    if (secondDatabase) {
      secondDatabase.close();
    }
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('two ended requests charge once and failed transitions never partially write', async () => {
  await withTemporaryStores(async (stores) => {
    saveUserAndAccount(stores);
    const services = createServices(stores);
    const pending = services.callService.createPendingCall({
      roleSlug: 'yuhuang',
      userId: 'user-sqlite-1',
    });
    services.callService.markCallConnecting({ callId: pending.id });
    services.setNow(6000);
    services.callService.markCallActive({ callId: pending.id });
    services.setNow(12000);

    const results = await Promise.all([
      Promise.resolve().then(() => services.callService.markCallEnded({
        callId: pending.id,
      })),
      Promise.resolve().then(() => services.callService.markCallEnded({
        callId: pending.id,
      })),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(
      stores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      1240
    );

    const rollbackPending = services.callService.createPendingCall({
      roleSlug: 'yuhuang',
      userId: 'user-sqlite-1',
    });
    services.callService.markCallConnecting({ callId: rollbackPending.id });
    services.setNow(24000);
    services.callService.markCallActive({ callId: rollbackPending.id });
    const originalReplace = stores.callStore.replace.bind(stores.callStore);
    stores.callStore.replace = () => {
      throw new Error('simulated call write failure');
    };
    assert.throws(() => {
      services.callService.markCallEnded({ callId: rollbackPending.id });
    }, /simulated call write failure/);
    stores.callStore.replace = originalReplace;
    assert.equal(
      stores.callStore.findById(rollbackPending.id).status,
      'active'
    );
    assert.equal(
      stores.accountStore.findByUserId('user-sqlite-1').balanceCents,
      1240
    );
  });
});
