'use strict';

function mapNotificationRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    paymentOrderId: row.payment_order_id,
    payloadDigest: row.payload_digest,
    verificationStatus: row.verification_status,
    processingStatus: row.processing_status,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    failureCode: row.failure_code,
  };
}

class SQLitePaymentNotificationStore {
  #insertStatement;
  #findStatement;
  #markProcessedStatement;
  #markFailedStatement;
  #findByOrderStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    this.#insertStatement = database.prepare(`
      INSERT INTO payment_notifications (
        id,
        provider,
        provider_event_id,
        payment_order_id,
        payload_digest,
        verification_status,
        processing_status,
        received_at,
        processed_at,
        failure_code
      ) VALUES (?, ?, ?, ?, ?, 'verified', 'received', ?, NULL, NULL)
    `);
    this.#findStatement = database.prepare(`
      SELECT
        id,
        provider,
        provider_event_id,
        payment_order_id,
        payload_digest,
        verification_status,
        processing_status,
        received_at,
        processed_at,
        failure_code
      FROM payment_notifications
      WHERE provider = ? AND provider_event_id = ?
    `);
    this.#findByOrderStatement = database.prepare(`
      SELECT
        id,
        provider,
        provider_event_id,
        payment_order_id,
        payload_digest,
        verification_status,
        processing_status,
        received_at,
        processed_at,
        failure_code
      FROM payment_notifications
      WHERE payment_order_id = ?
      ORDER BY received_at, id
    `);
    this.#markProcessedStatement = database.prepare(`
      UPDATE payment_notifications
      SET
        processing_status = 'processed',
        processed_at = ?,
        failure_code = NULL
      WHERE id = ? AND processing_status = 'received'
    `);
    this.#markFailedStatement = database.prepare(`
      UPDATE payment_notifications
      SET
        processing_status = 'failed',
        processed_at = ?,
        failure_code = ?
      WHERE id = ? AND processing_status = 'received'
    `);
  }

  insertVerified(notification) {
    try {
      this.#insertStatement.run(
        notification.id,
        notification.provider,
        notification.providerEventId,
        notification.paymentOrderId,
        notification.payloadDigest,
        notification.receivedAt
      );
      return {
        inserted: true,
        notification: this.findByProviderEventId(
          notification.provider,
          notification.providerEventId
        ),
      };
    } catch (error) {
      if (
        typeof error.code === 'string'
        && error.code.startsWith('SQLITE_CONSTRAINT')
      ) {
        const existing = this.findByProviderEventId(
          notification.provider,
          notification.providerEventId
        );
        if (existing) {
          return { inserted: false, notification: existing };
        }
      }
      throw error;
    }
  }

  findByProviderEventId(provider, providerEventId) {
    return mapNotificationRow(
      this.#findStatement.get(provider, providerEventId)
    );
  }

  findByPaymentOrderId(paymentOrderId) {
    return this.#findByOrderStatement
      .all(paymentOrderId)
      .map(mapNotificationRow);
  }

  markProcessed(notificationId, processedAt) {
    return this.#markProcessedStatement.run(
      processedAt,
      notificationId
    ).changes;
  }

  markFailed(notificationId, processedAt, failureCode) {
    return this.#markFailedStatement.run(
      processedAt,
      failureCode,
      notificationId
    ).changes;
  }
}

module.exports = {
  SQLitePaymentNotificationStore,
};
