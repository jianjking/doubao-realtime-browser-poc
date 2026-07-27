'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { PUBLIC_ROLES } = require('../config/public_roles');
const { createCallService } = require('../services/call_service');
const { createRoleService } = require('../services/role_service');
const { MemoryCallStore } = require('../stores/memory_call_store');

const TEST_DEVELOPMENT_CODE = '654321';
const PUBLIC_TEST_PHONE = '13800138000';
const FIXED_TIME = '2026-07-25T00:00:00.000Z';
const AUTH_REQUIRED_RESPONSE = {
  error: {
    code: 'AUTH_REQUIRED',
    message: 'Authentication required',
  },
};
const USER_LOGIN_REQUIRED_RESPONSE = {
  error: {
    code: 'USER_LOGIN_REQUIRED',
    message: 'Phone login is required to start a call',
  },
};

function createCall(overrides = {}) {
  return {
    id: 'call-1',
    userId: 'user-1',
    roleSlug: 'yuhuang',
    billingUnitMs: 6000,
    pricePerBillingUnitFen: 10,
    status: 'pending',
    createdAt: FIXED_TIME,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function createPublicErrorResponse(code, message) {
  return {
    error: {
      code,
      message,
    },
  };
}

function assertServiceError(action, expected) {
  assert.throws(action, (error) => {
    assert.equal(error.statusCode, expected.statusCode);
    assert.equal(error.code, expected.code);
    assert.equal(error.publicMessage, expected.publicMessage);
    return true;
  });
}

function listenOnTemporaryPort(server) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.removeListener('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.removeListener('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve();
  }
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

async function startApp(app) {
  const server = http.createServer(app);
  await listenOnTemporaryPort(server);
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return {
    port: address.port,
    server,
  };
}

function requestPath({
  port,
  path,
  method = 'GET',
  headers = {},
  body,
}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
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
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
}

function requestJson(port, path, requestBody, cookiePair) {
  const body = JSON.stringify(requestBody);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (cookiePair) {
    headers.Cookie = cookiePair;
  }
  return requestPath({
    port,
    path,
    method: 'POST',
    headers,
    body,
  });
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Call response was not valid JSON', {
      cause: error,
    });
  }
}

function extractSessionCookie(response) {
  const setCookieHeaders = response.headers['set-cookie'];
  assert.ok(Array.isArray(setCookieHeaders));
  assert.equal(setCookieHeaders.length, 1);
  const cookiePair = setCookieHeaders[0].split(';', 1)[0];
  assert.match(cookiePair, /^companion_session=[A-Za-z0-9_-]+$/);
  return {
    cookiePair,
    rawToken: cookiePair.slice('companion_session='.length),
  };
}

function createTestApp(options = {}) {
  return createApp({
    developmentVerificationCode: TEST_DEVELOPMENT_CODE,
    ...options,
  });
}

function login(port, phone = PUBLIC_TEST_PHONE) {
  return requestJson(port, '/api/auth/login', {
    phone,
    code: TEST_DEVELOPMENT_CODE,
  });
}

function createPendingCall(port, cookiePair, requestBody) {
  return requestJson(
    port,
    '/api/calls',
    requestBody,
    cookiePair
  );
}

test('memory call store validates, isolates, and enforces unique IDs', () => {
  const callStore = new MemoryCallStore();
  const call = createCall();
  callStore.save(call);

  const foundCall = callStore.findById(call.id);
  assert.deepEqual(foundCall, call);
  foundCall.status = 'changed outside store';
  assert.equal(callStore.findById(call.id).status, 'pending');
  assert.equal(callStore.findById('missing-call'), null);

  assert.throws(() => {
    callStore.save(call);
  }, /Call ID already exists/);
  assert.throws(() => {
    callStore.save(createCall({
      id: 'invalid-status',
      status: 'not-pending',
    }));
  }, /status/);
  assert.throws(() => {
    callStore.save(createCall({
      id: 'invalid-started-at',
      startedAt: FIXED_TIME,
    }));
  }, /startedAt/);
  assert.throws(() => {
    callStore.save(createCall({
      id: 'invalid-ended-at',
      endedAt: FIXED_TIME,
    }));
  }, /endedAt/);

  const missingUserId = createCall({ id: 'missing-user-id' });
  delete missingUserId.userId;
  assert.throws(() => {
    callStore.save(missingUserId);
  }, /supported fields|userId/);

  const missingRoleSlug = createCall({ id: 'missing-role-slug' });
  delete missingRoleSlug.roleSlug;
  assert.throws(() => {
    callStore.save(missingRoleSlug);
  }, /supported fields|roleSlug/);
  assert.throws(() => {
    callStore.save(createCall({
      id: 'extra-field',
      metadata: {},
    }));
  }, /supported fields/);
});

test('call service creates and stores a server-owned pending call', () => {
  const callStore = new MemoryCallStore();
  const roleService = createRoleService({ roles: PUBLIC_ROLES });
  const callService = createCallService({
    callStore,
    roleService,
    clock: () => Date.parse(FIXED_TIME),
    idGenerator: () => 'call-fixed-service',
  });

  const publicCall = callService.createPendingCall({
    userId: 'user-real',
    roleSlug: 'yuhuang',
  });
  assert.deepEqual(publicCall, {
    id: 'call-fixed-service',
    role: {
      slug: 'yuhuang',
      displayName: '玉皇大帝',
    },
    status: 'pending',
    createdAt: FIXED_TIME,
    startedAt: null,
    endedAt: null,
  });
  assert.equal(Object.hasOwn(publicCall, 'userId'), false);
  assert.deepEqual(callStore.findById('call-fixed-service'), {
    id: 'call-fixed-service',
    userId: 'user-real',
    roleSlug: 'yuhuang',
    billingUnitMs: 6000,
    pricePerBillingUnitFen: 10,
    status: 'pending',
    createdAt: FIXED_TIME,
    startedAt: null,
    endedAt: null,
  });
});

test('call service snapshots role pricing for every new call', () => {
  const callStore = new MemoryCallStore();

  const originalService = createCallService({
    callStore,
    roleService: createRoleService({ roles: PUBLIC_ROLES }),
    idGenerator: () => 'call-price-old',
    clock: () => Date.parse(FIXED_TIME),
  });

  const publicCall = originalService.createPendingCall({
    userId: 'user-pricing',
    roleSlug: 'yuhuang',
  });

  assert.equal(
    Object.hasOwn(publicCall, 'billingUnitMs'),
    false
  );
  assert.equal(
    Object.hasOwn(publicCall, 'pricePerBillingUnitFen'),
    false
  );

  const oldCall = callStore.findById('call-price-old');
  assert.equal(oldCall.billingUnitMs, 6000);
  assert.equal(oldCall.pricePerBillingUnitFen, 10);

  const repricedRoles = PUBLIC_ROLES.map((role) => ({
    ...role,
    billingUnitMs: role.slug === 'yuhuang'
      ? 3000
      : role.billingUnitMs,
    pricePerBillingUnitFen: role.slug === 'yuhuang'
      ? 7
      : role.pricePerBillingUnitFen,
  }));

  const repricedService = createCallService({
    callStore,
    roleService: createRoleService({ roles: repricedRoles }),
    idGenerator: () => 'call-price-new',
    clock: () => Date.parse(FIXED_TIME),
  });

  repricedService.createPendingCall({
    userId: 'user-pricing',
    roleSlug: 'yuhuang',
  });

  const unchangedOldCall = callStore.findById('call-price-old');
  const newCall = callStore.findById('call-price-new');

  assert.equal(unchangedOldCall.billingUnitMs, 6000);
  assert.equal(unchangedOldCall.pricePerBillingUnitFen, 10);
  assert.equal(newCall.billingUnitMs, 3000);
  assert.equal(newCall.pricePerBillingUnitFen, 7);
});

test('call service enforces exact and available role slugs', () => {
  const roleService = createRoleService({ roles: PUBLIC_ROLES });
  let callNumber = 0;
  const callService = createCallService({
    callStore: new MemoryCallStore(),
    roleService,
    idGenerator: () => {
      callNumber += 1;
      return `call-role-${callNumber}`;
    },
  });
  assert.equal(
    callService.createPendingCall({
      userId: 'user-1',
      roleSlug: 'yuhuang',
    }).role.slug,
    'yuhuang'
  );

  const roleNotFound = {
    statusCode: 404,
    code: 'ROLE_NOT_FOUND',
    publicMessage: 'Requested role was not found',
  };
  for (const roleSlug of ['YUHuang', '玉皇大帝', 'unknown']) {
    assertServiceError(() => {
      callService.createPendingCall({
        userId: 'user-1',
        roleSlug,
      });
    }, roleNotFound);
  }

  const invalidRequest = {
    statusCode: 400,
    code: 'INVALID_CALL_REQUEST',
    publicMessage: 'A valid roleSlug is required',
  };
  for (const roleSlug of [' yuhuang ', null]) {
    assertServiceError(() => {
      callService.createPendingCall({
        userId: 'user-1',
        roleSlug,
      });
    }, invalidRequest);
  }

  const unavailableRoles = PUBLIC_ROLES.map((role) => ({
    ...role,
    available: role.slug === 'tangseng' ? false : role.available,
  }));
  const unavailableService = createCallService({
    callStore: new MemoryCallStore(),
    roleService: createRoleService({ roles: unavailableRoles }),
  });
  assertServiceError(() => {
    unavailableService.createPendingCall({
      userId: 'user-1',
      roleSlug: 'tangseng',
    });
  }, {
    statusCode: 409,
    code: 'ROLE_UNAVAILABLE',
    publicMessage: 'Requested role is currently unavailable',
  });
});

test('POST /api/calls requires a valid session', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const response = await createPendingCall(
      port,
      null,
      { roleSlug: 'yuhuang' }
    );
    assert.equal(response.statusCode, 401);
    assert.deepEqual(parseJson(response.body), AUTH_REQUIRED_RESPONSE);
  } finally {
    await closeServer(server);
  }
});

test('guest sessions cannot create calls', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const guestResponse = await requestPath({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const { cookiePair } = extractSessionCookie(guestResponse);
    const callResponse = await createPendingCall(
      port,
      cookiePair,
      { roleSlug: 'yuhuang' }
    );
    assert.equal(callResponse.statusCode, 403);
    assert.deepEqual(
      parseJson(callResponse.body),
      USER_LOGIN_REQUIRED_RESPONSE
    );
  } finally {
    await closeServer(server);
  }
});

test('phone users create a strict public pending call', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-fixed-1',
    clock: () => Date.parse(FIXED_TIME),
  }));

  try {
    const loginResponse = await login(port);
    const { cookiePair, rawToken } =
      extractSessionCookie(loginResponse);
    const callResponse = await createPendingCall(
      port,
      cookiePair,
      { roleSlug: 'yuhuang' }
    );
    assert.equal(callResponse.statusCode, 201);
    assert.deepEqual(parseJson(callResponse.body), {
      call: {
        id: 'call-fixed-1',
        role: {
          slug: 'yuhuang',
          displayName: '玉皇大帝',
        },
        status: 'pending',
        createdAt: FIXED_TIME,
        startedAt: null,
        endedAt: null,
      },
    });

    const forbiddenValues = [
      'userId',
      PUBLIC_TEST_PHONE,
      'balanceCents',
      'remainingSeconds',
      'billingUnitMs',
      'pricePerBillingUnitFen',
      rawToken,
      'tokenHash',
      'speaker',
      'prompt',
      'doubao',
    ];
    for (const value of forbiddenValues) {
      assert.equal(callResponse.body.includes(value), false);
    }
  } finally {
    await closeServer(server);
  }
});

test('client-supplied call fields cannot override server values', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-server-owned',
    clock: () => Date.parse(FIXED_TIME),
  }));

  try {
    const loginResponse = await login(port);
    const { cookiePair } = extractSessionCookie(loginResponse);
    const callResponse = await createPendingCall(port, cookiePair, {
      roleSlug: 'sunwukong',
      id: 'attacker-call',
      callId: 'attacker-call',
      userId: 'attacker-user',
      status: ['en', 'ded'].join(''),
      createdAt: '2000-01-01T00:00:00.000Z',
      startedAt: '2000-01-01T00:00:00.000Z',
      endedAt: '2000-01-01T00:00:00.000Z',
      billingUnitMs: 1,
      pricePerBillingUnitFen: 999999,
      role: {
        slug: 'unknown',
      },
      balanceCents: 999999999,
    });
    assert.equal(callResponse.statusCode, 201);
    assert.deepEqual(parseJson(callResponse.body), {
      call: {
        id: 'call-server-owned',
        role: {
          slug: 'sunwukong',
          displayName: '孙悟空',
        },
        status: 'pending',
        createdAt: FIXED_TIME,
        startedAt: null,
        endedAt: null,
      },
    });
    for (const attackerValue of [
      'attacker-call',
      'attacker-user',
      '2000-01-01T00:00:00.000Z',
      '999999999',
      'unknown',
    ]) {
      assert.equal(callResponse.body.includes(attackerValue), false);
    }
  } finally {
    await closeServer(server);
  }
});

test('invalid call requests return stable errors without creating calls', async () => {
  let generatedCallCount = 0;
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => {
      generatedCallCount += 1;
      return `call-error-check-${generatedCallCount}`;
    },
  }));

  try {
    const loginResponse = await login(port);
    const { cookiePair } = extractSessionCookie(loginResponse);
    const invalidRequestResponse = createPublicErrorResponse(
      'INVALID_CALL_REQUEST',
      'A valid roleSlug is required'
    );
    const noBodyResponse = await requestPath({
      port,
      path: '/api/calls',
      method: 'POST',
      headers: {
        Cookie: cookiePair,
      },
    });
    assert.equal(noBodyResponse.statusCode, 400);
    assert.deepEqual(
      parseJson(noBodyResponse.body),
      invalidRequestResponse
    );

    for (const requestBody of [
      {},
      [],
      { roleSlug: 123 },
      { roleSlug: '' },
      { roleSlug: ' yuhuang ' },
    ]) {
      const response = await createPendingCall(
        port,
        cookiePair,
        requestBody
      );
      assert.equal(response.statusCode, 400);
      assert.deepEqual(
        parseJson(response.body),
        invalidRequestResponse
      );
    }

    const roleNotFoundResponse = createPublicErrorResponse(
      'ROLE_NOT_FOUND',
      'Requested role was not found'
    );
    for (const roleSlug of ['玉皇大帝', 'unknown']) {
      const response = await createPendingCall(
        port,
        cookiePair,
        { roleSlug }
      );
      assert.equal(response.statusCode, 404);
      assert.deepEqual(
        parseJson(response.body),
        roleNotFoundResponse
      );
    }

    const validResponse = await createPendingCall(
      port,
      cookiePair,
      { roleSlug: 'yuhuang' }
    );
    assert.equal(validResponse.statusCode, 201);
    assert.equal(
      parseJson(validResponse.body).call.id,
      'call-error-check-1'
    );
  } finally {
    await closeServer(server);
  }
});

test('phone users can create calls for all roles without unlock tiers', async () => {
  let generatedCallCount = 0;
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => {
      generatedCallCount += 1;
      return `call-all-role-${generatedCallCount}`;
    },
  }));

  try {
    const loginResponse = await login(port);
    const { cookiePair } = extractSessionCookie(loginResponse);

    for (const role of PUBLIC_ROLES) {
      const response = await createPendingCall(
        port,
        cookiePair,
        { roleSlug: role.slug }
      );
      assert.equal(response.statusCode, 201);

      const responseBody = parseJson(response.body);
      assert.deepEqual(responseBody.call.role, {
        slug: role.slug,
        displayName: role.displayName,
      });
      assert.equal(responseBody.call.status, 'pending');
    }

    assert.equal(generatedCallCount, PUBLIC_ROLES.length);
    assert.equal(generatedCallCount, 8);
  } finally {
    await closeServer(server);
  }
});

test('repeated calls are allowed and application stores are isolated', async () => {
  const appACallIds = ['shared-call-id', 'app-a-call-2'];
  let appACallIndex = 0;
  const appA = await startApp(createTestApp({
    callIdGenerator: () => {
      const callId = appACallIds[appACallIndex];
      appACallIndex += 1;
      return callId;
    },
  }));
  const appB = await startApp(createTestApp({
    callIdGenerator: () => 'shared-call-id',
  }));

  try {
    const loginA = await login(appA.port);
    const cookieA = extractSessionCookie(loginA).cookiePair;
    const firstCall = await createPendingCall(
      appA.port,
      cookieA,
      { roleSlug: 'yuhuang' }
    );
    const secondCall = await createPendingCall(
      appA.port,
      cookieA,
      { roleSlug: 'sunwukong' }
    );
    assert.equal(firstCall.statusCode, 201);
    assert.equal(secondCall.statusCode, 201);
    assert.equal(parseJson(firstCall.body).call.id, 'shared-call-id');
    assert.equal(parseJson(secondCall.body).call.id, 'app-a-call-2');
    assert.equal(parseJson(firstCall.body).call.status, 'pending');
    assert.equal(parseJson(secondCall.body).call.status, 'pending');

    const crossAppResponse = await createPendingCall(
      appB.port,
      cookieA,
      { roleSlug: 'yuhuang' }
    );
    assert.equal(crossAppResponse.statusCode, 401);
    assert.deepEqual(
      parseJson(crossAppResponse.body),
      AUTH_REQUIRED_RESPONSE
    );

    const loginB = await login(appB.port, '13900139000');
    const cookieB = extractSessionCookie(loginB).cookiePair;
    const appBCall = await createPendingCall(
      appB.port,
      cookieB,
      { roleSlug: 'yuhuang' }
    );
    assert.equal(appBCall.statusCode, 201);
    assert.equal(parseJson(appBCall.body).call.id, 'shared-call-id');
  } finally {
    await Promise.all([
      closeServer(appA.server),
      closeServer(appB.server),
    ]);
  }
});
