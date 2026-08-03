'use strict';

function mapChallengeRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    phoneNormalized: row.phone_normalized,
    purpose: row.purpose,
    status: row.status,
    provider: row.provider,
    providerRequestId: row.provider_request_id,
    providerBizId: row.provider_biz_id,
    requestIpDigest: row.request_ip_digest,
    expiresAt: row.expires_at,
    nextSendAllowedAt: row.next_send_allowed_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    consumedAt: row.consumed_at,
    invalidatedAt: row.invalidated_at,
    failureCode: row.failure_code,
  };
}

class SQLiteSmsChallengeStore {
  #countIpSinceStatement;
  #countPhoneSinceStatement;
  #expireActiveStatement;
  #findByIdStatement;
  #findCoolingStatement;
  #insertStatement;
  #invalidateOthersStatement;
  #markConsumedStatement;
  #markSendFailedStatement;
  #markSentStatement;
  #recordFailedAttemptStatement;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('database is required');
    }
    this.#insertStatement = database.prepare(`
      INSERT INTO sms_challenges (
        id,
        phone_normalized,
        purpose,
        status,
        provider,
        provider_request_id,
        provider_biz_id,
        request_ip_digest,
        expires_at,
        next_send_allowed_at,
        attempt_count,
        max_attempts,
        created_at,
        sent_at,
        consumed_at,
        invalidated_at,
        failure_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#findByIdStatement = database.prepare(`
      SELECT * FROM sms_challenges WHERE id = ?
    `);
    this.#findCoolingStatement = database.prepare(`
      SELECT *
      FROM sms_challenges
      WHERE
        phone_normalized = ?
        AND status <> 'send_failed'
        AND next_send_allowed_at > ?
      ORDER BY next_send_allowed_at DESC
      LIMIT 1
    `);
    this.#countPhoneSinceStatement = database.prepare(`
      SELECT COUNT(*) AS count
      FROM sms_challenges
      WHERE phone_normalized = ? AND created_at >= ?
    `);
    this.#countIpSinceStatement = database.prepare(`
      SELECT COUNT(*) AS count
      FROM sms_challenges
      WHERE request_ip_digest = ? AND created_at >= ?
    `);
    this.#expireActiveStatement = database.prepare(`
      UPDATE sms_challenges
      SET
        status = 'expired',
        invalidated_at = ?,
        failure_code = 'EXPIRED'
      WHERE status IN ('pending', 'sent') AND expires_at <= ?
    `);
    this.#markSentStatement = database.prepare(`
      UPDATE sms_challenges
      SET
        status = 'sent',
        provider_request_id = ?,
        provider_biz_id = ?,
        sent_at = ?,
        failure_code = NULL
      WHERE id = ? AND status = 'pending'
    `);
    this.#invalidateOthersStatement = database.prepare(`
      UPDATE sms_challenges
      SET
        status = 'invalidated',
        invalidated_at = ?,
        failure_code = 'SUPERSEDED'
      WHERE
        phone_normalized = ?
        AND id <> ?
        AND status IN ('pending', 'sent')
    `);
    this.#markSendFailedStatement = database.prepare(`
      UPDATE sms_challenges
      SET
        status = 'send_failed',
        invalidated_at = ?,
        failure_code = ?
      WHERE id = ? AND status = 'pending'
    `);
    this.#recordFailedAttemptStatement = database.prepare(`
      UPDATE sms_challenges
      SET
        attempt_count = attempt_count + 1,
        status = CASE
          WHEN attempt_count + 1 >= max_attempts THEN 'locked'
          ELSE status
        END,
        invalidated_at = CASE
          WHEN attempt_count + 1 >= max_attempts THEN ?
          ELSE invalidated_at
        END,
        failure_code = CASE
          WHEN attempt_count + 1 >= max_attempts
            THEN 'MAX_ATTEMPTS'
          ELSE 'INVALID_CODE'
        END
      WHERE
        id = ?
        AND phone_normalized = ?
        AND status = 'sent'
        AND expires_at > ?
    `);
    this.#markConsumedStatement = database.prepare(`
      UPDATE sms_challenges
      SET
        status = 'consumed',
        consumed_at = ?,
        failure_code = NULL
      WHERE
        id = ?
        AND phone_normalized = ?
        AND status = 'sent'
        AND expires_at > ?
        AND attempt_count < max_attempts
    `);
  }

  create(challenge) {
    this.#insertStatement.run(
      challenge.id,
      challenge.phoneNormalized,
      challenge.purpose,
      challenge.status,
      challenge.provider,
      challenge.providerRequestId,
      challenge.providerBizId,
      challenge.requestIpDigest,
      challenge.expiresAt,
      challenge.nextSendAllowedAt,
      challenge.attemptCount,
      challenge.maxAttempts,
      challenge.createdAt,
      challenge.sentAt,
      challenge.consumedAt,
      challenge.invalidatedAt,
      challenge.failureCode
    );
    return this.findById(challenge.id);
  }

  findById(challengeId) {
    return mapChallengeRow(this.#findByIdStatement.get(challengeId));
  }

  findCoolingForPhone(phoneNormalized, nowIso) {
    return mapChallengeRow(
      this.#findCoolingStatement.get(phoneNormalized, nowIso)
    );
  }

  countForPhoneSince(phoneNormalized, sinceIso) {
    return this.#countPhoneSinceStatement.get(
      phoneNormalized,
      sinceIso
    ).count;
  }

  countForIpSince(requestIpDigest, sinceIso) {
    return this.#countIpSinceStatement.get(
      requestIpDigest,
      sinceIso
    ).count;
  }

  expireActive(nowIso) {
    return this.#expireActiveStatement.run(nowIso, nowIso).changes;
  }

  markSent({
    challengeId,
    providerRequestId,
    providerBizId,
    sentAt,
  }) {
    return this.#markSentStatement.run(
      providerRequestId,
      providerBizId,
      sentAt,
      challengeId
    ).changes;
  }

  invalidateOthersForPhone({ phoneNormalized, challengeId, nowIso }) {
    return this.#invalidateOthersStatement.run(
      nowIso,
      phoneNormalized,
      challengeId
    ).changes;
  }

  markSendFailed({ challengeId, nowIso, failureCode }) {
    return this.#markSendFailedStatement.run(
      nowIso,
      failureCode,
      challengeId
    ).changes;
  }

  recordFailedAttempt({ challengeId, phoneNormalized, nowIso }) {
    this.#recordFailedAttemptStatement.run(
      nowIso,
      challengeId,
      phoneNormalized,
      nowIso
    );
    return this.findById(challengeId);
  }

  consume({ challengeId, phoneNormalized, nowIso }) {
    return this.#markConsumedStatement.run(
      nowIso,
      challengeId,
      phoneNormalized,
      nowIso
    ).changes;
  }
}

module.exports = {
  SQLiteSmsChallengeStore,
};
