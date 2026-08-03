'use strict';

function copyChallenge(challenge) {
  return challenge ? { ...challenge } : null;
}

class MemorySmsChallengeStore {
  #challenges = new Map();

  create(challenge) {
    if (this.#challenges.has(challenge.id)) {
      throw new Error('SMS challenge ID already exists');
    }
    this.#challenges.set(challenge.id, copyChallenge(challenge));
    return copyChallenge(challenge);
  }

  findById(challengeId) {
    return copyChallenge(this.#challenges.get(challengeId));
  }

  findCoolingForPhone(phoneNormalized, nowIso) {
    const matches = [...this.#challenges.values()].filter(
      (challenge) => challenge.phoneNormalized === phoneNormalized
        && challenge.status !== 'send_failed'
        && challenge.nextSendAllowedAt > nowIso
    );
    matches.sort((left, right) => (
      right.nextSendAllowedAt.localeCompare(left.nextSendAllowedAt)
    ));
    return copyChallenge(matches[0]);
  }

  countForPhoneSince(phoneNormalized, sinceIso) {
    return [...this.#challenges.values()].filter(
      (challenge) => challenge.phoneNormalized === phoneNormalized
        && challenge.createdAt >= sinceIso
    ).length;
  }

  countForIpSince(requestIpDigest, sinceIso) {
    return [...this.#challenges.values()].filter(
      (challenge) => challenge.requestIpDigest === requestIpDigest
        && challenge.createdAt >= sinceIso
    ).length;
  }

  expireActive(nowIso) {
    let changes = 0;
    for (const challenge of this.#challenges.values()) {
      if (
        ['pending', 'sent'].includes(challenge.status)
        && challenge.expiresAt <= nowIso
      ) {
        challenge.status = 'expired';
        challenge.invalidatedAt = nowIso;
        challenge.failureCode = 'EXPIRED';
        changes += 1;
      }
    }
    return changes;
  }

  markSent({
    challengeId,
    providerRequestId,
    providerBizId,
    sentAt,
  }) {
    const challenge = this.#challenges.get(challengeId);
    if (!challenge || challenge.status !== 'pending') {
      return 0;
    }
    challenge.status = 'sent';
    challenge.providerRequestId = providerRequestId;
    challenge.providerBizId = providerBizId;
    challenge.sentAt = sentAt;
    challenge.failureCode = null;
    return 1;
  }

  invalidateOthersForPhone({ phoneNormalized, challengeId, nowIso }) {
    let changes = 0;
    for (const challenge of this.#challenges.values()) {
      if (
        challenge.phoneNormalized === phoneNormalized
        && challenge.id !== challengeId
        && ['pending', 'sent'].includes(challenge.status)
      ) {
        challenge.status = 'invalidated';
        challenge.invalidatedAt = nowIso;
        challenge.failureCode = 'SUPERSEDED';
        changes += 1;
      }
    }
    return changes;
  }

  markSendFailed({ challengeId, nowIso, failureCode }) {
    const challenge = this.#challenges.get(challengeId);
    if (!challenge || challenge.status !== 'pending') {
      return 0;
    }
    challenge.status = 'send_failed';
    challenge.invalidatedAt = nowIso;
    challenge.failureCode = failureCode;
    return 1;
  }

  recordFailedAttempt({ challengeId, phoneNormalized, nowIso }) {
    const challenge = this.#challenges.get(challengeId);
    if (
      challenge
      && challenge.phoneNormalized === phoneNormalized
      && challenge.status === 'sent'
      && challenge.expiresAt > nowIso
    ) {
      challenge.attemptCount += 1;
      if (challenge.attemptCount >= challenge.maxAttempts) {
        challenge.status = 'locked';
        challenge.invalidatedAt = nowIso;
        challenge.failureCode = 'MAX_ATTEMPTS';
      } else {
        challenge.failureCode = 'INVALID_CODE';
      }
    }
    return copyChallenge(challenge);
  }

  consume({ challengeId, phoneNormalized, nowIso }) {
    const challenge = this.#challenges.get(challengeId);
    if (
      !challenge
      || challenge.phoneNormalized !== phoneNormalized
      || challenge.status !== 'sent'
      || challenge.expiresAt <= nowIso
      || challenge.attemptCount >= challenge.maxAttempts
    ) {
      return 0;
    }
    challenge.status = 'consumed';
    challenge.consumedAt = nowIso;
    challenge.failureCode = null;
    return 1;
  }
}

module.exports = {
  MemorySmsChallengeStore,
};
