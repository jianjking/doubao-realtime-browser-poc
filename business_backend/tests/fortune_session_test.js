'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../app');
const {
  FORTUNE_CATALOG_VERSION,
  FORTUNE_LOTS,
} = require('../config/fortune_lots');
const {
  createFortuneService,
} = require('../services/fortune_service');
const {
  MemoryFortuneSessionStore,
} = require('../stores/memory_fortune_session_store');

function cloneLots() {
  return FORTUNE_LOTS.map((lot) => ({
    ...lot,
    verseLines: [...lot.verseLines],
  }));
}

function createService(overrides = {}) {
  const store = overrides.fortuneSessionStore
    || new MemoryFortuneSessionStore();
  return {
    store,
    service: createFortuneService({
      fortuneSessionStore: store,
      catalogVersion: FORTUNE_CATALOG_VERSION,
      lots: cloneLots(),
      clock: () => Date.parse('2026-07-28T06:00:00.000Z'),
      idGenerator: () => 'fortune-test',
      randomInt: () => 0,
      ...overrides,
    }),
  };
}

function listenOnTemporaryPort(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startApp(options = {}) {
  const server = http.createServer(createApp(options));
  await listenOnTemporaryPort(server);
  return {
    server,
    port: server.address().port,
  };
}

function request({
  port,
  path: requestPath,
  method = 'GET',
  headers = {},
  body,
}) {
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers,
    }, (response) => {
      response.setEncoding('utf8');
      let responseBody = '';
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: responseBody,
        });
      });
    });
    clientRequest.on('error', reject);
    clientRequest.end(body);
  });
}

function requestJson(port, body, cookie) {
  const serializedBody = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(serializedBody),
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return request({
    port,
    path: '/api/fortune-sessions',
    method: 'POST',
    headers,
    body: serializedBody,
  });
}

function parseJson(response) {
  return JSON.parse(response.body);
}

function extractCookie(response) {
  return response.headers['set-cookie'][0].split(';', 1)[0];
}

test('prototype fortune catalog has a valid immutable shape', () => {
  assert.equal(FORTUNE_CATALOG_VERSION, 'prototype-v1');
  assert.equal(Object.isFrozen(FORTUNE_LOTS), true);
  assert.ok(FORTUNE_LOTS.length >= 6);
  assert.equal(
    new Set(FORTUNE_LOTS.map((lot) => lot.id)).size,
    FORTUNE_LOTS.length
  );
  assert.equal(
    new Set(FORTUNE_LOTS.map((lot) => lot.number)).size,
    FORTUNE_LOTS.length
  );
  assert.ok(FORTUNE_LOTS.some((lot) => lot.enabled));
  for (const lot of FORTUNE_LOTS) {
    assert.equal(Object.isFrozen(lot), true);
    assert.equal(Object.isFrozen(lot.verseLines), true);
    assert.ok(lot.verseLines.length > 0);
  }
});

test('fortune service rejects invalid catalogs at creation', () => {
  const invalidCatalogs = [
    [],
    [
      { ...cloneLots()[0] },
      { ...cloneLots()[1], id: cloneLots()[0].id },
    ],
    [
      { ...cloneLots()[0] },
      { ...cloneLots()[1], number: cloneLots()[0].number },
    ],
    [{ ...cloneLots()[0], number: 1.5 }],
    [{ ...cloneLots()[0], verseLines: [] }],
    cloneLots().map((lot) => ({ ...lot, enabled: false })),
  ];

  for (const lots of invalidCatalogs) {
    assert.throws(() => {
      createFortuneService({
        fortuneSessionStore: new MemoryFortuneSessionStore(),
        catalogVersion: FORTUNE_CATALOG_VERSION,
        lots,
      });
    });
  }
});

test('injected selector draws first, last, and selected enabled lots', () => {
  for (const index of [0, FORTUNE_LOTS.length - 1, 2]) {
    const { service } = createService({
      idGenerator: () => `fortune-${index}`,
      randomInt: (upperBound) => {
        assert.equal(upperBound, FORTUNE_LOTS.length);
        return index;
      },
    });
    const result = service.createDrawnSession({
      deityKey: 'yuhuang',
      situationText: '  愿家人平安顺遂  ',
    });
    assert.equal(result.lot.id, FORTUNE_LOTS[index].id);
    assert.equal(result.lot.number, FORTUNE_LOTS[index].number);
  }

  const serviceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/fortune_service.js'),
    'utf8'
  );
  assert.match(serviceSource, /randomInt = crypto\.randomInt/);
});

test('draw stores an immutable snapshot and public copies', () => {
  const lots = cloneLots();
  const store = new MemoryFortuneSessionStore();
  const service = createFortuneService({
    fortuneSessionStore: store,
    catalogVersion: FORTUNE_CATALOG_VERSION,
    lots,
    clock: () => Date.parse('2026-07-28T06:00:00.000Z'),
    idGenerator: () => 'fortune-snapshot',
    randomInt: () => 0,
  });
  const publicSession = service.createDrawnSession({
    deityKey: 'yuhuang',
    situationText: '  愿事情稳步推进  ',
    ownerType: 'guest',
    ownerId: 'guest-1',
  });
  lots[0].title = 'changed catalog';
  lots[0].verseLines[0] = 'changed verse';
  publicSession.lot.title = 'changed response';
  publicSession.lot.verseLines[0] = 'changed response verse';

  const stored = store.findById('fortune-snapshot');
  assert.equal(stored.situationText, '愿事情稳步推进');
  assert.equal(stored.ownerType, 'guest');
  assert.equal(stored.ownerId, 'guest-1');
  assert.equal(stored.lotSnapshot.title, FORTUNE_LOTS[0].title);
  assert.equal(
    stored.lotSnapshot.verseLines[0],
    FORTUNE_LOTS[0].verseLines[0]
  );
  stored.lotSnapshot.title = 'external mutation';
  assert.equal(
    store.findById('fortune-snapshot').lotSnapshot.title,
    FORTUNE_LOTS[0].title
  );
});

test('fortune request validation rejects invalid input', async () => {
  const { port, server } = await startApp();
  try {
    const invalidBodies = [
      {},
      { deityKey: 'yuhuang', situationText: '' },
      { deityKey: 'yuhuang', situationText: ' '.repeat(5) },
      { deityKey: 'yuhuang', situationText: '愿'.repeat(1001) },
      { deityKey: 'yuhuang', situationText: null },
      { deityKey: 'yuhuang', situationText: [] },
      { deityKey: 'yuhuang', situationText: {} },
      { deityKey: '../yuhuang', situationText: '愿平安' },
      { deityKey: '<b>玉皇</b>', situationText: '愿平安' },
      { deityKey: 'guanyin', situationText: '愿平安' },
    ];
    for (const body of invalidBodies) {
      const response = await requestJson(port, body);
      assert.equal(response.statusCode, 400);
      assert.equal(
        parseJson(response).error.code,
        'INVALID_FORTUNE_REQUEST'
      );
    }

    const malformed = await request({
      port,
      path: '/api/fortune-sessions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"deityKey":',
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(
      parseJson(malformed).error.code,
      'INVALID_FORTUNE_REQUEST'
    );
  } finally {
    await closeServer(server);
  }
});

test('anonymous request returns only the public fixed-lot projection', async () => {
  const { port, server } = await startApp({
    clock: () => Date.parse('2026-07-28T06:00:00.000Z'),
    fortuneSessionIdGenerator: () => 'fortune-api',
    fortuneRandomInt: () => 1,
  });
  try {
    const response = await requestJson(port, {
      deityKey: 'yuhuang',
      situationText: '  愿家中安稳  ',
      lotId: FORTUNE_LOTS[5].id,
      lotNumber: 6,
      level: '上吉',
      status: 'changed',
      userId: 'forged-user',
    });
    assert.equal(response.statusCode, 201);
    const body = parseJson(response);
    assert.deepEqual(Object.keys(body), ['fortuneSession']);
    assert.equal(body.fortuneSession.id, 'fortune-api');
    assert.equal(body.fortuneSession.status, 'drawn');
    assert.equal(body.fortuneSession.deityKey, 'yuhuang');
    assert.equal(
      body.fortuneSession.catalogVersion,
      FORTUNE_CATALOG_VERSION
    );
    assert.equal(body.fortuneSession.lot.id, FORTUNE_LOTS[1].id);
    assert.equal('situationText' in body.fortuneSession, false);
    assert.equal('ownerType' in body.fortuneSession, false);
    assert.equal('ownerId' in body.fortuneSession, false);
    assert.equal('randomIndex' in body.fortuneSession, false);
  } finally {
    await closeServer(server);
  }
});

test('guest and logged-in user can draw without Call or balance effects', async () => {
  let nextFortuneId = 1;
  const { port, server } = await startApp({
    developmentVerificationCode: '654321',
    fortuneSessionIdGenerator: () => (
      `fortune-owner-${nextFortuneId++}`
    ),
    fortuneRandomInt: () => 0,
  });
  try {
    const guestResponse = await request({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const guestDraw = await requestJson(
      port,
      { deityKey: 'yuhuang', situationText: '愿心安' },
      extractCookie(guestResponse)
    );
    assert.equal(guestDraw.statusCode, 201);

    const loginBody = JSON.stringify({
      phone: '13800138000',
      code: '654321',
    });
    const loginResponse = await request({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginBody),
      },
      body: loginBody,
    });
    assert.equal(loginResponse.statusCode, 200);
    const userCookie = extractCookie(loginResponse);
    const accountBefore = await request({
      port,
      path: '/api/me',
      headers: { Cookie: userCookie },
    });
    const userDraw = await requestJson(
      port,
      { deityKey: 'yuhuang', situationText: '愿事顺遂' },
      userCookie
    );
    const accountAfter = await request({
      port,
      path: '/api/me',
      headers: { Cookie: userCookie },
    });
    assert.equal(userDraw.statusCode, 201);
    assert.deepEqual(parseJson(accountAfter), parseJson(accountBefore));
  } finally {
    await closeServer(server);
  }
});

test('service failures return a sanitized 500 response', async () => {
  const { port, server } = await startApp({
    fortuneRandomInt: () => {
      throw new Error('sensitive-internal-random-error');
    },
  });
  try {
    const response = await requestJson(port, {
      deityKey: 'yuhuang',
      situationText: '愿平安',
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(parseJson(response), {
      error: {
        code: 'FORTUNE_SERVICE_UNAVAILABLE',
        message: 'Fortune service is temporarily unavailable',
      },
    });
    assert.equal(
      response.body.includes('sensitive-internal-random-error'),
      false
    );
  } finally {
    await closeServer(server);
  }
});

test('separate app instances do not share Fortune Sessions', () => {
  const first = createService();
  const second = createService();
  first.service.createDrawnSession({
    deityKey: 'yuhuang',
    situationText: '愿平安',
  });
  assert.notEqual(first.store.findById('fortune-test'), null);
  assert.equal(second.store.findById('fortune-test'), null);
});
