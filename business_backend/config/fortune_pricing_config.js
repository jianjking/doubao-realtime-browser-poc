'use strict';

const DEFAULT_FORTUNE_DRAW_PRICE_CENTS = 200;
const MAX_FORTUNE_DRAW_PRICE_CENTS = 100000;

function parseFortuneDrawPriceCents(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return DEFAULT_FORTUNE_DRAW_PRICE_CENTS;
  }
  if (typeof rawValue !== 'string' || !/^[1-9]\d*$/.test(rawValue)) {
    throw new TypeError(
      'FORTUNE_DRAW_PRICE_CENTS must be an integer between 1 and 100000'
    );
  }

  const priceCents = Number(rawValue);
  if (
    !Number.isSafeInteger(priceCents)
    || priceCents < 1
    || priceCents > MAX_FORTUNE_DRAW_PRICE_CENTS
  ) {
    throw new TypeError(
      'FORTUNE_DRAW_PRICE_CENTS must be an integer between 1 and 100000'
    );
  }
  return priceCents;
}

function readFortunePricingConfig(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object');
  }
  return Object.freeze({
    drawPriceCents: parseFortuneDrawPriceCents(
      env.FORTUNE_DRAW_PRICE_CENTS
    ),
    currency: 'CNY',
    chargeTiming: 'fortune_session_created',
  });
}

function formatCnyCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new TypeError('cents must be a non-negative safe integer');
  }
  return `¥${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

module.exports = {
  DEFAULT_FORTUNE_DRAW_PRICE_CENTS,
  MAX_FORTUNE_DRAW_PRICE_CENTS,
  formatCnyCents,
  parseFortuneDrawPriceCents,
  readFortunePricingConfig,
};
