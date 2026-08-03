'use strict';

const crypto = require('node:crypto');
const {
  MAX_INTERPRETATION_TEXT_LENGTH,
  normalizeInterpretationCandidate,
} = require('../contracts/fortune_interpretation_contract');
const {
  DEFAULT_FORTUNE_DRAW_PRICE_CENTS,
  MAX_FORTUNE_DRAW_PRICE_CENTS,
} = require('../config/fortune_pricing_config');

const ALLOWED_DEITY_KEYS = new Set(['yuhuang']);
const ALLOWED_CHARACTER_KEYS = new Set([
  'yuhuang',
  'sunwukong',
  'guanyin',
  'caishen',
  'rulai',
  'zhubajie',
  'shawujing',
  'tangseng',
]);
const CLIENT_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERY_SITUATION_TEXT =
  '用户已在殿前诚心许愿，请依据签文作温和解读。';
const MAX_SITUATION_TEXT_LENGTH = 1000;
const INTERPRETATION_SCHEMA_VERSION = 'fortune-interpretation-v2';
const SUPPORTED_INTERPRETATION_AUDIO_TYPES = new Set([
  'audio/mpeg',
]);
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

function createInterpretationAudioError(
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

function createFortuneServiceError(
  statusCode,
  code,
  publicMessage,
  publicDetails = null
) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  if (publicDetails !== null) {
    error.publicDetails = publicDetails;
  }
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
  let normalized;
  try {
    normalized = normalizeInterpretationCandidate(candidate);
  } catch {
    throw createInterpretationError(
      502,
      'FORTUNE_MODEL_INVALID_OUTPUT',
      'The text model returned an invalid interpretation'
    );
  }

  if (
    PROHIBITED_INTERPRETATION_PHRASES.some(
      (phrase) => normalized.text.includes(phrase)
    )
    || PROHIBITED_INTERPRETATION_PATTERNS.some(
      (pattern) => pattern.test(normalized.text)
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
      text: session.interpretation.text,
    },
  };
}

function validateInterpretationAudioResult(result) {
  if (
    !isPlainObject(result)
    || !Buffer.isBuffer(result.audioBuffer)
    || result.audioBuffer.length === 0
    || typeof result.contentType !== 'string'
    || !SUPPORTED_INTERPRETATION_AUDIO_TYPES.has(
      result.contentType
    )
  ) {
    throw new TypeError('TTS client returned invalid audio');
  }
  return {
    contentType: result.contentType,
    audioBuffer: Buffer.from(result.audioBuffer),
  };
}

function buildPublicInterpretationAudio(session) {
  return {
    contentType: session.interpretationAudio.contentType,
    audioBuffer: Buffer.from(
      session.interpretationAudio.audioBuffer
    ),
  };
}

function createFortuneService({
  fortuneSessionStore,
  fortunePurchaseStore = null,
  userStore = null,
  accountStore = null,
  runInTransaction = null,
  drawPriceCents = DEFAULT_FORTUNE_DRAW_PRICE_CENTS,
  catalogVersion,
  lots,
  clock = Date.now,
  idGenerator = () => `fortune_${crypto.randomUUID()}`,
  purchaseIdGenerator = () => `fortune_purchase_${crypto.randomUUID()}`,
  randomInt = crypto.randomInt,
  snapshotSerializer = JSON.stringify,
  interpretationClient = null,
  ttsClient = null,
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
  if (typeof purchaseIdGenerator !== 'function') {
    throw new TypeError('purchaseIdGenerator must be a function');
  }
  if (typeof randomInt !== 'function') {
    throw new TypeError('randomInt must be a function');
  }
  if (typeof snapshotSerializer !== 'function') {
    throw new TypeError('snapshotSerializer must be a function');
  }
  if (
    !Number.isSafeInteger(drawPriceCents)
    || drawPriceCents < 1
    || drawPriceCents > MAX_FORTUNE_DRAW_PRICE_CENTS
  ) {
    throw new TypeError('drawPriceCents must be a positive safe integer');
  }
  const paidDependencies = [
    fortunePurchaseStore,
    userStore,
    accountStore,
    runInTransaction,
  ];
  if (
    paidDependencies.some((dependency) => dependency !== null)
    && (
      !fortunePurchaseStore
      || !userStore
      || !accountStore
      || typeof runInTransaction !== 'function'
      || typeof accountStore.debitBalanceCentsForFortune !== 'function'
    )
  ) {
    throw new TypeError('Paid Fortune service dependencies are required');
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
  if (
    ttsClient !== null
    && (
      typeof ttsClient !== 'object'
      || typeof ttsClient.synthesize !== 'function'
    )
  ) {
    throw new TypeError('ttsClient must provide synthesize');
  }

  validateCatalog({ catalogVersion, lots });
  const enabledLots = lots
    .filter((lot) => lot.enabled)
    .map((lot) => cloneLot(lot));
  const interpretationRequestsBySessionId = new Map();
  const interpretationAudioRequestsBySessionId = new Map();

  function selectEnabledLot() {
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
    return cloneLot(enabledLots[selectedIndex]);
  }

  function buildDrawnSession({
    deityKey,
    characterKey,
    situationText,
    ownerType,
    ownerId,
  }) {
    const drawnAt = new Date(clock()).toISOString();
    return {
      id: idGenerator(),
      status: 'drawn',
      deityKey,
      characterKey,
      situationText,
      catalogVersion,
      lotSnapshot: selectEnabledLot(),
      ownerType,
      ownerId,
      createdAt: drawnAt,
      drawnAt,
      interpretationStatus: 'not_requested',
      interpretation: null,
      interpretationAudioStatus: 'not_requested',
      interpretationAudio: null,
    };
  }

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

    const session = buildDrawnSession({
      deityKey,
      characterKey: deityKey,
      situationText: normalizedSituationText,
      ownerType,
      ownerId,
    });
    fortuneSessionStore.save(session);
    return buildPublicFortuneSession(session);
  }

  function validatePaidDrawRequest({
    userId,
    clientRequestId,
    characterKey,
    situationText,
  }) {
    if (typeof userId !== 'string' || userId === '') {
      throw createFortuneServiceError(
        401,
        'USER_LOGIN_REQUIRED',
        'Phone login is required for Fortune drawing'
      );
    }
    if (
      typeof clientRequestId !== 'string'
      || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)
    ) {
      throw createFortuneServiceError(
        400,
        'INVALID_CLIENT_REQUEST_ID',
        'A valid clientRequestId is required'
      );
    }
    if (
      typeof characterKey !== 'string'
      || !ALLOWED_CHARACTER_KEYS.has(characterKey)
    ) {
      throw createFortuneServiceError(
        400,
        'INVALID_FORTUNE_REQUEST',
        'A valid characterKey is required'
      );
    }
    if (typeof situationText !== 'string') {
      throw createFortuneServiceError(
        400,
        'INVALID_FORTUNE_REQUEST',
        'situationText must be a string'
      );
    }
    const normalizedSituationText = situationText.trim();
    if (
      normalizedSituationText === ''
      || normalizedSituationText.length > MAX_SITUATION_TEXT_LENGTH
    ) {
      throw createFortuneServiceError(
        400,
        'INVALID_FORTUNE_REQUEST',
        'situationText must contain 1 to 1000 characters'
      );
    }
    return normalizedSituationText;
  }

  function buildPersistedSnapshot(session) {
    return {
      schemaVersion: 'paid-fortune-v1',
      session: {
        ...session,
        situationText: RECOVERY_SITUATION_TEXT,
        lotSnapshot: cloneLot(session.lotSnapshot),
        interpretationStatus: 'not_requested',
        interpretation: null,
        interpretationAudioStatus: 'not_requested',
        interpretationAudio: null,
      },
    };
  }

  function restoreSessionFromPurchase(purchase) {
    let snapshot;
    try {
      snapshot = fortunePurchaseStore.getPublicSessionSnapshot(
        purchase.fortuneSessionId
      );
    } catch {
      throw createFortuneServiceError(
        500,
        'FORTUNE_CHARGE_FAILED',
        'Stored Fortune Session could not be restored'
      );
    }
    const session = snapshot && snapshot.session;
    if (
      !snapshot
      || snapshot.schemaVersion !== 'paid-fortune-v1'
      || !session
      || typeof session !== 'object'
      || Array.isArray(session)
      || session.id !== purchase.fortuneSessionId
      || session.ownerType !== 'user'
      || session.ownerId !== purchase.userId
      || session.characterKey !== purchase.characterKey
      || session.catalogVersion !== purchase.catalogVersion
      || session.status !== 'drawn'
      || !session.lotSnapshot
      || typeof session.lotSnapshot !== 'object'
      || !Array.isArray(session.lotSnapshot.verseLines)
    ) {
      throw createFortuneServiceError(
        500,
        'FORTUNE_CHARGE_FAILED',
        'Stored Fortune Session could not be restored'
      );
    }
    return {
      ...session,
      lotSnapshot: cloneLot(session.lotSnapshot),
      situationText: RECOVERY_SITUATION_TEXT,
      interpretationStatus: 'not_requested',
      interpretation: null,
      interpretationAudioStatus: 'not_requested',
      interpretationAudio: null,
    };
  }

  function rememberSession(session) {
    const existing = fortuneSessionStore.findById(session.id);
    if (!existing) {
      fortuneSessionStore.save(session);
      return session;
    }
    if (
      existing.ownerType !== session.ownerType
      || existing.ownerId !== session.ownerId
    ) {
      throw createFortuneServiceError(
        500,
        'FORTUNE_CHARGE_FAILED',
        'Fortune Session could not be restored'
      );
    }
    return existing;
  }

  function buildPaidDrawResult(purchase, session, alreadyProcessed) {
    return {
      fortuneSession: buildPublicFortuneSession(session),
      charge: {
        priceCents: purchase.priceCents,
        currency: purchase.currency,
        balanceBeforeCents: purchase.balanceBeforeCents,
        balanceAfterCents: purchase.balanceAfterCents,
        alreadyProcessed,
      },
    };
  }

  function createPaidFortuneSession({
    userId,
    clientRequestId,
    characterKey,
    situationText,
  } = {}) {
    if (!fortunePurchaseStore) {
      throw createFortuneServiceError(
        503,
        'FORTUNE_CHARGE_FAILED',
        'Paid Fortune drawing is temporarily unavailable'
      );
    }
    const normalizedSituationText = validatePaidDrawRequest({
      userId,
      clientRequestId,
      characterKey,
      situationText,
    });

    let transactionResult;
    runInTransaction(() => {
      const existingPurchase =
        fortunePurchaseStore.findByUserAndClientRequestId(
          userId,
          clientRequestId
        );
      if (existingPurchase) {
        transactionResult = {
          purchase: existingPurchase,
          session: restoreSessionFromPurchase(existingPurchase),
          alreadyProcessed: true,
        };
        return;
      }

      const user = userStore.findById(userId);
      if (!user || user.status !== 'active') {
        throw createFortuneServiceError(
          401,
          'USER_LOGIN_REQUIRED',
          'Phone login is required for Fortune drawing'
        );
      }
      const account = accountStore.findByUserId(userId);
      if (
        !account
        || account.status !== 'active'
        || account.currency !== 'CNY'
      ) {
        throw createFortuneServiceError(
          409,
          'ACCOUNT_UNAVAILABLE',
          'User account is unavailable'
        );
      }
      if (account.balanceCents < drawPriceCents) {
        throw createFortuneServiceError(
          409,
          'INSUFFICIENT_ACCOUNT_BALANCE',
          'Account balance is insufficient for this Fortune drawing',
          {
            priceCents: drawPriceCents,
            balanceCents: account.balanceCents,
            shortfallCents: drawPriceCents - account.balanceCents,
          }
        );
      }

      const session = buildDrawnSession({
        deityKey: 'yuhuang',
        characterKey,
        situationText: normalizedSituationText,
        ownerType: 'user',
        ownerId: userId,
      });
      let fortuneSnapshotJson;
      try {
        fortuneSnapshotJson = snapshotSerializer(
          buildPersistedSnapshot(session)
        );
      } catch {
        throw createFortuneServiceError(
          500,
          'FORTUNE_CHARGE_FAILED',
          'Fortune Session could not be persisted'
        );
      }
      if (typeof fortuneSnapshotJson !== 'string' || fortuneSnapshotJson === '') {
        throw createFortuneServiceError(
          500,
          'FORTUNE_CHARGE_FAILED',
          'Fortune Session could not be persisted'
        );
      }

      const chargedAt = session.drawnAt;
      const balanceAfterCents = account.balanceCents - drawPriceCents;
      const updatedRows = accountStore.debitBalanceCentsForFortune({
        userId,
        amountCents: drawPriceCents,
        updatedAt: chargedAt,
      });
      if (updatedRows !== 1) {
        throw createFortuneServiceError(
          409,
          'FORTUNE_CHARGE_FAILED',
          'Fortune charge could not be completed'
        );
      }

      const purchase = {
        id: purchaseIdGenerator(),
        userId,
        accountId: account.userId,
        clientRequestId,
        fortuneSessionId: session.id,
        characterKey,
        catalogVersion,
        fortuneSnapshotJson,
        priceCents: drawPriceCents,
        currency: 'CNY',
        status: 'charged',
        balanceBeforeCents: account.balanceCents,
        balanceAfterCents,
        createdAt: chargedAt,
        chargedAt,
      };
      if (fortunePurchaseStore.createChargedPurchase(purchase) !== 1) {
        throw createFortuneServiceError(
          500,
          'FORTUNE_CHARGE_FAILED',
          'Fortune Session could not be persisted'
        );
      }
      transactionResult = {
        purchase,
        session,
        alreadyProcessed: false,
      };
    });

    if (!transactionResult) {
      throw createFortuneServiceError(
        500,
        'FORTUNE_CHARGE_FAILED',
        'Fortune charge could not be completed'
      );
    }
    const rememberedSession = rememberSession(transactionResult.session);
    return buildPaidDrawResult(
      transactionResult.purchase,
      rememberedSession,
      transactionResult.alreadyProcessed
    );
  }

  function requireOwnedSession(userId, sessionId) {
    const legacyLookup = sessionId === undefined;
    const requestedSessionId = legacyLookup ? userId : sessionId;
    const requestedUserId = legacyLookup ? null : userId;
    let session = fortuneSessionStore.findById(requestedSessionId);
    if (
      session
      && (
        requestedUserId === null
          ? session.ownerType !== 'user'
          : session.ownerType === 'user'
            && session.ownerId === requestedUserId
      )
    ) {
      return session;
    }
    if (requestedUserId === null || !fortunePurchaseStore) {
      throw createInterpretationError(
        404,
        'FORTUNE_SESSION_NOT_FOUND',
        'Requested Fortune Session was not found'
      );
    }
    const purchase = fortunePurchaseStore.findByFortuneSessionId(
      requestedSessionId
    );
    if (!purchase || purchase.userId !== requestedUserId) {
      throw createInterpretationError(
        404,
        'FORTUNE_SESSION_ACCESS_DENIED',
        'Requested Fortune Session was not found'
      );
    }
    session = rememberSession(restoreSessionFromPurchase(purchase));
    return session;
  }

  function getPaidFortuneSession(userId, sessionId) {
    if (
      typeof userId !== 'string'
      || userId === ''
      || typeof sessionId !== 'string'
      || sessionId === ''
      || sessionId.length > 128
      || !/^[A-Za-z0-9_-]+$/.test(sessionId)
    ) {
      throw createFortuneServiceError(
        404,
        'FORTUNE_SESSION_NOT_FOUND',
        'Requested Fortune Session was not found'
      );
    }
    const purchase = fortunePurchaseStore.findByFortuneSessionId(sessionId);
    if (!purchase || purchase.userId !== userId) {
      throw createFortuneServiceError(
        404,
        'FORTUNE_SESSION_ACCESS_DENIED',
        'Requested Fortune Session was not found'
      );
    }
    const session = rememberSession(restoreSessionFromPurchase(purchase));
    return buildPaidDrawResult(purchase, session, true);
  }

  async function interpretSession(userId, sessionId) {
    const requestedSessionId = sessionId === undefined ? userId : sessionId;
    if (
      typeof requestedSessionId !== 'string'
      || requestedSessionId === ''
      || requestedSessionId.trim() !== requestedSessionId
      || requestedSessionId.length > 128
      || !/^[A-Za-z0-9_-]+$/.test(requestedSessionId)
    ) {
      throw createInterpretationError(
        400,
        'INVALID_FORTUNE_INTERPRETATION_REQUEST',
        'A valid Fortune Session ID is required'
      );
    }

    let session = requireOwnedSession(userId, sessionId);
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
      interpretationRequestsBySessionId.get(requestedSessionId);
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
          fortuneSessionStore.findById(requestedSessionId);
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
      requestedSessionId,
      generationPromise
    );

    try {
      return await generationPromise;
    } finally {
      if (
        interpretationRequestsBySessionId.get(requestedSessionId)
        === generationPromise
      ) {
        interpretationRequestsBySessionId.delete(requestedSessionId);
      }
    }
  }

  async function synthesizeInterpretationAudio(userId, sessionId) {
    const requestedSessionId = sessionId === undefined ? userId : sessionId;
    if (
      typeof requestedSessionId !== 'string'
      || requestedSessionId === ''
      || requestedSessionId.trim() !== requestedSessionId
      || requestedSessionId.length > 128
      || !/^[A-Za-z0-9_-]+$/.test(requestedSessionId)
    ) {
      throw createInterpretationAudioError(
        400,
        'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST',
        'A valid Fortune Session ID is required'
      );
    }

    let session;
    try {
      session = requireOwnedSession(userId, sessionId);
    } catch (error) {
      if (
        error
        && (
          error.code === 'FORTUNE_SESSION_NOT_FOUND'
          || error.code === 'FORTUNE_SESSION_ACCESS_DENIED'
        )
      ) {
        throw createInterpretationAudioError(
          404,
          error.code,
          'Requested Fortune Session was not found'
        );
      }
      throw error;
    }
    if (
      session.interpretationStatus !== 'completed'
      || session.interpretation === null
    ) {
      throw createInterpretationAudioError(
        409,
        'FORTUNE_INTERPRETATION_NOT_READY',
        'Fortune interpretation must be completed before audio'
      );
    }
    if (
      session.interpretationAudioStatus === 'completed'
      && session.interpretationAudio !== null
    ) {
      return buildPublicInterpretationAudio(session);
    }

    const existingRequest =
      interpretationAudioRequestsBySessionId.get(requestedSessionId);
    if (existingRequest) {
      const result = await existingRequest;
      return {
        contentType: result.contentType,
        audioBuffer: Buffer.from(result.audioBuffer),
      };
    }
    if (session.interpretationAudioStatus === 'generating') {
      session = {
        ...session,
        interpretationAudioStatus: 'not_requested',
        interpretationAudio: null,
      };
      fortuneSessionStore.replace(session);
    }
    if (ttsClient === null) {
      throw createInterpretationAudioError(
        503,
        'FORTUNE_TTS_UNAVAILABLE',
        'Fortune interpretation audio is temporarily unavailable'
      );
    }

    const generatingSession = {
      ...session,
      interpretationAudioStatus: 'generating',
      interpretationAudio: null,
    };
    fortuneSessionStore.replace(generatingSession);

    const generationPromise = (async () => {
      try {
        const result = validateInterpretationAudioResult(
          await ttsClient.synthesize({
            text: generatingSession.interpretation.text,
          })
        );
        const completedSession = {
          ...generatingSession,
          interpretationAudioStatus: 'completed',
          interpretationAudio: {
            contentType: result.contentType,
            audioBuffer: Buffer.from(result.audioBuffer),
          },
        };
        fortuneSessionStore.replace(completedSession);
        return buildPublicInterpretationAudio(completedSession);
      } catch {
        const currentSession =
          fortuneSessionStore.findById(requestedSessionId);
        if (
          currentSession
          && currentSession.interpretationAudioStatus
            === 'generating'
        ) {
          fortuneSessionStore.replace({
            ...currentSession,
            interpretationAudioStatus: 'not_requested',
            interpretationAudio: null,
          });
        }
        throw createInterpretationAudioError(
          502,
          'FORTUNE_TTS_FAILED',
          'Fortune interpretation audio could not be generated'
        );
      }
    })();
    interpretationAudioRequestsBySessionId.set(
      requestedSessionId,
      generationPromise
    );

    try {
      return await generationPromise;
    } finally {
      if (
        interpretationAudioRequestsBySessionId.get(requestedSessionId)
        === generationPromise
      ) {
        interpretationAudioRequestsBySessionId.delete(requestedSessionId);
      }
    }
  }

  return {
    createDrawnSession,
    createPaidFortuneSession,
    getPaidFortuneSession,
    interpretSession,
    synthesizeInterpretationAudio,
  };
}

module.exports = {
  INTERPRETATION_SCHEMA_VERSION,
  MAX_INTERPRETATION_TEXT_LENGTH,
  MAX_SITUATION_TEXT_LENGTH,
  buildPublicFortuneSession,
  buildPublicInterpretation,
  createFortuneService,
  validateCatalog,
  validateInterpretationCandidate,
  RECOVERY_SITUATION_TEXT,
};
