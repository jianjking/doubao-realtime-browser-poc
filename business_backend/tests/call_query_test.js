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
const OWNER_PHONE = '13800138000';
const OTHER_PHONE = '13900139000';
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
    message: 'Phone login is required to access a call',
  },
};
const CALL_NOT_FOUND_RESPONSE = {
  error: {
    code: 'CALL_NOT_FOUND',
    message: 'Requested call was not found',
  },
};
const INVALID_CALL_ID_RESPONSE = {
  error: {
    code: 'INVALID_CALL_ID',
    message: 'A valid callId is required',
  },
};

function createCall(overrides = {}) {
  return {
    id: 'call-query-1',
    userId: 'user-owner',
    roleSlug: 'yuhuang',
    status: 'pending',
    createdAt: FIXED_TIME,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function readPublicError(error) {
  return {
    statusCode: error.statusCode,
    code: error.code,
    publicMessage: error.publicMessage,
  };
}

function assertPublicError(action, expected) {
  assert.throws(action, (error) => {
    assert.deepEqual(readPublicError(error), expected);
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
    throw new Error('Call query response was not valid JSON', {
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

function login(port, phone = OWNER_PHONE) {
  return requestJson(port, '/api/auth/login', {
    phone,
    code: TEST_DEVELOPMENT_CODE,
  });
}

function createPendingCall(port, cookiePair, roleSlug = 'yuhuang') {
  return requestJson(
    port,
    '/api/calls',
    { roleSlug },
    cookiePair
  );
}

function getCall(port, callId, cookiePair, headers = {}) {
  return requestPath({
    port,
    path: `/api/calls/${callId}`,
    headers: {
      ...headers,
      ...(cookiePair ? { Cookie: cookiePair } : {}),
    },
  });
}

test('call service returns the owner public call without mutating storage', () => {
  const callStore = new MemoryCallStore();
  const roleService = createRoleService({ roles: PUBLIC_ROLES });
  const callService = createCallService({
    callStore,
    roleService,
    clock: () => Date.parse(FIXED_TIME),
    idGenerator: () => 'call-query-service',
  });
  const createdCall = callService.createPendingCall({
    userId: 'user-owner',
    roleSlug: 'yuhuang',
  });

  const firstResult = callService.getPublicCallForUser({
    userId: 'user-owner',
    callId: createdCall.id,
  });
  const secondResult = callService.getPublicCallForUser({
    userId: 'user-owner',
    callId: createdCall.id,
  });
  assert.deepEqual(firstResult, createdCall);
  assert.deepEqual(secondResult, createdCall);
  assert.equal(Object.hasOwn(firstResult, 'userId'), false);

  firstResult.status = 'changed outside service';
  firstResult.role.displayName = 'changed outside service';
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-owner',
    callId: createdCall.id,
  }), createdCall);
  assert.deepEqual(callStore.findById(createdCall.id), createCall({
    id: 'call-query-service',
  }));

  const unavailableRoles = PUBLIC_ROLES.map((role) => ({
    ...role,
    available: role.slug === 'yuhuang' ? false : role.available,
  }));
  const unavailableCallStore = new MemoryCallStore();
  unavailableCallStore.save(createCall({
    id: 'call-unavailable-role',
  }));
  const unavailableCallService = createCallService({
    callStore: unavailableCallStore,
    roleService: createRoleService({ roles: unavailableRoles }),
  });
  assert.equal(
    unavailableCallService.getPublicCallForUser({
      userId: 'user-owner',
      callId: 'call-unavailable-role',
    }).role.slug,
    'yuhuang'
  );
});

test('missing and non-owner calls return identical not-found errors', () => {
  const callStore = new MemoryCallStore();
  callStore.save(createCall());
  const callService = createCallService({
    callStore,
    roleService: createRoleService({ roles: PUBLIC_ROLES }),
  });
  const expectedError = {
    statusCode: 404,
    code: 'CALL_NOT_FOUND',
    publicMessage: 'Requested call was not found',
  };

  assertPublicError(() => {
    callService.getPublicCallForUser({
      userId: 'user-owner',
      callId: 'missing-call',
    });
  }, expectedError);
  assertPublicError(() => {
    callService.getPublicCallForUser({
      userId: 'user-other',
      callId: 'call-query-1',
    });
  }, expectedError);

  const inconsistentStore = new MemoryCallStore();
  inconsistentStore.save(createCall({
    id: 'call-unknown-role',
    roleSlug: 'removed-role',
  }));
  const inconsistentService = createCallService({
    callStore: inconsistentStore,
    roleService: createRoleService({ roles: PUBLIC_ROLES }),
  });
  assert.throws(() => {
    inconsistentService.getPublicCallForUser({
      userId: 'user-owner',
      callId: 'call-unknown-role',
    });
  }, (error) => {
    assert.equal(
      error.message,
      'Stored call references an unknown role'
    );
    assert.equal(Object.hasOwn(error, 'code'), false);
    return true;
  });
});

test('call query validates call IDs and trusted internal user IDs', () => {
  const callStore = new MemoryCallStore();
  const callService = createCallService({
    callStore,
    roleService: createRoleService({ roles: PUBLIC_ROLES }),
  });
  const invalidCallIdError = {
    statusCode: 400,
    code: 'INVALID_CALL_ID',
    publicMessage: 'A valid callId is required',
  };

  for (const callId of [null, '', '   ', ' call-1', 'call-1 ']) {
    assertPublicError(() => {
      callService.getPublicCallForUser({
        userId: 'user-owner',
        callId,
      });
    }, invalidCallIdError);
  }

  for (const userId of [null, '']) {
    assert.throws(() => {
      callService.getPublicCallForUser({
        userId,
        callId: 'call-1',
      });
    }, {
      name: 'TypeError',
      message: 'userId must be a non-empty string',
    });
    assert.throws(() => {
      callService.createPendingCall({
        userId,
        roleSlug: 'yuhuang',
      });
    }, {
      name: 'TypeError',
      message: 'userId must be a non-empty string',
    });
  }
});

test('GET /api/calls/:callId authenticates before looking up calls', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const response = await getCall(
      port,
      'unknown-call',
      null
    );
    assert.equal(response.statusCode, 401);
    assert.deepEqual(parseJson(response.body), AUTH_REQUIRED_RESPONSE);
  } finally {
    await closeServer(server);
  }
});

test('guest sessions cannot access calls', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const guestResponse = await requestPath({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const { cookiePair } = extractSessionCookie(guestResponse);
    const response = await getCall(
      port,
      'unknown-call',
      cookiePair
    );
    assert.equal(response.statusCode, 403);
    assert.deepEqual(
      parseJson(response.body),
      USER_LOGIN_REQUIRED_RESPONSE
    );
  } finally {
    await closeServer(server);
  }
});

test('call owners can query their strict public pending call', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-query-owned',
    clock: () => Date.parse(FIXED_TIME),
  }));

  try {
    const loginResponse = await login(port);
    const { cookiePair, rawToken } =
      extractSessionCookie(loginResponse);
    const createResponse = await createPendingCall(port, cookiePair);
    assert.equal(createResponse.statusCode, 201);

    const queryResponse = await getCall(
      port,
      'call-query-owned',
      cookiePair
    );
    assert.equal(queryResponse.statusCode, 200);
    assert.deepEqual(parseJson(queryResponse.body), {
      call: {
        id: 'call-query-owned',
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
    assert.deepEqual(
      parseJson(queryResponse.body),
      parseJson(createResponse.body)
    );

    for (const forbiddenValue of [
      'userId',
      OWNER_PHONE,
      'balanceCents',
      'remainingSeconds',
      rawToken,
      'tokenHash',
      'speaker',
      'prompt',
      'doubao',
    ]) {
      assert.equal(queryResponse.body.includes(forbiddenValue), false);
    }

    for (const encodedCallId of [
      '%20',
      '%20call-query-owned%20',
    ]) {
      const invalidResponse = await getCall(
        port,
        encodedCallId,
        cookiePair
      );
      assert.equal(invalidResponse.statusCode, 400);
      assert.deepEqual(
        parseJson(invalidResponse.body),
        INVALID_CALL_ID_RESPONSE
      );
    }
  } finally {
    await closeServer(server);
  }
});

test('other phone users cannot distinguish owned and missing calls', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-owned-by-a',
  }));

  try {
    const loginAResponse = await login(port, OWNER_PHONE);
    const cookieA = extractSessionCookie(loginAResponse).cookiePair;
    const createResponse = await createPendingCall(port, cookieA);
    assert.equal(createResponse.statusCode, 201);

    const loginBResponse = await login(port, OTHER_PHONE);
    const cookieB = extractSessionCookie(loginBResponse).cookiePair;
    const foreignResponse = await getCall(
      port,
      'call-owned-by-a',
      cookieB
    );
    const missingResponse = await getCall(
      port,
      'missing-call',
      cookieB
    );
    assert.equal(foreignResponse.statusCode, 404);
    assert.equal(missingResponse.statusCode, 404);
    assert.deepEqual(
      parseJson(foreignResponse.body),
      CALL_NOT_FOUND_RESPONSE
    );
    assert.deepEqual(
      parseJson(missingResponse.body),
      CALL_NOT_FOUND_RESPONSE
    );
    assert.deepEqual(
      parseJson(foreignResponse.body),
      parseJson(missingResponse.body)
    );

    const ownerResponse = await getCall(
      port,
      'call-owned-by-a',
      cookieA
    );
    assert.equal(ownerResponse.statusCode, 200);
  } finally {
    await closeServer(server);
  }
});

test('query parameters and forged identity headers do not affect ownership', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-forgery-check',
  }));

  try {
    const loginAResponse = await login(port, OWNER_PHONE);
    const loginABody = parseJson(loginAResponse.body);
    const cookieA = extractSessionCookie(loginAResponse).cookiePair;
    const createResponse = await createPendingCall(port, cookieA);
    assert.equal(createResponse.statusCode, 201);

    const baselineResponse = await getCall(
      port,
      'call-forgery-check',
      cookieA
    );
    const forgedResponse = await getCall(
      port,
      'call-forgery-check'
        + '?userId=attacker&status=ended&roleSlug=unknown',
      cookieA,
      {
        'X-User-Id': 'attacker',
        'X-Call-Owner': 'attacker',
        Authorization: 'Bearer forged',
      }
    );
    assert.equal(baselineResponse.statusCode, 200);
    assert.equal(forgedResponse.statusCode, 200);
    assert.deepEqual(
      parseJson(forgedResponse.body),
      parseJson(baselineResponse.body)
    );
    assert.equal(forgedResponse.body.includes('attacker'), false);
    assert.equal(forgedResponse.body.includes('"unknown"'), false);
    assert.equal(
      forgedResponse.body.includes('"status":"ended"'),
      false
    );

    const loginBResponse = await login(port, OTHER_PHONE);
    const cookieB = extractSessionCookie(loginBResponse).cookiePair;
    const foreignResponse = await getCall(
      port,
      'call-forgery-check'
        + `?userId=${encodeURIComponent(loginABody.principal.id)}`,
      cookieB,
      {
        'X-User-Id': loginABody.principal.id,
        'X-Call-Owner': loginABody.principal.id,
        Authorization: 'Bearer forged',
      }
    );
    assert.equal(foreignResponse.statusCode, 404);
    assert.deepEqual(
      parseJson(foreignResponse.body),
      CALL_NOT_FOUND_RESPONSE
    );
  } finally {
    await closeServer(server);
  }
});

test('repeated queries create no calls and application stores are isolated', async () => {
  let generatedCallCount = 0;
  const appA = await startApp(createTestApp({
    callIdGenerator: () => {
      generatedCallCount += 1;
      return 'call-only-in-app-a';
    },
  }));
  const appB = await startApp(createTestApp());

  try {
    const loginAResponse = await login(appA.port, OWNER_PHONE);
    const cookieA = extractSessionCookie(loginAResponse).cookiePair;
    const createResponse = await createPendingCall(
      appA.port,
      cookieA
    );
    assert.equal(createResponse.statusCode, 201);
    assert.equal(generatedCallCount, 1);

    const firstQuery = await getCall(
      appA.port,
      'call-only-in-app-a',
      cookieA
    );
    const secondQuery = await getCall(
      appA.port,
      'call-only-in-app-a',
      cookieA
    );
    assert.equal(firstQuery.statusCode, 200);
    assert.equal(secondQuery.statusCode, 200);
    assert.deepEqual(
      parseJson(firstQuery.body),
      parseJson(secondQuery.body)
    );
    assert.equal(generatedCallCount, 1);

    const loginBResponse = await login(appB.port, OTHER_PHONE);
    const cookieB = extractSessionCookie(loginBResponse).cookiePair;
    const appBResponse = await getCall(
      appB.port,
      'call-only-in-app-a',
      cookieB
    );
    assert.equal(appBResponse.statusCode, 404);
    assert.deepEqual(
      parseJson(appBResponse.body),
      CALL_NOT_FOUND_RESPONSE
    );
  } finally {
    await Promise.all([
      closeServer(appA.server),
      closeServer(appB.server),
    ]);
  }
});
