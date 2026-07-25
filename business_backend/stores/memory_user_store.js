'use strict';

class MemoryUserStore {
  #usersById;
  #usersByPhoneE164;

  constructor() {
    this.#usersById = new Map();
    this.#usersByPhoneE164 = new Map();
  }

  save(user) {
    if (this.#usersById.has(user.id)) {
      throw new Error('User ID already exists');
    }

    const existingPhoneUser = this.#usersByPhoneE164.get(user.phoneE164);
    if (existingPhoneUser && existingPhoneUser.id !== user.id) {
      throw new Error('Phone number already belongs to another user');
    }

    this.#usersById.set(user.id, { ...user });
    this.#usersByPhoneE164.set(user.phoneE164, { ...user });
  }

  findByPhoneE164(phoneE164) {
    const user = this.#usersByPhoneE164.get(phoneE164);
    return user ? { ...user } : null;
  }

  findById(userId) {
    const user = this.#usersById.get(userId);
    return user ? { ...user } : null;
  }
}

module.exports = {
  MemoryUserStore,
};
