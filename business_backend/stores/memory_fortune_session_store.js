'use strict';

function cloneFortuneSession(session) {
  return {
    ...session,
    lotSnapshot: {
      ...session.lotSnapshot,
      verseLines: [...session.lotSnapshot.verseLines],
    },
  };
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
}

module.exports = {
  MemoryFortuneSessionStore,
};
