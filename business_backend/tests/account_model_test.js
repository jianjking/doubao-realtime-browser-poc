'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { createAccountService } = require('../services/account_service');
const {
  MemoryAccountStore,
} = require('../stores/memory_account_store');
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

function createAccount(overrides = {}) {
  return {
    userId: 'user-1',
    currency: 'CNY',
    balanceCents: 1250,
    remainingSeconds: 0,
    status: 'active',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
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
  const cookiePair = setCookieHeaders[0].split(';', 1)[0];
  assert.match(cookiePair, /^companion_session=[A-Za-z0-9_-]+$/);
  return cookiePair;
}

function createTestApp(options = {}) {
  const clock = options.clock || Date.now;
  return createApp({
    ...createMockSmsTestOptions({ clock }),
    ...options,
  });
}

async function login(port, additionalFields = {}) {
  const { challengeId } = await requestSmsChallenge(
    port,
    PUBLIC_TEST_PHONE
  );
  return requestJson(port, '/api/auth/login', {
    phone: PUBLIC_TEST_PHONE,
    challengeId,
    code: TEST_SMS_CODE,
    ...additionalFields,
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

test('memory account store validates records and returns copies', () => {
  const accountStore = new MemoryAccountStore();
  const account = createAccount();
  accountStore.save(account);

  const foundAccount = accountStore.findByUserId(account.userId);
  assert.deepEqual(foundAccount, account);
  foundAccount.balanceCents = 999999;
  assert.equal(
    accountStore.findByUserId(account.userId).balanceCents,
    1250
  );

  assert.throws(() => {
    accountStore.save(account);
  }, /Account already exists for userId/);
  assert.throws(() => {
    accountStore.save(createAccount({
      userId: 'invalid-decimal',
      balanceCents: 12.5,
    }));
  }, /balanceCents/);
  assert.throws(() => {
    accountStore.save(createAccount({
      userId: 'invalid-negative-balance',
      balanceCents: -1,
    }));
  }, /balanceCents/);
  assert.throws(() => {
    accountStore.save(createAccount({
      userId: 'invalid-negative-seconds',
      remainingSeconds: -1,
    }));
  }, /remainingSeconds/);
  assert.throws(() => {
    accountStore.save(createAccount({
      userId: 'invalid-currency',
      currency: 'USD',
    }));
  }, /currency/);
});

test('memory account store safely replaces balances including debt', () => {
  const accountStore = new MemoryAccountStore();
  const account = createAccount();
  accountStore.save(account);

  const debitedAccount = {
    ...account,
    balanceCents: -3,
    updatedAt: '2026-07-25T00:01:00.000Z',
  };
  accountStore.replace(debitedAccount);
  assert.deepEqual(
    accountStore.findByUserId(account.userId),
    debitedAccount
  );

  assert.throws(() => {
    accountStore.replace({
      ...debitedAccount,
      balanceCents: 1.5,
    });
  }, /balanceCents/);
  assert.throws(() => {
    accountStore.replace({
      ...debitedAccount,
      currency: 'USD',
    });
  }, /currency|identity/);
  assert.throws(() => {
    accountStore.replace(createAccount({
      userId: 'missing-user',
    }));
  }, /Account does not exist/);
  assert.deepEqual(
    accountStore.findByUserId(account.userId),
    debitedAccount
  );
});

test('account service creates once and returns only public fields', () => {
  let now = Date.parse('2026-07-25T00:00:00.000Z');
  const accountStore = new MemoryAccountStore();
  const accountService = createAccountService({
    accountStore,
    clock: () => now,
    initialBalanceCents: 888,
    initialRemainingSeconds: 600,
  });

  const firstAccount = accountService.ensureAccountForUser('user-1');
  now += 1000;
  const secondAccount = accountService.ensureAccountForUser('user-1');
  assert.deepEqual(secondAccount, firstAccount);
  assert.equal(
    secondAccount.createdAt,
    '2026-07-25T00:00:00.000Z'
  );
  assert.deepEqual(accountService.getPublicAccountForUser('user-1'), {
    currency: 'CNY',
    balanceCents: 888,
    remainingSeconds: 600,
  });

  assert.throws(() => {
    createAccountService({
      accountStore: new MemoryAccountStore(),
      initialBalanceCents: -1,
    });
  }, /initialBalanceCents/);
  assert.throws(() => {
    createAccountService({
      accountStore: new MemoryAccountStore(),
      initialRemainingSeconds: 1.5,
    });
  }, /initialRemainingSeconds/);
});

test('account service debits integer cents and validates every amount', () => {
  let now = Date.parse('2026-07-25T00:00:00.000Z');
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
    initialBalanceCents: 5,
  });
  accountService.ensureAccountForUser('user-debit');

  const zeroDebit = accountService.debitBalanceCentsForUser(
    'user-debit',
    0
  );
  assert.equal(zeroDebit.balanceCents, 5);
  assert.equal(replaceCalls, 0);

  now = Date.parse('2026-07-25T00:01:00.000Z');
  const debited = accountService.debitBalanceCentsForUser(
    'user-debit',
    8
  );
  assert.deepEqual(debited, {
    currency: 'CNY',
    balanceCents: -3,
    remainingSeconds: 0,
  });
  assert.equal(replaceCalls, 1);
  assert.equal(
    accountStore.findByUserId('user-debit').updatedAt,
    '2026-07-25T00:01:00.000Z'
  );

  for (const invalidAmount of [
    -1,
    1.5,
    NaN,
    Infinity,
    '1',
  ]) {
    assert.throws(() => {
      accountService.debitBalanceCentsForUser(
        'user-debit',
        invalidAmount
      );
    }, /amountCents/);
  }
  assert.equal(
    accountService.getPublicAccountForUser('user-debit').balanceCents,
    -3
  );
  assert.equal(replaceCalls, 1);

  assert.throws(() => {
    accountService.debitBalanceCentsForUser('missing-user', 1);
  }, (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'ACCOUNT_UNAVAILABLE');
    assert.equal(error.publicMessage, 'User account is unavailable');
    return true;
  });
});

test('user /api/me returns server-configured account values', async () => {
  const { port, server } = await startApp(createTestApp({
    initialBalanceCents: 888,
    initialRemainingSeconds: 600,
  }));

  try {
    const loginResponse = await login(port, {
      balanceCents: 999999,
      remainingSeconds: 999999,
      currency: 'USD',
      vip: true,
    });
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(
      Object.hasOwn(parseJson(loginResponse.body), 'account'),
      false
    );

    const meResponse = await getMe(
      port,
      extractSessionCookie(loginResponse)
    );
    const meBody = parseJson(meResponse.body);
    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(meBody.account, {
      currency: 'CNY',
      balanceCents: 888,
      remainingSeconds: 600,
    });
    assert.equal(JSON.stringify(meBody).includes('999999'), false);
    assert.equal(JSON.stringify(meBody).includes('USD'), false);
    assert.equal(JSON.stringify(meBody).includes('vip'), false);
  } finally {
    await closeServer(server);
  }
});

test('repeated phone login reuses the same account', async () => {
  let now = Date.parse('2026-08-03T00:00:00.000Z');
  const { port, server } = await startApp(createTestApp({
    clock: () => now,
    initialBalanceCents: 888,
    initialRemainingSeconds: 600,
  }));

  try {
    const firstLogin = await login(port);
    now += 60001;
    const secondLogin = await login(port);
    const firstBody = parseJson(firstLogin.body);
    const secondBody = parseJson(secondLogin.body);
    assert.equal(firstBody.principal.id, secondBody.principal.id);

    const firstMeResponse = await getMe(
      port,
      extractSessionCookie(firstLogin)
    );
    const secondMeResponse = await getMe(
      port,
      extractSessionCookie(secondLogin)
    );
    assert.equal(firstMeResponse.statusCode, 200);
    assert.equal(secondMeResponse.statusCode, 200);
    const firstMe = parseJson(firstMeResponse.body);
    const secondMe = parseJson(secondMeResponse.body);
    assert.deepEqual(firstMe.account, {
      currency: 'CNY',
      balanceCents: 888,
      remainingSeconds: 600,
    });
    assert.deepEqual(secondMe.account, firstMe.account);
  } finally {
    await closeServer(server);
  }
});

test('applications keep account data isolated', async () => {
  const appA = await startApp(createTestApp({
    initialBalanceCents: 111,
    initialRemainingSeconds: 11,
  }));
  const appB = await startApp(createTestApp({
    initialBalanceCents: 222,
    initialRemainingSeconds: 22,
  }));

  try {
    const loginA = await login(appA.port);
    const cookieA = extractSessionCookie(loginA);
    const crossAppResponse = await getMe(appB.port, cookieA);
    assert.equal(crossAppResponse.statusCode, 401);
    assert.deepEqual(
      parseJson(crossAppResponse.body),
      AUTH_REQUIRED_RESPONSE
    );

    const loginB = await login(appB.port);
    const meA = parseJson((await getMe(appA.port, cookieA)).body);
    const meB = parseJson((await getMe(
      appB.port,
      extractSessionCookie(loginB)
    )).body);
    assert.deepEqual(meA.account, {
      currency: 'CNY',
      balanceCents: 111,
      remainingSeconds: 11,
    });
    assert.deepEqual(meB.account, {
      currency: 'CNY',
      balanceCents: 222,
      remainingSeconds: 22,
    });
  } finally {
    await Promise.all([
      closeServer(appA.server),
      closeServer(appB.server),
    ]);
  }
});

test('guest /api/me still has no account', async () => {
  const { port, server } = await startApp(createTestApp());

  try {
    const guestResponse = await requestPath({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const guestBody = parseJson(guestResponse.body);
    const meResponse = await getMe(
      port,
      extractSessionCookie(guestResponse)
    );
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

test('health endpoint remains unchanged with account model', async () => {
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
