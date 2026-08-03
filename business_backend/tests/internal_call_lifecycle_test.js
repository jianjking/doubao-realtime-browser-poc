'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const {
  createRequireInternalToken,
} = require('../middleware/require_internal_token');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

const TEST_INTERNAL_TOKEN =
  'internal_test_token_0123456789ABCDEF';
const OTHER_INTERNAL_TOKEN =
  'other_internal_token_0123456789ABCDEF';
const TEST_PHONE = '13800138000';
const CREATED_AT = '2026-07-26T00:00:00.000Z';
const ACTIVE_AT = '2026-07-26T00:01:00.000Z';
const ENDED_AT = '2026-07-26T00:02:00.000Z';

const INTERNAL_AUTH_REQUIRED_RESPONSE = {
  error: {
    code: 'INTERNAL_AUTH_REQUIRED',
    message: 'Internal authentication required',
  },
};
const INVALID_CALL_ID_RESPONSE = {
  error: {
    code: 'INVALID_CALL_ID',
    message: 'A valid callId is required',
  },
};
const CALL_NOT_FOUND_RESPONSE = {
  error: {
    code: 'CALL_NOT_FOUND',
    message: 'Requested call was not found',
  },
};
const INVALID_CALL_TRANSITION_RESPONSE = {
  error: {
    code: 'INVALID_CALL_TRANSITION',
    message: 'Call state transition is not allowed',
  },
};

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

function requestJson({
  port,
  path,
  method = 'POST',
  headers = {},
  requestBody,
}) {
  const body = JSON.stringify(requestBody);
  return requestPath({
    port,
    path,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...headers,
    },
    body,
  });
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      'Internal call lifecycle response was not valid JSON',
      { cause: error }
    );
  }
}

function extractSessionCookie(response) {
  const setCookieHeaders = response.headers['set-cookie'];
  assert.ok(Array.isArray(setCookieHeaders));
  assert.equal(setCookieHeaders.length, 1);
  const cookiePair = setCookieHeaders[0].split(';', 1)[0];
  assert.match(cookiePair, /^companion_session=[A-Za-z0-9_-]+$/);
  return cookiePair;
}

function createTestApp(options = {}) {
  const clock = options.clock || Date.now;
  return createApp({
    ...createMockSmsTestOptions({ clock }),
    internalApiToken: TEST_INTERNAL_TOKEN,
    ...options,
  });
}

async function login(port, phone = TEST_PHONE) {
  const { challengeId } = await requestSmsChallenge(port, phone);
  return requestJson({
    port,
    path: '/api/auth/login',
    requestBody: {
      phone,
      challengeId,
      code: TEST_SMS_CODE,
    },
  });
}

function createPendingCall(port, cookiePair, roleSlug = 'yuhuang') {
  return requestJson({
    port,
    path: '/api/calls',
    headers: {
      Cookie: cookiePair,
    },
    requestBody: { roleSlug },
  });
}

function getCall(port, callId, cookiePair) {
  return requestPath({
    port,
    path: `/api/calls/${callId}`,
    headers: {
      Cookie: cookiePair,
    },
  });
}

function getMe(port, cookiePair) {
  return requestPath({
    port,
    path: '/api/me',
    headers: {
      Cookie: cookiePair,
    },
  });
}

function postLifecycle({
  port,
  callId,
  lifecycle,
  token = TEST_INTERNAL_TOKEN,
  query = '',
  headers = {},
  body,
}) {
  const requestHeaders = { ...headers };
  if (token !== null) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    requestHeaders['Content-Length'] = Buffer.byteLength(body);
  }
  return requestPath({
    port,
    path: `/internal/calls/${callId}/${lifecycle}${query}`,
    method: 'POST',
    headers: requestHeaders,
    body,
  });
}

async function loginAndCreateCall(port) {
  const loginResponse = await login(port);
  assert.equal(loginResponse.statusCode, 200);
  const cookiePair = extractSessionCookie(loginResponse);
  const callResponse = await createPendingCall(port, cookiePair);
  assert.equal(callResponse.statusCode, 201);
  return {
    cookiePair,
    call: parseJson(callResponse.body).call,
  };
}

function assertInternalAuthRequired(response) {
  assert.equal(response.statusCode, 401);
  assert.deepEqual(
    parseJson(response.body),
    INTERNAL_AUTH_REQUIRED_RESPONSE
  );
  assert.equal(
    response.headers['www-authenticate'],
    'Bearer realm="business-internal"'
  );
  assert.equal(response.headers['cache-control'], 'no-store');
}

test('internal token configuration accepts only strong base64url values', () => {
  const invalidTokens = [
    undefined,
    null,
    '',
    'a'.repeat(31),
    `${'a'.repeat(31)} `,
    `${'a'.repeat(31)}\n`,
    `${'a'.repeat(31)}+`,
    `${'a'.repeat(31)}/`,
    `${'a'.repeat(31)}=`,
  ];

  for (const token of invalidTokens) {
    assert.throws(() => {
      createRequireInternalToken({ token });
    }, (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(
        error.message,
        'internal API token must be a base64url string '
          + 'of at least 32 characters'
      );
      if (typeof token === 'string' && token !== '') {
        assert.equal(error.message.includes(token), false);
      }
      return true;
    });
  }

  assert.equal(
    typeof createRequireInternalToken({
      token: TEST_INTERNAL_TOKEN,
    }),
    'function'
  );
  assert.throws(() => {
    createApp({ internalApiToken: 'invalid' });
  }, {
    name: 'TypeError',
    message: 'internal API token must be a base64url string '
      + 'of at least 32 characters',
  });
});

test('internal routes are absent when no token is configured', async () => {
  const { port, server } = await startApp(createApp());

  try {
    const internalResponse = await requestPath({
      port,
      path: '/internal/calls/unknown/connecting',
      method: 'POST',
    });
    assert.equal(internalResponse.statusCode, 404);
    assert.notDeepEqual(
      internalResponse.body,
      JSON.stringify(INTERNAL_AUTH_REQUIRED_RESPONSE)
    );

    const healthResponse = await requestPath({
      port,
      path: '/api/health',
    });
    assert.equal(healthResponse.statusCode, 200);
  } finally {
    await closeServer(server);
  }
});

test('missing and invalid credentials return the same 401 first', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-auth-check',
    clock: () => Date.parse(CREATED_AT),
  }));

  try {
    const { cookiePair } = await loginAndCreateCall(port);
    const authorizationValues = [
      null,
      'Basic abc',
      'Bearer',
      'Bearer wrong-token',
      `Bearer ${TEST_INTERNAL_TOKEN}x`,
    ];

    for (const authorization of authorizationValues) {
      const headers = {
        Cookie: cookiePair,
      };
      if (authorization !== null) {
        headers.Authorization = authorization;
      }
      const response = await requestPath({
        port,
        path: '/internal/calls/call-auth-check/connecting',
        method: 'POST',
        headers,
      });
      assertInternalAuthRequired(response);
    }

    const publicResponse = await getCall(
      port,
      'call-auth-check',
      cookiePair
    );
    assert.equal(publicResponse.statusCode, 200);
    assert.equal(parseJson(publicResponse.body).call.status, 'pending');
  } finally {
    await closeServer(server);
  }
});

test('internal authentication precedes JSON parsing and lookup', async () => {
  const malformedBody = '{';
  const { port, server } = await startApp(createTestApp());

  try {
    const response = await requestPath({
      port,
      path: '/internal/calls/nonexistent/connecting',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(malformedBody),
      },
      body: malformedBody,
    });
    assertInternalAuthRequired(response);
    assert.equal(response.body.includes('CALL_NOT_FOUND'), false);
    assert.equal(response.body.includes('INVALID_CALL_REQUEST'), false);
    assert.equal(response.body.includes('<html'), false);
  } finally {
    await closeServer(server);
  }
});

test('only Authorization Bearer can provide the internal token', async () => {
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-token-source',
    clock: () => Date.parse(CREATED_AT),
  }));

  try {
    await loginAndCreateCall(port);
    const body = JSON.stringify({ token: TEST_INTERNAL_TOKEN });
    const attempts = [
      {
        path: '/internal/calls/call-token-source/connecting'
          + `?token=${encodeURIComponent(TEST_INTERNAL_TOKEN)}`,
        headers: {},
      },
      {
        path: '/internal/calls/call-token-source/connecting',
        headers: {
          Cookie: `internal_token=${TEST_INTERNAL_TOKEN}`,
        },
      },
      {
        path: '/internal/calls/call-token-source/connecting',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        body,
      },
      {
        path: '/internal/calls/call-token-source/connecting',
        headers: {
          'X-Internal-Token': TEST_INTERNAL_TOKEN,
        },
      },
      {
        path: '/internal/calls/call-token-source/connecting',
        headers: {
          'X-API-Key': TEST_INTERNAL_TOKEN,
        },
      },
    ];

    for (const attempt of attempts) {
      const response = await requestPath({
        port,
        path: attempt.path,
        method: 'POST',
        headers: attempt.headers,
        body: attempt.body,
      });
      assertInternalAuthRequired(response);
    }

    const authorizedResponse = await postLifecycle({
      port,
      callId: 'call-token-source',
      lifecycle: 'connecting',
    });
    assert.equal(authorizedResponse.statusCode, 200);
    assert.equal(
      parseJson(authorizedResponse.body).call.status,
      'connecting'
    );
  } finally {
    await closeServer(server);
  }
});

test('connecting endpoint ignores every forged target status', async () => {
  const requestBody = JSON.stringify({ status: 'ended' });
  const { port, server } = await startApp(createTestApp({
    callIdGenerator: () => 'call-fixed-connecting',
    clock: () => Date.parse(CREATED_AT),
  }));

  try {
    const { cookiePair } = await loginAndCreateCall(port);
    const response = await postLifecycle({
      port,
      callId: 'call-fixed-connecting',
      lifecycle: 'connecting',
      query: '?status=ended',
      headers: {
        'Content-Type': 'application/json',
        'X-Call-Status': 'ended',
      },
      body: requestBody,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(parseJson(response.body), {
      call: {
        id: 'call-fixed-connecting',
        role: {
          slug: 'yuhuang',
          displayName: '玉皇大帝',
        },
        status: 'connecting',
        createdAt: CREATED_AT,
        startedAt: null,
        endedAt: null,
      },
    });

    const publicResponse = await getCall(
      port,
      'call-fixed-connecting',
      cookiePair
    );
    assert.equal(publicResponse.statusCode, 200);
    assert.deepEqual(
      parseJson(publicResponse.body),
      parseJson(response.body)
    );
    for (const forbiddenValue of [
      'userId',
      TEST_PHONE,
      'balanceCents',
      'remainingSeconds',
      TEST_INTERNAL_TOKEN,
      ['speaker', 'Id'].join(''),
      ['system', 'Prompt'].join(''),
      ['api', 'Key'].join(''),
    ]) {
      assert.equal(response.body.includes(forbiddenValue), false);
    }
  } finally {
    await closeServer(server);
  }
});

test('active endpoint rejects skips and preserves idempotent time', async () => {
  let now = Date.parse(CREATED_AT);
  let clockCalls = 0;
  const callIds = ['call-active-skip', 'call-active-valid'];
  const { port, server } = await startApp(createTestApp({
    clock: () => {
      clockCalls += 1;
      return now;
    },
    callIdGenerator: () => callIds.shift(),
  }));

  try {
    const loginResponse = await login(port);
    const cookiePair = extractSessionCookie(loginResponse);
    await createPendingCall(port, cookiePair);
    await createPendingCall(port, cookiePair);

    const skippedResponse = await postLifecycle({
      port,
      callId: 'call-active-skip',
      lifecycle: 'active',
    });
    assert.equal(skippedResponse.statusCode, 409);
    assert.deepEqual(
      parseJson(skippedResponse.body),
      INVALID_CALL_TRANSITION_RESPONSE
    );
    assert.equal(
      parseJson(
        (await getCall(port, 'call-active-skip', cookiePair)).body
      ).call.status,
      'pending'
    );

    const connectingResponse = await postLifecycle({
      port,
      callId: 'call-active-valid',
      lifecycle: 'connecting',
    });
    assert.equal(connectingResponse.statusCode, 200);

    now = Date.parse(ACTIVE_AT);
    const beforeActiveClockCalls = clockCalls;
    const activeResponse = await postLifecycle({
      port,
      callId: 'call-active-valid',
      lifecycle: 'active',
    });
    assert.equal(activeResponse.statusCode, 200);
    assert.equal(clockCalls, beforeActiveClockCalls + 1);
    assert.equal(
      parseJson(activeResponse.body).call.startedAt,
      ACTIVE_AT
    );
    assert.equal(parseJson(activeResponse.body).call.endedAt, null);

    const beforeRepeatClockCalls = clockCalls;
    const repeatedResponse = await postLifecycle({
      port,
      callId: 'call-active-valid',
      lifecycle: 'active',
    });
    assert.equal(repeatedResponse.statusCode, 200);
    assert.deepEqual(
      parseJson(repeatedResponse.body),
      parseJson(activeResponse.body)
    );
    assert.equal(clockCalls, beforeRepeatClockCalls);
  } finally {
    await closeServer(server);
  }
});

test('ended endpoint preserves start time and is idempotent', async () => {
  let now = Date.parse(CREATED_AT);
  let clockCalls = 0;
  const { port, server } = await startApp(createTestApp({
    clock: () => {
      clockCalls += 1;
      return now;
    },
    callIdGenerator: () => 'call-ended',
  }));

  try {
    const { cookiePair } = await loginAndCreateCall(port);
    const initialAccount = parseJson(
      (await getMe(port, cookiePair)).body
    ).account;
    assert.equal(initialAccount.balanceCents, 1250);
    await postLifecycle({
      port,
      callId: 'call-ended',
      lifecycle: 'connecting',
    });

    now = Date.parse(ACTIVE_AT);
    const activeResponse = await postLifecycle({
      port,
      callId: 'call-ended',
      lifecycle: 'active',
    });
    assert.equal(activeResponse.statusCode, 200);
    const startedAt = parseJson(activeResponse.body).call.startedAt;

    now = Date.parse(ENDED_AT);
    const beforeEndedClockCalls = clockCalls;
    const endedResponse = await postLifecycle({
      port,
      callId: 'call-ended',
      lifecycle: 'ended',
    });
    assert.equal(endedResponse.statusCode, 200);
    assert.equal(clockCalls, beforeEndedClockCalls + 2);
    assert.equal(parseJson(endedResponse.body).call.startedAt, startedAt);
    assert.equal(parseJson(endedResponse.body).call.endedAt, ENDED_AT);
    const endedAccount = parseJson(
      (await getMe(port, cookiePair)).body
    ).account;
    assert.equal(endedAccount.balanceCents, 1150);

    const beforeRepeatClockCalls = clockCalls;
    const repeatedResponse = await postLifecycle({
      port,
      callId: 'call-ended',
      lifecycle: 'ended',
    });
    assert.equal(repeatedResponse.statusCode, 200);
    assert.deepEqual(
      parseJson(repeatedResponse.body),
      parseJson(endedResponse.body)
    );
    assert.equal(clockCalls, beforeRepeatClockCalls);
    const repeatedAccount = parseJson(
      (await getMe(port, cookiePair)).body
    ).account;
    assert.equal(repeatedAccount.balanceCents, 1150);

    const publicResponse = await getCall(
      port,
      'call-ended',
      cookiePair
    );
    assert.equal(publicResponse.statusCode, 200);
    assert.deepEqual(
      parseJson(publicResponse.body),
      parseJson(endedResponse.body)
    );
  } finally {
    await closeServer(server);
  }
});

test('failed endpoint supports three sources and rejects ended calls', async () => {
  let now = Date.parse(CREATED_AT);
  let clockCalls = 0;
  const callIds = [
    'call-failed-pending',
    'call-failed-connecting',
    'call-failed-active',
    'call-failed-ended',
  ];
  const { port, server } = await startApp(createTestApp({
    clock: () => {
      clockCalls += 1;
      return now;
    },
    callIdGenerator: () => callIds.shift(),
  }));

  try {
    const loginResponse = await login(port);
    const cookiePair = extractSessionCookie(loginResponse);
    for (let index = 0; index < 4; index += 1) {
      const createResponse = await createPendingCall(port, cookiePair);
      assert.equal(createResponse.statusCode, 201);
    }

    now = Date.parse('2026-07-26T01:00:00.000Z');
    const pendingFailed = await postLifecycle({
      port,
      callId: 'call-failed-pending',
      lifecycle: 'failed',
    });
    assert.equal(pendingFailed.statusCode, 200);
    assert.equal(parseJson(pendingFailed.body).call.startedAt, null);
    assert.equal(
      parseJson(pendingFailed.body).call.endedAt,
      '2026-07-26T01:00:00.000Z'
    );
    const beforeRepeatClockCalls = clockCalls;
    const repeatedFailed = await postLifecycle({
      port,
      callId: 'call-failed-pending',
      lifecycle: 'failed',
    });
    assert.deepEqual(
      parseJson(repeatedFailed.body),
      parseJson(pendingFailed.body)
    );
    assert.equal(clockCalls, beforeRepeatClockCalls);

    await postLifecycle({
      port,
      callId: 'call-failed-connecting',
      lifecycle: 'connecting',
    });
    now = Date.parse('2026-07-26T02:00:00.000Z');
    const connectingFailed = await postLifecycle({
      port,
      callId: 'call-failed-connecting',
      lifecycle: 'failed',
    });
    assert.equal(connectingFailed.statusCode, 200);
    assert.equal(parseJson(connectingFailed.body).call.startedAt, null);
    assert.equal(
      parseJson(connectingFailed.body).call.endedAt,
      '2026-07-26T02:00:00.000Z'
    );

    await postLifecycle({
      port,
      callId: 'call-failed-active',
      lifecycle: 'connecting',
    });
    now = Date.parse('2026-07-26T03:00:00.000Z');
    const activeResponse = await postLifecycle({
      port,
      callId: 'call-failed-active',
      lifecycle: 'active',
    });
    const activeStartedAt = parseJson(activeResponse.body).call.startedAt;
    now = Date.parse('2026-07-26T03:01:00.000Z');
    const activeFailed = await postLifecycle({
      port,
      callId: 'call-failed-active',
      lifecycle: 'failed',
    });
    assert.equal(activeFailed.statusCode, 200);
    assert.equal(
      parseJson(activeFailed.body).call.startedAt,
      activeStartedAt
    );
    assert.equal(
      parseJson(activeFailed.body).call.endedAt,
      '2026-07-26T03:01:00.000Z'
    );

    await postLifecycle({
      port,
      callId: 'call-failed-ended',
      lifecycle: 'connecting',
    });
    now = Date.parse('2026-07-26T04:00:00.000Z');
    await postLifecycle({
      port,
      callId: 'call-failed-ended',
      lifecycle: 'active',
    });
    now = Date.parse('2026-07-26T04:01:00.000Z');
    const endedResponse = await postLifecycle({
      port,
      callId: 'call-failed-ended',
      lifecycle: 'ended',
    });
    const beforeInvalidClockCalls = clockCalls;
    const invalidResponse = await postLifecycle({
      port,
      callId: 'call-failed-ended',
      lifecycle: 'failed',
    });
    assert.equal(invalidResponse.statusCode, 409);
    assert.deepEqual(
      parseJson(invalidResponse.body),
      INVALID_CALL_TRANSITION_RESPONSE
    );
    assert.equal(clockCalls, beforeInvalidClockCalls);
    assert.deepEqual(
      parseJson(
        (await getCall(port, 'call-failed-ended', cookiePair)).body
      ),
      parseJson(endedResponse.body)
    );
  } finally {
    await closeServer(server);
  }
});

test('call IDs, tokens, and call stores stay isolated by app', async () => {
  const appA = await startApp(createTestApp({
    internalApiToken: TEST_INTERNAL_TOKEN,
    callIdGenerator: () => 'call-only-in-app-a',
    clock: () => Date.parse(CREATED_AT),
  }));
  const appB = await startApp(createTestApp({
    internalApiToken: OTHER_INTERNAL_TOKEN,
    clock: () => Date.parse(CREATED_AT),
  }));

  try {
    await loginAndCreateCall(appA.port);

    const missingResponse = await postLifecycle({
      port: appA.port,
      callId: 'missing-call',
      lifecycle: 'connecting',
      token: TEST_INTERNAL_TOKEN,
    });
    assert.equal(missingResponse.statusCode, 404);
    assert.deepEqual(
      parseJson(missingResponse.body),
      CALL_NOT_FOUND_RESPONSE
    );

    for (const invalidCallId of [
      '%20',
      '%20call-only-in-app-a%20',
    ]) {
      const response = await postLifecycle({
        port: appA.port,
        callId: invalidCallId,
        lifecycle: 'connecting',
        token: TEST_INTERNAL_TOKEN,
      });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(
        parseJson(response.body),
        INVALID_CALL_ID_RESPONSE
      );
    }

    const wrongAppTokenResponse = await postLifecycle({
      port: appB.port,
      callId: 'call-only-in-app-a',
      lifecycle: 'connecting',
      token: TEST_INTERNAL_TOKEN,
    });
    assertInternalAuthRequired(wrongAppTokenResponse);

    const isolatedStoreResponse = await postLifecycle({
      port: appB.port,
      callId: 'call-only-in-app-a',
      lifecycle: 'connecting',
      token: OTHER_INTERNAL_TOKEN,
    });
    assert.equal(isolatedStoreResponse.statusCode, 404);
    assert.deepEqual(
      parseJson(isolatedStoreResponse.body),
      CALL_NOT_FOUND_RESPONSE
    );

    const appAResponse = await postLifecycle({
      port: appA.port,
      callId: 'call-only-in-app-a',
      lifecycle: 'connecting',
      token: TEST_INTERNAL_TOKEN,
    });
    assert.equal(appAResponse.statusCode, 200);
    assert.equal(
      parseJson(appAResponse.body).call.status,
      'connecting'
    );
  } finally {
    await Promise.all([
      closeServer(appA.server),
      closeServer(appB.server),
    ]);
  }
});
