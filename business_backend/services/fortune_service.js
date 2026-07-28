'use strict';

const crypto = require('node:crypto');

const ALLOWED_DEITY_KEYS = new Set(['yuhuang']);
const MAX_SITUATION_TEXT_LENGTH = 1000;
const INTERPRETATION_SCHEMA_VERSION = 'fortune-interpretation-v1';
const INTERPRETATION_FIELDS = Object.freeze([
  'summary',
  'situationReflection',
  'smallAction',
  'safetyNote',
]);
const INTERPRETATION_LIMITS = Object.freeze({
  summary: 240,
  situationReflection: 500,
  smallAction: 240,
  safetyNote: 300,
});
const PROHIBITED_INTERPRETATION_PHRASES = Object.freeze([
  '一定',
  '必然',
  '必定',
  '肯定会',
  '绝对会',
  '保证',
  '注定',
  '灾祸将至',
  '必得横财',
  '确定发财',
  '确定患病',
  '确定遭遇灾祸',
  '保证复合',
  '保证升职',
  '稳赚',
  '包赚',
]);
const PROHIBITED_INTERPRETATION_PATTERNS = Object.freeze([
  /停止服药/,
  /放弃[^，。；\n]{0,20}治疗/,
  /确定[^，。；\n]{0,20}(?:买入|卖出)/,
  /实施[^，。；\n]{0,20}(?:自伤|自杀|伤害他人)/,
]);

function createPublicError(publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = 400;
  error.code = 'INVALID_FORTUNE_REQUEST';
  error.publicMessage = publicMessage;
  return error;
}

function createInterpretationError(
  statusCode,
  code,
  publicMessage
) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function validateInterpretationCandidate(candidate) {
  if (!isPlainObject(candidate)) {
    throw createInterpretationError(
      502,
      'FORTUNE_MODEL_INVALID_OUTPUT',
      'The text model returned an invalid interpretation'
    );
  }
  const fields = Object.keys(candidate);
  if (
    fields.length !== INTERPRETATION_FIELDS.length
    || fields.some(
      (field) => !INTERPRETATION_FIELDS.includes(field)
    )
  ) {
    throw createInterpretationError(
      502,
      'FORTUNE_MODEL_INVALID_OUTPUT',
      'The text model returned an invalid interpretation'
    );
  }

  const normalized = {};
  for (const field of INTERPRETATION_FIELDS) {
    const value = candidate[field];
    if (
      typeof value !== 'string'
      || value.trim() === ''
      || value.trim().length > INTERPRETATION_LIMITS[field]
      || /[<>]/.test(value)
    ) {
      throw createInterpretationError(
        502,
        'FORTUNE_MODEL_INVALID_OUTPUT',
        'The text model returned an invalid interpretation'
      );
    }
    normalized[field] = value.trim();
  }

  const combinedText = INTERPRETATION_FIELDS
    .map((field) => normalized[field])
    .join('\n');
  if (
    PROHIBITED_INTERPRETATION_PHRASES.some(
      (phrase) => combinedText.includes(phrase)
    )
    || PROHIBITED_INTERPRETATION_PATTERNS.some(
      (pattern) => pattern.test(combinedText)
    )
  ) {
    throw createInterpretationError(
      502,
      'FORTUNE_MODEL_UNSAFE_OUTPUT',
      'The text model returned an unsafe interpretation'
    );
  }
  return normalized;
}

function buildPublicInterpretation(session) {
  return {
    sessionId: session.id,
    interpretation: {
      summary: session.interpretation.summary,
      situationReflection:
        session.interpretation.situationReflection,
      smallAction: session.interpretation.smallAction,
      safetyNote: session.interpretation.safetyNote,
    },
  };
}

function createFortuneService({
  fortuneSessionStore,
  catalogVersion,
  lots,
  clock = Date.now,
  idGenerator = () => `fortune_${crypto.randomUUID()}`,
  randomInt = crypto.randomInt,
  interpretationClient = null,
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
  if (
    interpretationClient !== null
    && (
      typeof interpretationClient !== 'object'
      || typeof interpretationClient.generateInterpretation
        !== 'function'
    )
  ) {
    throw new TypeError(
      'interpretationClient must provide generateInterpretation'
    );
  }

  validateCatalog({ catalogVersion, lots });
  const enabledLots = lots
    .filter((lot) => lot.enabled)
    .map((lot) => cloneLot(lot));
  const interpretationRequestsBySessionId = new Map();

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
      interpretationStatus: 'not_requested',
      interpretation: null,
    };
    fortuneSessionStore.save(session);
    return buildPublicFortuneSession(session);
  }

  async function interpretSession(sessionId) {
    if (
      typeof sessionId !== 'string'
      || sessionId === ''
      || sessionId.trim() !== sessionId
      || sessionId.length > 128
      || !/^[A-Za-z0-9_-]+$/.test(sessionId)
    ) {
      throw createInterpretationError(
        400,
        'INVALID_FORTUNE_INTERPRETATION_REQUEST',
        'A valid Fortune Session ID is required'
      );
    }

    let session = fortuneSessionStore.findById(sessionId);
    if (!session) {
      throw createInterpretationError(
        404,
        'FORTUNE_SESSION_NOT_FOUND',
        'Requested Fortune Session was not found'
      );
    }
    if (session.status !== 'drawn' || !session.lotSnapshot) {
      throw createInterpretationError(
        409,
        'FORTUNE_SESSION_NOT_DRAWN',
        'Fortune Session must be drawn before interpretation'
      );
    }
    if (
      session.interpretationStatus === 'completed'
      && session.interpretation !== null
    ) {
      return buildPublicInterpretation(session);
    }

    const existingRequest =
      interpretationRequestsBySessionId.get(sessionId);
    if (existingRequest) {
      return existingRequest;
    }
    if (session.interpretationStatus === 'generating') {
      session = {
        ...session,
        interpretationStatus: 'not_requested',
        interpretation: null,
      };
      fortuneSessionStore.replace(session);
    }
    if (interpretationClient === null) {
      throw createInterpretationError(
        503,
        'FORTUNE_MODEL_UNAVAILABLE',
        'Fortune interpretation is temporarily unavailable'
      );
    }

    const generatingSession = {
      ...session,
      interpretationStatus: 'generating',
      interpretation: null,
    };
    fortuneSessionStore.replace(generatingSession);

    const generationPromise = (async () => {
      try {
        const candidate =
          await interpretationClient.generateInterpretation({
            deityKey: generatingSession.deityKey,
            situationText: generatingSession.situationText,
            catalogVersion: generatingSession.catalogVersion,
            lot: cloneLot(generatingSession.lotSnapshot),
          });
        const interpretation =
          validateInterpretationCandidate(candidate);
        const completedSession = {
          ...generatingSession,
          interpretationStatus: 'completed',
          interpretation: {
            schemaVersion: INTERPRETATION_SCHEMA_VERSION,
            ...interpretation,
            generatedAt: new Date(clock()).toISOString(),
          },
        };
        fortuneSessionStore.replace(completedSession);
        return buildPublicInterpretation(completedSession);
      } catch (error) {
        const currentSession =
          fortuneSessionStore.findById(sessionId);
        if (
          currentSession
          && currentSession.interpretationStatus === 'generating'
        ) {
          fortuneSessionStore.replace({
            ...currentSession,
            interpretationStatus: 'not_requested',
            interpretation: null,
          });
        }
        if (
          error
          && Number.isInteger(error.statusCode)
          && typeof error.code === 'string'
          && typeof error.publicMessage === 'string'
        ) {
          throw error;
        }
        if (error && error.unavailable === true) {
          throw createInterpretationError(
            503,
            'FORTUNE_MODEL_UNAVAILABLE',
            'Fortune interpretation is temporarily unavailable'
          );
        }
        throw createInterpretationError(
          502,
          'FORTUNE_MODEL_FAILED',
          'Fortune interpretation could not be generated'
        );
      }
    })();
    interpretationRequestsBySessionId.set(
      sessionId,
      generationPromise
    );

    try {
      return await generationPromise;
    } finally {
      if (
        interpretationRequestsBySessionId.get(sessionId)
        === generationPromise
      ) {
        interpretationRequestsBySessionId.delete(sessionId);
      }
    }
  }

  return {
    createDrawnSession,
    interpretSession,
  };
}

module.exports = {
  INTERPRETATION_SCHEMA_VERSION,
  MAX_SITUATION_TEXT_LENGTH,
  buildPublicFortuneSession,
  buildPublicInterpretation,
  createFortuneService,
  validateCatalog,
  validateInterpretationCandidate,
};
