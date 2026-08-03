'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { MemoryUserStore } = require('../stores/memory_user_store');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

const PUBLIC_TEST_PHONE = '13800138000';
const AUTH_REQUIRED_RESPONSE = {
  error: {
    code: 'AUTH_REQUIRED',
    message: 'Authentication required',
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

function requestJson(port, path, requestBody) {
  const body = JSON.stringify(requestBody);
  return requestPath({
    port,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Response was not valid JSON', {
      cause: error,
    });
  }
}

function extractSessionCookie(response) {
  const setCookieHeaders = response.headers['set-cookie'];
  assert.ok(Array.isArray(setCookieHeaders));
  assert.equal(setCookieHeaders.length, 1);

  const setCookie = setCookieHeaders[0];
  const cookiePair = setCookie.split(';', 1)[0];
  assert.match(cookiePair, /^companion_session=[A-Za-z0-9_-]+$/);
  return {
    cookiePair,
    rawToken: cookiePair.slice('companion_session='.length),
    setCookie,
  };
}

function createTestApp(options = {}) {
  const clock = options.clock || Date.now;
  return createApp({
    ...createMockSmsTestOptions({ clock }),
    ...options,
  });
}

async function login(
  port,
  phone = PUBLIC_TEST_PHONE,
  additionalFields = {}
) {
  const { challengeId } = await requestSmsChallenge(port, phone);
  return requestJson(port, '/api/auth/login', {
    ...additionalFields,
    phone,
    challengeId,
    code: TEST_SMS_CODE,
  });
}

test('memory user store enforces uniqueness and returns copies', () => {
  const userStore = new MemoryUserStore();
  const user = {
    id: 'user-1',
    phoneE164: '+8613800138000',
    status: 'active',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
  };
  userStore.save(user);

  const foundUser = userStore.findByPhoneE164(user.phoneE164);
  foundUser.status = 'changed-outside-store';
  assert.equal(userStore.findById(user.id).status, 'active');

  assert.throws(() => {
    userStore.save({
      ...user,
      phoneE164: '+8613900139000',
    });
  }, /User ID already exists/);
  assert.throws(() => {
    userStore.save({
      ...user,
      id: 'user-2',
    });
  }, /Phone number already belongs to another user/);
});

test('phone login returns a sanitized user identity and session', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const loginResponse = await login(port, PUBLIC_TEST_PHONE, {
      balanceCents: 999999999,
      remainingSeconds: 999999999,
      currency: 'USD',
      account: {
        balanceCents: 999999999,
      },
      vip: true,
    });
    assert.equal(loginResponse.statusCode, 200);

    const loginBody = parseJson(loginResponse.body);
    assert.equal(loginBody.authMode, 'sms_phone');
    assert.equal(loginBody.principal.type, 'user');
    assert.equal(typeof loginBody.principal.id, 'string');
    assert.notEqual(loginBody.principal.id, '');
    assert.deepEqual(loginBody.profile, {
      phoneMasked: '138****8000',
    });
    assert.equal(
      new Date(loginBody.session.expiresAt).toISOString(),
      loginBody.session.expiresAt
    );

    const { cookiePair, rawToken, setCookie } =
      extractSessionCookie(loginResponse);
    assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
    assert.match(setCookie, /;\s*SameSite=Lax(?:;|$)/i);
    assert.match(setCookie, /;\s*Path=\/(?:;|$)/i);
    assert.match(setCookie, /;\s*Max-Age=86400(?:;|$)/i);
    assert.equal(loginResponse.body.includes(rawToken), false);
    assert.equal(loginResponse.body.includes('tokenHash'), false);
    assert.equal(loginResponse.body.includes('+8613800138000'), false);
    assert.equal(loginResponse.body.includes(TEST_SMS_CODE), false);
    assert.equal(Object.hasOwn(loginBody, 'account'), false);

    const meResponse = await requestPath({
      port,
      path: '/api/me',
      headers: {
        Cookie: cookiePair,
      },
    });
    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(parseJson(meResponse.body), {
      principal: {
        type: 'user',
        id: loginBody.principal.id,
      },
      profile: {
        phoneMasked: '138****8000',
      },
      account: {
        currency: 'CNY',
        balanceCents: 1250,
        remainingSeconds: 0,
      },
      permissions: {
        canRecharge: true,
      },
    });
  } finally {
    await closeServer(server);
  }
});

test('accepted phone formats resolve to the same user', async () => {
  let now = Date.parse('2026-08-03T00:00:00.000Z');
  const { port, server } = await startApp(createTestApp({
    clock: () => now,
  }));
  const acceptedPhones = [
    '13800138000',
    '+8613800138000',
    '138 0013 8000',
    '138-0013-8000',
  ];

  try {
    const userIds = [];
    for (const phone of acceptedPhones) {
      const response = await login(port, phone);
      assert.equal(response.statusCode, 200);
      userIds.push(parseJson(response.body).principal.id);
      now += 60001;
    }
    assert.equal(new Set(userIds).size, 1);
  } finally {
    await closeServer(server);
  }
});

test('repeated logins reuse the user and create distinct sessions', async () => {
  let now = Date.parse('2026-08-03T01:00:00.000Z');
  const { port, server } = await startApp(createTestApp({
    clock: () => now,
  }));

  try {
    const firstResponse = await login(port);
    now += 60001;
    const secondResponse = await login(port);
    const firstBody = parseJson(firstResponse.body);
    const secondBody = parseJson(secondResponse.body);
    const firstCookie = extractSessionCookie(firstResponse).cookiePair;
    const secondCookie = extractSessionCookie(secondResponse).cookiePair;

    assert.equal(firstBody.principal.id, secondBody.principal.id);
    assert.notEqual(firstCookie, secondCookie);

    for (const cookiePair of [firstCookie, secondCookie]) {
      const meResponse = await requestPath({
        port,
        path: '/api/me',
        headers: {
          Cookie: cookiePair,
        },
      });
      assert.equal(meResponse.statusCode, 200);
      assert.equal(
        parseJson(meResponse.body).principal.id,
        firstBody.principal.id
      );
    }
  } finally {
    await closeServer(server);
  }
});

test('invalid phone numbers and request shapes return stable errors', async () => {
  const { port, server } = await startApp(createTestApp());
  const invalidPhones = [
    '',
    '123',
    '12800138000',
    '1380013800',
    '+86138001380000',
    '138****8000',
  ];

  try {
    for (const phone of invalidPhones) {
      const response = await requestJson(port, '/api/auth/login', {
        phone,
        challengeId: 'invalid-phone-challenge',
        code: TEST_SMS_CODE,
      });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(parseJson(response.body), {
        error: {
          code: 'INVALID_PHONE',
          message: 'A valid mobile phone number is required',
        },
      });
    }

    const missingResponse = await requestJson(
      port,
      '/api/auth/login',
      { code: TEST_SMS_CODE }
    );
    assert.equal(missingResponse.statusCode, 400);
    assert.deepEqual(parseJson(missingResponse.body), {
      error: {
        code: 'INVALID_LOGIN_REQUEST',
        message: 'Phone, challengeId, and a six-digit code are required',
      },
    });

    const typeResponse = await requestJson(port, '/api/auth/login', {
      phone: 13800138000,
      code: TEST_SMS_CODE,
    });
    assert.equal(typeResponse.statusCode, 400);
    assert.deepEqual(parseJson(typeResponse.body), {
      error: {
        code: 'INVALID_LOGIN_REQUEST',
        message: 'Phone, challengeId, and a six-digit code are required',
      },
    });
  } finally {
    await closeServer(server);
  }
});

test('an incorrect SMS code is rejected without disclosure', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const { challengeId } = await requestSmsChallenge(
      port,
      PUBLIC_TEST_PHONE
    );
    const response = await requestJson(port, '/api/auth/login', {
      phone: PUBLIC_TEST_PHONE,
      challengeId,
      code: '000000',
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(parseJson(response.body), {
      error: {
        code: 'INVALID_VERIFICATION_CODE',
        message: 'The verification code is incorrect',
      },
    });
    assert.equal(response.body.includes(TEST_SMS_CODE), false);
  } finally {
    await closeServer(server);
  }
});

test('user sessions are isolated between applications', async () => {
  const appA = await startApp(createTestApp());
  const appB = await startApp(createTestApp());

  try {
    const loginResponse = await login(appA.port);
    const { cookiePair } = extractSessionCookie(loginResponse);
    const meResponse = await requestPath({
      port: appB.port,
      path: '/api/me',
      headers: {
        Cookie: cookiePair,
      },
    });
    assert.equal(meResponse.statusCode, 401);
    assert.deepEqual(parseJson(meResponse.body), AUTH_REQUIRED_RESPONSE);
  } finally {
    await Promise.all([
      closeServer(appA.server),
      closeServer(appB.server),
    ]);
  }
});

test('guest authentication behavior remains unchanged', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const guestResponse = await requestPath({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    assert.equal(guestResponse.statusCode, 201);
    const guestBody = parseJson(guestResponse.body);
    const { cookiePair } = extractSessionCookie(guestResponse);

    const meResponse = await requestPath({
      port,
      path: '/api/me',
      headers: {
        Cookie: cookiePair,
      },
    });
    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(parseJson(meResponse.body), {
      principal: {
        type: 'guest',
        id: guestBody.principal.id,
      },
      account: null,
      permissions: {
        canRecharge: false,
      },
    });
  } finally {
    await closeServer(server);
  }
});

test('health endpoint remains unchanged', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const response = await requestPath({
      port,
      path: '/api/health',
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(parseJson(response.body), {
      status: 'ok',
      service: 'business-backend',
    });
  } finally {
    await closeServer(server);
  }
});
