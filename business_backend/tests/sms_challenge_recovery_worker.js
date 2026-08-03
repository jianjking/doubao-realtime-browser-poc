'use strict';

const {
  createBusinessStores,
} = require('../stores/business_store_factory');

const [databasePath, challengeId, expectedStatus] = process.argv.slice(2);
const stores = createBusinessStores({ databasePath });
try {
  const challenge = stores.smsChallengeStore.findById(challengeId);
  if (!challenge || challenge.status !== expectedStatus) {
    process.exitCode = 1;
  }
} finally {
  stores.close();
}
