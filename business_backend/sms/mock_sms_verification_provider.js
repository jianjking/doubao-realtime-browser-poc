'use strict';

const crypto = require('node:crypto');

class MockSmsVerificationProvider {
  #challenges = new Map();
  #clock;
  #codeGenerator;
  #exposeCode;
  #idGenerator;

  constructor({
    clock = Date.now,
    codeGenerator = () => String(
      crypto.randomInt(0, 1000000)
    ).padStart(6, '0'),
    exposeCode = false,
    idGenerator = () => crypto.randomUUID(),
  } = {}) {
    this.#clock = clock;
    this.#codeGenerator = codeGenerator;
    this.#exposeCode = exposeCode;
    this.#idGenerator = idGenerator;
  }

  async send({ challengeId, phoneNumber, validTimeSeconds }) {
    const code = this.#codeGenerator();
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new TypeError('Mock SMS code generator must return six digits');
    }
    this.#challenges.set(challengeId, {
      code,
      expiresAt: this.#clock() + (validTimeSeconds * 1000),
      phoneNumber,
    });
    return {
      mockCode: this.#exposeCode ? code : undefined,
      providerBizId: `mock-biz-${this.#idGenerator()}`,
      providerRequestId: `mock-request-${this.#idGenerator()}`,
    };
  }

  async verify({ challengeId, code, phoneNumber }) {
    const challenge = this.#challenges.get(challengeId);
    const passed = Boolean(
      challenge
      && challenge.phoneNumber === phoneNumber
      && challenge.expiresAt > this.#clock()
      && challenge.code === code
    );
    if (passed) {
      this.#challenges.delete(challengeId);
    }
    return {
      code: 'OK',
      success: true,
      verifyResult: passed ? 'PASS' : 'UNKNOWN',
    };
  }
}

module.exports = {
  MockSmsVerificationProvider,
};
