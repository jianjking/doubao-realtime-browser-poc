'use strict';

const crypto = require('node:crypto');

const ALLOWED_DEITY_KEYS = new Set(['yuhuang']);
const MAX_SITUATION_TEXT_LENGTH = 1000;

function createPublicError(publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = 400;
  error.code = 'INVALID_FORTUNE_REQUEST';
  error.publicMessage = publicMessage;
  return error;
}

function cloneLot(lot) {
  return {
    id: lot.id,
    number: lot.number,
    level: lot.level,
    title: lot.title,
    verseLines: [...lot.verseLines],
  };
}

function validateCatalog({ catalogVersion, lots }) {
  if (
    typeof catalogVersion !== 'string'
    || catalogVersion.trim() === ''
    || catalogVersion.trim() !== catalogVersion
  ) {
    throw new TypeError(
      'fortune catalogVersion must be a non-empty string'
    );
  }
  if (!Array.isArray(lots) || lots.length === 0) {
    throw new TypeError('fortune lots must be a non-empty array');
  }

  const ids = new Set();
  const numbers = new Set();
  let enabledCount = 0;

  for (const lot of lots) {
    if (!lot || typeof lot !== 'object' || Array.isArray(lot)) {
      throw new TypeError('each fortune lot must be an object');
    }
    if (typeof lot.id !== 'string' || lot.id.trim() === '') {
      throw new TypeError('fortune lot id must be a non-empty string');
    }
    if (ids.has(lot.id)) {
      throw new TypeError('fortune lot id must be unique');
    }
    ids.add(lot.id);
    if (!Number.isSafeInteger(lot.number) || lot.number <= 0) {
      throw new TypeError(
        'fortune lot number must be a positive safe integer'
      );
    }
    if (numbers.has(lot.number)) {
      throw new TypeError('fortune lot number must be unique');
    }
    numbers.add(lot.number);
    if (typeof lot.level !== 'string' || lot.level.trim() === '') {
      throw new TypeError('fortune lot level must be non-empty');
    }
    if (typeof lot.title !== 'string' || lot.title.trim() === '') {
      throw new TypeError('fortune lot title must be non-empty');
    }
    if (
      !Array.isArray(lot.verseLines)
      || lot.verseLines.length === 0
      || lot.verseLines.some(
        (line) => typeof line !== 'string' || line.trim() === ''
      )
    ) {
      throw new TypeError(
        'fortune lot verseLines must contain non-empty strings'
      );
    }
    if (typeof lot.enabled !== 'boolean') {
      throw new TypeError('fortune lot enabled must be a boolean');
    }
    if (lot.enabled) {
      enabledCount += 1;
    }
  }

  if (enabledCount === 0) {
    throw new TypeError(
      'fortune catalog must contain an enabled lot'
    );
  }
}

function buildPublicFortuneSession(session) {
  return {
    id: session.id,
    status: session.status,
    deityKey: session.deityKey,
    catalogVersion: session.catalogVersion,
    lot: cloneLot(session.lotSnapshot),
    createdAt: session.createdAt,
    drawnAt: session.drawnAt,
  };
}

function createFortuneService({
  fortuneSessionStore,
  catalogVersion,
  lots,
  clock = Date.now,
  idGenerator = () => `fortune_${crypto.randomUUID()}`,
  randomInt = crypto.randomInt,
} = {}) {
  if (!fortuneSessionStore) {
    throw new TypeError('fortuneSessionStore is required');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }
  if (typeof idGenerator !== 'function') {
    throw new TypeError('idGenerator must be a function');
  }
  if (typeof randomInt !== 'function') {
    throw new TypeError('randomInt must be a function');
  }

  validateCatalog({ catalogVersion, lots });
  const enabledLots = lots
    .filter((lot) => lot.enabled)
    .map((lot) => cloneLot(lot));

  function createDrawnSession({
    deityKey,
    situationText,
    ownerType = 'anonymous',
    ownerId = null,
  } = {}) {
    if (
      typeof deityKey !== 'string'
      || !ALLOWED_DEITY_KEYS.has(deityKey)
    ) {
      throw createPublicError('A valid deityKey is required');
    }
    if (typeof situationText !== 'string') {
      throw createPublicError(
        'situationText must be a string'
      );
    }
    const normalizedSituationText = situationText.trim();
    if (
      normalizedSituationText === ''
      || normalizedSituationText.length > MAX_SITUATION_TEXT_LENGTH
    ) {
      throw createPublicError(
        'situationText must contain 1 to 1000 characters'
      );
    }
    if (
      !['anonymous', 'guest', 'user'].includes(ownerType)
      || (
        ownerType === 'anonymous'
          ? ownerId !== null
          : typeof ownerId !== 'string' || ownerId === ''
      )
    ) {
      throw new TypeError('fortune owner is invalid');
    }

    const selectedIndex = randomInt(enabledLots.length);
    if (
      !Number.isSafeInteger(selectedIndex)
      || selectedIndex < 0
      || selectedIndex >= enabledLots.length
    ) {
      throw new RangeError(
        'fortune randomInt returned an invalid index'
      );
    }

    const drawnAt = new Date(clock()).toISOString();
    const session = {
      id: idGenerator(),
      status: 'drawn',
      deityKey,
      situationText: normalizedSituationText,
      catalogVersion,
      lotSnapshot: cloneLot(enabledLots[selectedIndex]),
      ownerType,
      ownerId,
      createdAt: drawnAt,
      drawnAt,
    };
    fortuneSessionStore.save(session);
    return buildPublicFortuneSession(session);
  }

  return {
    createDrawnSession,
  };
}

module.exports = {
  MAX_SITUATION_TEXT_LENGTH,
  buildPublicFortuneSession,
  createFortuneService,
  validateCatalog,
};
