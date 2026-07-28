'use strict';

function cloneFortuneSession(session) {
  return {
    ...session,
    lotSnapshot: session.lotSnapshot === null
      ? null
      : {
        ...session.lotSnapshot,
        verseLines: [...session.lotSnapshot.verseLines],
      },
    interpretation: session.interpretation === null
      ? null
      : {
        ...session.interpretation,
      },
  };
}

function serializeIdentity(session) {
  return JSON.stringify({
    id: session.id,
    status: session.status,
    deityKey: session.deityKey,
    situationText: session.situationText,
    catalogVersion: session.catalogVersion,
    lotSnapshot: session.lotSnapshot,
    ownerType: session.ownerType,
    ownerId: session.ownerId,
    createdAt: session.createdAt,
    drawnAt: session.drawnAt,
  });
}

class MemoryFortuneSessionStore {
  #sessionsById;

  constructor() {
    this.#sessionsById = new Map();
  }

  save(session) {
    if (
      !session
      || typeof session !== 'object'
      || Array.isArray(session)
      || typeof session.id !== 'string'
      || session.id === ''
    ) {
      throw new TypeError(
        'fortuneSession.id must be a non-empty string'
      );
    }
    if (this.#sessionsById.has(session.id)) {
      throw new Error('Fortune Session ID already exists');
    }
    this.#sessionsById.set(
      session.id,
      cloneFortuneSession(session)
    );
  }

  findById(sessionId) {
    const session = this.#sessionsById.get(sessionId);
    return session ? cloneFortuneSession(session) : null;
  }

  replace(session) {
    if (
      !session
      || typeof session !== 'object'
      || Array.isArray(session)
      || typeof session.id !== 'string'
      || session.id === ''
    ) {
      throw new TypeError(
        'fortuneSession.id must be a non-empty string'
      );
    }
    const existing = this.#sessionsById.get(session.id);
    if (!existing) {
      throw new Error('Fortune Session does not exist');
    }
    if (serializeIdentity(session) !== serializeIdentity(existing)) {
      throw new Error(
        'Fortune Session draw identity cannot be changed'
      );
    }
    this.#sessionsById.set(
      session.id,
      cloneFortuneSession(session)
    );
  }
}

module.exports = {
  MemoryFortuneSessionStore,
};
