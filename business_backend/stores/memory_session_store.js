'use strict';

class MemorySessionStore {
  #sessionsByTokenHash;

  constructor() {
    this.#sessionsByTokenHash = new Map();
  }

  save(session) {
    this.#sessionsByTokenHash.set(session.tokenHash, { ...session });
  }

  findByTokenHash(tokenHash) {
    const session = this.#sessionsByTokenHash.get(tokenHash);
    return session ? { ...session } : null;
  }
}

module.exports = {
  MemorySessionStore,
};
