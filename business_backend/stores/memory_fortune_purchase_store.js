'use strict';

function clonePurchase(purchase) {
  return { ...purchase };
}

class MemoryFortunePurchaseStore {
  #purchasesBySessionId = new Map();
  #purchasesByUserRequest = new Map();

  findByUserAndClientRequestId(userId, clientRequestId) {
    const purchase = this.#purchasesByUserRequest.get(
      `${userId}\n${clientRequestId}`
    );
    return purchase ? clonePurchase(purchase) : null;
  }

  findByFortuneSessionId(fortuneSessionId) {
    const purchase = this.#purchasesBySessionId.get(fortuneSessionId);
    return purchase ? clonePurchase(purchase) : null;
  }

  createChargedPurchase(purchase) {
    const requestKey = `${purchase.userId}\n${purchase.clientRequestId}`;
    if (
      this.#purchasesByUserRequest.has(requestKey)
      || this.#purchasesBySessionId.has(purchase.fortuneSessionId)
    ) {
      throw new Error('Fortune purchase already exists');
    }
    const stored = clonePurchase(purchase);
    this.#purchasesByUserRequest.set(requestKey, stored);
    this.#purchasesBySessionId.set(purchase.fortuneSessionId, stored);
    return 1;
  }

  getPublicSessionSnapshot(fortuneSessionId) {
    const purchase = this.findByFortuneSessionId(fortuneSessionId);
    if (!purchase) {
      return null;
    }
    try {
      return JSON.parse(purchase.fortuneSnapshotJson);
    } catch {
      throw new Error('Stored Fortune purchase snapshot is invalid JSON');
    }
  }
}

module.exports = {
  MemoryFortunePurchaseStore,
};
