'use strict';

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

const USER_ID = 'paid-fortune-cross-user';
const CLIENT_REQUEST_ID = '81111111-1111-4111-8111-111111111111';

function createService(stores, priceCents = 200) {
  return createFortuneService({
    fortuneSessionStore: new MemoryFortuneSessionStore(),
    fortunePurchaseStore: stores.fortunePurchaseStore,
    userStore: stores.userStore,
    accountStore: stores.accountStore,
    runInTransaction: stores.runInTransaction,
    drawPriceCents: priceCents,
    catalogVersion: FORTUNE_CATALOG_VERSION,
    lots: FORTUNE_LOTS,
    clock: () => Date.parse('2026-08-03T08:00:00.000Z'),
    idGenerator: () => 'fortune-cross-process',
    purchaseIdGenerator: () => 'fortune-purchase-cross-process',
    randomInt: () => 2,
    interpretationClient: {
      async generateInterpretation() {
        return { text: '道童已从持久化签文恢复并完成解签。' };
      },
    },
  });
}

function seed(stores) {
  const now = '2026-08-03T08:00:00.000Z';
  stores.userStore.save({
    id: USER_ID,
    phoneE164: '+8613800000099',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  stores.accountStore.save({
    userId: USER_ID,
    currency: 'CNY',
    balanceCents: 1250,
    remainingSeconds: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

async function main() {
  const phase = process.argv[2];
  const databasePath = process.argv[3];
  const stores = createBusinessStores({ databasePath });
  try {
    if (phase === 'seed') {
      seed(stores);
      process.stdout.write(JSON.stringify({ seeded: true }));
      return;
    }
    const service = createService(stores);
    if (phase === 'draw' || phase === 'duplicate') {
      const result = service.createPaidFortuneSession({
        userId: USER_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        characterKey: 'guanyin',
        situationText: '跨进程测试心愿不会写入数据库',
      });
      process.stdout.write(JSON.stringify({
        sessionId: result.fortuneSession.id,
        lotNumber: result.fortuneSession.lot.number,
        alreadyProcessed: result.charge.alreadyProcessed,
        balanceCents: stores.accountStore.findByUserId(USER_ID).balanceCents,
      }));
      return;
    }
    if (phase === 'interpret') {
      const result = await service.interpretSession(
        USER_ID,
        'fortune-cross-process'
      );
      process.stdout.write(JSON.stringify({
        text: result.interpretation.text,
        balanceCents: stores.accountStore.findByUserId(USER_ID).balanceCents,
      }));
      return;
    }
    throw new Error('Unknown worker phase');
  } finally {
    stores.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
