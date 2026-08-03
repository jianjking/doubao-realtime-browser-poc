'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { isDevRechargeEnabled } = require('../server');
const {
  MAX_DEV_RECHARGE_AMOUNT_CENTS,
  createAccountService,
} = require('../services/account_service');
const {
  MemoryAccountStore,
} = require('../stores/memory_account_store');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

const TEST_INTERNAL_TOKEN =
  'test_dev_recharge_internal_token_1234567890';
const PHONE_A = '13800138000';
const PHONE_B = '13900139000';

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

async function startApp(options = {}) {
  const clock = options.clock || Date.now;
  const server = http.createServer(createApp({
    ...createMockSmsTestOptions({ clock }),
    ...options,
  }));
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
  requestBody,
  cookiePair,
  authorization,
}) {
  const body = JSON.stringify(requestBody);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (cookiePair) {
    headers.Cookie = cookiePair;
  }
  if (authorization) {
    headers.Authorization = authorization;
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
  return JSON.parse(body);
}

function extractSessionCookie(response) {
  const setCookieHeaders = response.headers['set-cookie'];
  assert.ok(Array.isArray(setCookieHeaders));
  assert.equal(setCookieHeaders.length, 1);
  return setCookieHeaders[0].split(';', 1)[0];
}

async function login(port, phone = PHONE_A) {
  const { challengeId } = await requestSmsChallenge(port, phone);
  const response = await requestJson({
    port,
    path: '/api/auth/login',
    requestBody: {
      phone,
      challengeId,
      code: TEST_SMS_CODE,
    },
  });
  assert.equal(response.statusCode, 200);
  return {
    body: parseJson(response.body),
    cookiePair: extractSessionCookie(response),
  };
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

function recharge(port, cookiePair, amountCents) {
  return requestJson({
    port,
    path: '/api/dev/recharge',
    requestBody: { amountCents },
    cookiePair,
  });
}

test('development recharge configuration is default-off and production-hard-off', async () => {
  assert.equal(isDevRechargeEnabled({}), false);
  assert.equal(isDevRechargeEnabled({
    BUSINESS_ENABLE_DEV_RECHARGE: '0',
    NODE_ENV: 'development',
  }), false);
  assert.equal(isDevRechargeEnabled({
    BUSINESS_ENABLE_DEV_RECHARGE: '1',
    NODE_ENV: 'development',
  }), true);
  assert.equal(isDevRechargeEnabled({
    BUSINESS_ENABLE_DEV_RECHARGE: '1',
    NODE_ENV: 'production',
  }), false);
  assert.throws(() => isDevRechargeEnabled(null), /env/);

  for (const enableDevRecharge of [
    undefined,
    isDevRechargeEnabled({
      BUSINESS_ENABLE_DEV_RECHARGE: '1',
      NODE_ENV: 'production',
    }),
  ]) {
    const app = await startApp({
      enableDevRecharge,
      initialBalanceCents: 1250,
    });
    try {
      const { cookiePair } = await login(app.port);
      const response = await recharge(app.port, cookiePair, 1000);
      assert.equal(response.statusCode, 404);
      assert.equal(
        response.body.includes('BUSINESS_ENABLE_DEV_RECHARGE'),
        false
      );
      const account = parseJson(
        (await getMe(app.port, cookiePair)).body
      ).account;
      assert.equal(account.balanceCents, 1250);
    } finally {
      await closeServer(app.server);
    }
  }
});

test('enabled route requires a phone user and never creates a guest account', async () => {
  const app = await startApp({
    enableDevRecharge: true,
    initialBalanceCents: 1250,
  });
  try {
    const anonymousResponse = await recharge(app.port, null, 1000);
    assert.equal(anonymousResponse.statusCode, 401);
    assert.equal(
      parseJson(anonymousResponse.body).error.code,
      'AUTH_REQUIRED'
    );

    const guestResponse = await requestPath({
      port: app.port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const guestCookie = extractSessionCookie(guestResponse);
    const guestRecharge = await recharge(
      app.port,
      guestCookie,
      1000
    );
    assert.equal(guestRecharge.statusCode, 403);
    assert.equal(
      parseJson(guestRecharge.body).error.code,
      'USER_LOGIN_REQUIRED'
    );
    const guestMe = parseJson(
      (await getMe(app.port, guestCookie)).body
    );
    assert.equal(guestMe.account, null);
  } finally {
    await closeServer(app.server);
  }
});

test('enabled route credits minimum and maximum integer cents into the authoritative account', async () => {
  let now = Date.parse('2026-07-28T00:00:00.000Z');
  const app = await startApp({
    enableDevRecharge: true,
    initialBalanceCents: 1250,
    initialRemainingSeconds: 600,
    clock: () => now,
  });
  try {
    const { cookiePair } = await login(app.port);
    now += 1000;
    const minimumResponse = await recharge(app.port, cookiePair, 1);
    assert.equal(minimumResponse.statusCode, 200);
    assert.deepEqual(parseJson(minimumResponse.body), {
      account: {
        currency: 'CNY',
        balanceCents: 1251,
        remainingSeconds: 600,
      },
    });

    now += 1000;
    const maximumResponse = await recharge(
      app.port,
      cookiePair,
      MAX_DEV_RECHARGE_AMOUNT_CENTS
    );
    assert.equal(maximumResponse.statusCode, 200);
    assert.deepEqual(parseJson(maximumResponse.body), {
      account: {
        currency: 'CNY',
        balanceCents: 101251,
        remainingSeconds: 600,
      },
    });
    const meAccount = parseJson(
      (await getMe(app.port, cookiePair)).body
    ).account;
    assert.deepEqual(meAccount, {
      currency: 'CNY',
      balanceCents: 101251,
      remainingSeconds: 600,
    });
  } finally {
    await closeServer(app.server);
  }
});

test('route rejects every invalid amount without changing the balance', async () => {
  const app = await startApp({
    enableDevRecharge: true,
    initialBalanceCents: 1250,
  });
  try {
    const { cookiePair } = await login(app.port);
    for (const requestBody of [
      {},
      { amountCents: 0 },
      { amountCents: -1 },
      { amountCents: 1.5 },
      { amountCents: '1000' },
      { amountCents: null },
      { amountCents: 100001 },
    ]) {
      const response = await requestJson({
        port: app.port,
        path: '/api/dev/recharge',
        requestBody,
        cookiePair,
      });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(parseJson(response.body), {
        error: {
          code: 'INVALID_RECHARGE_AMOUNT',
          message: 'A valid recharge amount is required',
        },
      });
    }

    const malformedResponse = await requestPath({
      port: app.port,
      path: '/api/dev/recharge',
      method: 'POST',
      headers: {
        Cookie: cookiePair,
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    assert.equal(malformedResponse.statusCode, 400);
    assert.equal(
      parseJson(malformedResponse.body).error.code,
      'INVALID_RECHARGE_AMOUNT'
    );
    assert.equal(
      parseJson((await getMe(app.port, cookiePair)).body)
        .account.balanceCents,
      1250
    );
  } finally {
    await closeServer(app.server);
  }
});

test('account service credits through replace, updates time, and rejects missing or overflowing accounts', () => {
  let now = Date.parse('2026-07-28T00:00:00.000Z');
  const accountStore = new MemoryAccountStore();
  let replaceCalls = 0;
  const replaceAccount = accountStore.replace.bind(accountStore);
  accountStore.replace = (account) => {
    replaceCalls += 1;
    return replaceAccount(account);
  };
  const accountService = createAccountService({
    accountStore,
    clock: () => now,
    initialBalanceCents: 1250,
    initialRemainingSeconds: 60,
  });
  const original = accountService.ensureAccountForUser('credit-user');
  now += 1000;
  const credited = accountService.creditBalanceCentsForUser(
    'credit-user',
    1000
  );
  assert.deepEqual(credited, {
    currency: 'CNY',
    balanceCents: 2250,
    remainingSeconds: 60,
  });
  const stored = accountStore.findByUserId('credit-user');
  assert.equal(stored.createdAt, original.createdAt);
  assert.equal(stored.updatedAt, '2026-07-28T00:00:01.000Z');
  assert.equal(stored.status, 'active');
  assert.equal(replaceCalls, 1);

  for (const amountCents of [
    0,
    -1,
    1.5,
    '1',
    null,
    NaN,
    Infinity,
    100001,
  ]) {
    assert.throws(() => {
      accountService.creditBalanceCentsForUser(
        'credit-user',
        amountCents
      );
    }, (error) => (
      error.statusCode === 400
      && error.code === 'INVALID_RECHARGE_AMOUNT'
    ));
  }
  assert.equal(replaceCalls, 1);
  assert.throws(() => {
    accountService.creditBalanceCentsForUser('missing-user', 1);
  }, (error) => (
    error.statusCode === 409
    && error.code === 'ACCOUNT_UNAVAILABLE'
  ));

  const overflowStore = new MemoryAccountStore();
  const overflowService = createAccountService({
    accountStore: overflowStore,
    initialBalanceCents: Number.MAX_SAFE_INTEGER,
  });
  overflowService.ensureAccountForUser('overflow-user');
  assert.throws(() => {
    overflowService.creditBalanceCentsForUser('overflow-user', 1);
  }, (error) => (
    error.statusCode === 400
    && error.code === 'INVALID_RECHARGE_AMOUNT'
  ));
  assert.equal(
    overflowService.getPublicAccountForUser('overflow-user')
      .balanceCents,
    Number.MAX_SAFE_INTEGER
  );
});

test('recharge isolates users and repeated explicit requests each credit once', async () => {
  const app = await startApp({
    enableDevRecharge: true,
    initialBalanceCents: 1250,
  });
  try {
    const userA = await login(app.port, PHONE_A);
    const userB = await login(app.port, PHONE_B);
    assert.notEqual(userA.body.principal.id, userB.body.principal.id);

    assert.equal(
      (await recharge(app.port, userA.cookiePair, 1000)).statusCode,
      200
    );
    assert.equal(
      (await recharge(app.port, userA.cookiePair, 1)).statusCode,
      200
    );
    assert.equal(
      parseJson((await getMe(app.port, userA.cookiePair)).body)
        .account.balanceCents,
      2251
    );
    assert.equal(
      parseJson((await getMe(app.port, userB.cookiePair)).body)
        .account.balanceCents,
      1250
    );
  } finally {
    await closeServer(app.server);
  }
});

test('recharge closes insufficient-balance admission and preserves ended and failed billing rules', async () => {
  let now = Date.parse('2026-07-28T00:00:00.000Z');
  const app = await startApp({
    enableDevRecharge: true,
    initialBalanceCents: 5,
    internalApiToken: TEST_INTERNAL_TOKEN,
    clock: () => now,
  });
  try {
    const { cookiePair } = await login(app.port);
    const rejectedCall = await requestJson({
      port: app.port,
      path: '/api/calls',
      requestBody: { roleSlug: 'yuhuang' },
      cookiePair,
    });
    assert.equal(rejectedCall.statusCode, 409);
    assert.equal(
      parseJson(rejectedCall.body).error.code,
      'INSUFFICIENT_BALANCE'
    );

    const rechargeResponse = await recharge(
      app.port,
      cookiePair,
      100
    );
    assert.equal(rechargeResponse.statusCode, 200);
    assert.equal(
      parseJson(rechargeResponse.body).account.balanceCents,
      105
    );

    const endedCallResponse = await requestJson({
      port: app.port,
      path: '/api/calls',
      requestBody: { roleSlug: 'yuhuang' },
      cookiePair,
    });
    const failedCallResponse = await requestJson({
      port: app.port,
      path: '/api/calls',
      requestBody: { roleSlug: 'yuhuang' },
      cookiePair,
    });
    assert.equal(endedCallResponse.statusCode, 201);
    assert.equal(failedCallResponse.statusCode, 201);
    const endedCallId = parseJson(endedCallResponse.body).call.id;
    const failedCallId = parseJson(failedCallResponse.body).call.id;
    const bearer = `Bearer ${TEST_INTERNAL_TOKEN}`;

    for (const lifecycle of ['connecting', 'active']) {
      const response = await requestJson({
        port: app.port,
        path: `/internal/calls/${endedCallId}/${lifecycle}`,
        requestBody: {},
        authorization: bearer,
      });
      assert.equal(response.statusCode, 200);
    }
    now += 100;
    const endedResponse = await requestJson({
      port: app.port,
      path: `/internal/calls/${endedCallId}/ended`,
      requestBody: {},
      authorization: bearer,
    });
    assert.equal(endedResponse.statusCode, 200);
    assert.equal(
      parseJson((await getMe(app.port, cookiePair)).body)
        .account.balanceCents,
      95
    );

    const repeatedEndedResponse = await requestJson({
      port: app.port,
      path: `/internal/calls/${endedCallId}/ended`,
      requestBody: {},
      authorization: bearer,
    });
    assert.equal(repeatedEndedResponse.statusCode, 200);
    assert.equal(
      parseJson((await getMe(app.port, cookiePair)).body)
        .account.balanceCents,
      95
    );

    const failedResponse = await requestJson({
      port: app.port,
      path: `/internal/calls/${failedCallId}/failed`,
      requestBody: {},
      authorization: bearer,
    });
    assert.equal(failedResponse.statusCode, 200);
    assert.equal(
      parseJson((await getMe(app.port, cookiePair)).body)
        .account.balanceCents,
      95
    );
  } finally {
    await closeServer(app.server);
  }
});
