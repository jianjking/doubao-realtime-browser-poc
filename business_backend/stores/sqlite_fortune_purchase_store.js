'use strict';

function mapPurchaseRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    clientRequestId: row.client_request_id,
    fortuneSessionId: row.fortune_session_id,
    characterKey: row.character_key,
    catalogVersion: row.catalog_version,
    fortuneSnapshotJson: row.fortune_snapshot_json,
    priceCents: row.price_cents,
    currency: row.currency,
    status: row.status,
    balanceBeforeCents: row.balance_before_cents,
    balanceAfterCents: row.balance_after_cents,
    createdAt: row.created_at,
    chargedAt: row.charged_at,
  };
}

function parseSnapshot(purchase) {
  if (!purchase) {
    return null;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(purchase.fortuneSnapshotJson);
  } catch {
    throw new Error('Stored Fortune purchase snapshot is invalid JSON');
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Stored Fortune purchase snapshot is invalid');
  }
  return snapshot;
}

class SQLiteFortunePurchaseStore {
  #findByUserRequestStatement;
  #findBySessionStatement;
  #insertStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    const projection = `
      id,
      user_id,
      account_id,
      client_request_id,
      fortune_session_id,
      character_key,
      catalog_version,
      fortune_snapshot_json,
      price_cents,
      currency,
      status,
      balance_before_cents,
      balance_after_cents,
      created_at,
      charged_at
    `;
    this.#findByUserRequestStatement = database.prepare(`
      SELECT ${projection}
      FROM fortune_purchases
      WHERE user_id = ? AND client_request_id = ?
    `);
    this.#findBySessionStatement = database.prepare(`
      SELECT ${projection}
      FROM fortune_purchases
      WHERE fortune_session_id = ?
    `);
    this.#insertStatement = database.prepare(`
      INSERT INTO fortune_purchases (
        id,
        user_id,
        account_id,
        client_request_id,
        fortune_session_id,
        character_key,
        catalog_version,
        fortune_snapshot_json,
        price_cents,
        currency,
        status,
        balance_before_cents,
        balance_after_cents,
        created_at,
        charged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', 'charged', ?, ?, ?, ?)
    `);
  }

  findByUserAndClientRequestId(userId, clientRequestId) {
    return mapPurchaseRow(
      this.#findByUserRequestStatement.get(userId, clientRequestId)
    );
  }

  findByFortuneSessionId(fortuneSessionId) {
    return mapPurchaseRow(this.#findBySessionStatement.get(fortuneSessionId));
  }

  createChargedPurchase(purchase) {
    const result = this.#insertStatement.run(
      purchase.id,
      purchase.userId,
      purchase.accountId,
      purchase.clientRequestId,
      purchase.fortuneSessionId,
      purchase.characterKey,
      purchase.catalogVersion,
      purchase.fortuneSnapshotJson,
      purchase.priceCents,
      purchase.balanceBeforeCents,
      purchase.balanceAfterCents,
      purchase.createdAt,
      purchase.chargedAt
    );
    return result.changes;
  }

  getPublicSessionSnapshot(fortuneSessionId) {
    return parseSnapshot(this.findByFortuneSessionId(fortuneSessionId));
  }
}

module.exports = {
  SQLiteFortunePurchaseStore,
  mapPurchaseRow,
  parseSnapshot,
};
