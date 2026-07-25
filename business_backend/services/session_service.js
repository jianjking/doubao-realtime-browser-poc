'use strict';

const crypto = require('node:crypto');

const GUEST_SESSION_TTL_SECONDS = 86400;
const GUEST_SESSION_TTL_MS = GUEST_SESSION_TTL_SECONDS * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateId() {
  return crypto.randomUUID();
}

function hashToken(rawToken) {
  return crypto
    .createHash('sha256')
    .update(rawToken, 'utf8')
    .digest('hex');
}

function createSessionService({
  sessionStore,
  clock = Date.now,
  tokenGenerator = generateToken,
  idGenerator = generateId,
} = {}) {
  if (!sessionStore) {
    throw new TypeError('sessionStore is required');
  }

  function createGuestSession() {
    const now = clock();
    const rawToken = tokenGenerator();
    const tokenHash = hashToken(rawToken);
    const guestId = idGenerator();
    const sessionId = idGenerator();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + GUEST_SESSION_TTL_MS).toISOString();

    sessionStore.save({
      id: sessionId,
      subjectType: 'guest',
      guestId,
      tokenHash,
      createdAt,
      expiresAt,
      revokedAt: null,
    });

    return {
      rawToken,
      authMode: 'development_guest',
      principal: {
        type: 'guest',
        id: guestId,
      },
      session: {
        expiresAt,
      },
    };
  }

  function verifySession(rawToken) {
    if (typeof rawToken !== 'string' || rawToken === '') {
      return null;
    }

    const session = sessionStore.findByTokenHash(hashToken(rawToken));
    const expiresAt = session ? Date.parse(session.expiresAt) : NaN;
    if (
      !session
      || session.subjectType !== 'guest'
      || session.revokedAt !== null
      || !Number.isFinite(expiresAt)
      || expiresAt <= clock()
    ) {
      return null;
    }

    return {
      sessionId: session.id,
      principal: {
        type: 'guest',
        id: session.guestId,
      },
    };
  }

  return {
    createGuestSession,
    verifySession,
  };
}

module.exports = {
  GUEST_SESSION_TTL_SECONDS,
  createSessionService,
};
