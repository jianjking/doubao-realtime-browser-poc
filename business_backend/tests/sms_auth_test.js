'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const Dypnsapi20170525 = require('@alicloud/dypnsapi20170525');

const { createApp } = require('../app');
const {
  ALIYUN_SMS_SETTINGS,
  parseSmsRuntimeConfig,
} = require('../config/sms');
const {
  createBusinessDatabase,
} = require('../database/business_database');
const {
  AliyunSmsVerificationProvider,
} = require('../sms/aliyun_sms_verification_provider');
const {
  MockSmsVerificationProvider,
} = require('../sms/mock_sms_verification_provider');
const {
  createBusinessStores,
} = require('../stores/business_store_factory');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
} = require('./sms_test_helpers');

const TEST_PHONE = '13800138000';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
    server.listen(0, '127.0.0.1');
  });
}

function close(server) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function request(port, pathname, { body, cookie } = {}) {
  const serializedBody = body === undefined
    ? undefined
    : JSON.stringify(body);
  const headers = { Accept: 'application/json' };
  if (serializedBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(serializedBody);
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  return new Promise((resolve, reject) => {
    const client = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: serializedBody === undefined ? 'GET' : 'POST',
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          body: text === '' ? null : JSON.parse(text),
          headers: response.headers,
          statusCode: response.statusCode,
        });
      });
    });
    client.once('error', reject);
    client.end(serializedBody);
  });
}

async function startTestApp({
  clock = Date.now,
  databasePath = ':memory:',
  exposeCode = true,
  provider,
} = {}) {
  const stores = createBusinessStores({ databasePath, clock });
  const server = http.createServer(createApp({
    businessStores: stores,
    clock,
    ...createMockSmsTestOptions({ clock, exposeCode, provider }),
  }));
  await listen(server);
  return {
    port: server.address().port,
    server,
    stores,
    async dispose() {
      await close(server);
      stores.close();
    },
  };
}

async function sendCode(app, phone = TEST_PHONE) {
  return request(app.port, '/api/auth/sms/send', {
    body: { phone },
  });
}

async function login(
  app,
  challengeId,
  { phone = TEST_PHONE, code = TEST_SMS_CODE } = {}
) {
  return request(app.port, '/api/auth/login', {
    body: { phone, challengeId, code },
  });
}

function cookieFrom(response) {
  const setCookie = response.headers['set-cookie'];
  return Array.isArray(setCookie)
    ? setCookie[0].split(';', 1)[0]
    : null;
}

test('SMS config defaults disabled and fails closed', () => {
  assert.equal(parseSmsRuntimeConfig({}).mode, 'disabled');
  assert.equal(parseSmsRuntimeConfig({}).mockExposeCode, false);
  assert.throws(
    () => parseSmsRuntimeConfig({ SMS_PROVIDER_MODE: 'live' }),
    /SMS_PROVIDER_MODE/
  );
  assert.throws(
    () => parseSmsRuntimeConfig({ SMS_MOCK_EXPOSE_CODE: 'yes' }),
    /SMS_MOCK_EXPOSE_CODE/
  );
  assert.throws(
    () => parseSmsRuntimeConfig({
      NODE_ENV: 'production',
      SMS_PROVIDER_MODE: 'mock',
    }),
    /forbidden in production/
  );
  assert.throws(
    () => parseSmsRuntimeConfig({ SMS_PROVIDER_MODE: 'aliyun' }),
    /ALIBABA_CLOUD_ACCESS_KEY_ID/
  );
  const aliyun = parseSmsRuntimeConfig({
    SMS_PROVIDER_MODE: 'aliyun',
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'test-access-id',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'test-access-secret',
  });
  assert.equal(aliyun.mode, 'aliyun');
  assert.equal(aliyun.aliyun.configured, true);
  assert.equal(aliyun.aliyun.endpoint, 'dypnsapi.aliyuncs.com');
});

test('default disabled HTTP mode never creates a challenge or session', async () => {
  const server = http.createServer(createApp());
  await listen(server);
  const port = server.address().port;
  try {
    const sent = await request(port, '/api/auth/sms/send', {
      body: { phone: TEST_PHONE },
    });
    assert.equal(sent.statusCode, 503);
    assert.equal(sent.body.error.code, 'SMS_DISABLED');
    const loggedIn = await request(port, '/api/auth/login', {
      body: {
        phone: TEST_PHONE,
        challengeId: 'disabled-challenge',
        code: TEST_SMS_CODE,
      },
    });
    assert.equal(loggedIn.statusCode, 503);
    assert.equal(loggedIn.body.error.code, 'SMS_DISABLED');
    assert.equal(cookieFrom(loggedIn), null);
  } finally {
    await close(server);
  }
});

test('Aliyun provider sends exact verification parameters without SchemeName', async () => {
  const requests = [];
  const client = {
    async sendSmsVerifyCode(requestBody) {
      requests.push({ operation: 'send', requestBody });
      return {
        body: {
          code: 'OK',
          success: true,
          requestId: 'provider-request-id',
          model: { bizId: 'provider-biz-id' },
        },
      };
    },
    async checkSmsVerifyCode(requestBody) {
      requests.push({ operation: 'check', requestBody });
      return {
        body: {
          code: 'OK',
          success: true,
          model: { verifyResult: 'PASS' },
        },
      };
    },
  };
  const provider = new AliyunSmsVerificationProvider({
    client,
    settings: {
      ...ALIYUN_SMS_SETTINGS,
      accessKeyId: 'unused-test-id',
      accessKeySecret: 'unused-test-secret',
      configured: true,
    },
  });

  const sent = await provider.send({
    challengeId: 'challenge-aliyun-1',
    phoneNumber: '+8613800138000',
  });
  assert.deepEqual(sent, {
    providerBizId: 'provider-biz-id',
    providerRequestId: 'provider-request-id',
  });
  assert.ok(
    requests[0].requestBody
      instanceof Dypnsapi20170525.SendSmsVerifyCodeRequest
  );
  assert.deepEqual(
    {
      phoneNumber: requests[0].requestBody.phoneNumber,
      signName: requests[0].requestBody.signName,
      templateCode: requests[0].requestBody.templateCode,
      templateParam: requests[0].requestBody.templateParam,
      countryCode: requests[0].requestBody.countryCode,
      codeLength: requests[0].requestBody.codeLength,
      validTime: requests[0].requestBody.validTime,
      duplicatePolicy: requests[0].requestBody.duplicatePolicy,
      codeType: requests[0].requestBody.codeType,
      returnVerifyCode: requests[0].requestBody.returnVerifyCode,
      outId: requests[0].requestBody.outId,
      schemeName: requests[0].requestBody.schemeName,
    },
    {
      phoneNumber: '13800138000',
      signName: '恒创联众',
      templateCode: '100001',
      templateParam: '{"code":"##code##","min":"5"}',
      countryCode: '86',
      codeLength: 6,
      validTime: 300,
      duplicatePolicy: 1,
      codeType: 1,
      returnVerifyCode: false,
      outId: 'challenge-aliyun-1',
      schemeName: undefined,
    }
  );

  const checked = await provider.verify({
    challengeId: 'challenge-aliyun-1',
    phoneNumber: '+8613800138000',
    code: TEST_SMS_CODE,
  });
  assert.equal(checked.passed, true);
  assert.equal(checked.verifyResult, 'PASS');
  assert.deepEqual(
    {
      phoneNumber: requests[1].requestBody.phoneNumber,
      verifyCode: requests[1].requestBody.verifyCode,
      countryCode: requests[1].requestBody.countryCode,
      outId: requests[1].requestBody.outId,
      schemeName: requests[1].requestBody.schemeName,
    },
    {
      phoneNumber: '13800138000',
      verifyCode: TEST_SMS_CODE,
      countryCode: '86',
      outId: 'challenge-aliyun-1',
      schemeName: undefined,
    }
  );
});

test('SMS challenge migration persists no verification code or digest', () => {
  const database = createBusinessDatabase({ databasePath: ':memory:' });
  try {
    const columns = database.connection
      .prepare('PRAGMA table_info(sms_challenges)')
      .all()
      .map((column) => column.name);
    assert.ok(columns.includes('phone_normalized'));
    assert.ok(columns.includes('request_ip_digest'));
    assert.equal(columns.includes('verify_code'), false);
    assert.equal(columns.includes('code_digest'), false);
    assert.equal(columns.includes('code_hash'), false);
  } finally {
    database.close();
  }
});

test('send, login, session, consume, phone binding, and privacy work', async () => {
  const app = await startTestApp({ exposeCode: false });
  try {
    const sent = await sendCode(app);
    assert.equal(sent.statusCode, 201);
    assert.equal(sent.body.expiresInSeconds, 300);
    assert.equal(sent.body.resendAfterSeconds, 60);
    assert.equal(Object.hasOwn(sent.body, 'mockCode'), false);

    const changedPhone = await login(app, sent.body.challengeId, {
      phone: '13900139000',
    });
    assert.equal(changedPhone.statusCode, 401);
    assert.equal(cookieFrom(changedPhone), null);

    const wrong = await login(app, sent.body.challengeId, {
      code: '000000',
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(cookieFrom(wrong), null);

    const success = await login(app, sent.body.challengeId);
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.authMode, 'sms_phone');
    assert.equal(success.body.verification.verifyResult, 'PASS');
    assert.deepEqual(success.body.profile, { phoneMasked: '138****8000' });
    const cookie = cookieFrom(success);
    assert.match(cookie, /^companion_session=[A-Za-z0-9_-]+$/);

    const me = await request(app.port, '/api/me', { cookie });
    assert.equal(me.statusCode, 200);
    assert.equal(me.body.principal.type, 'user');
    assert.deepEqual(me.body.profile, { phoneMasked: '138****8000' });

    const consumed = await login(app, sent.body.challengeId);
    assert.equal(consumed.statusCode, 409);
    assert.equal(consumed.body.error.code, 'SMS_CHALLENGE_CONSUMED');
    assert.equal(cookieFrom(consumed), null);

    const row = app.stores.smsChallengeStore.findById(
      sent.body.challengeId
    );
    assert.equal(row.status, 'consumed');
    assert.equal(Object.hasOwn(row, 'code'), false);
    assert.equal(JSON.stringify(row).includes(TEST_SMS_CODE), false);
  } finally {
    await app.dispose();
  }
});

test('cooldown prevents double send and a new code invalidates the old one', async () => {
  let now = Date.parse('2026-08-03T00:00:00.000Z');
  let sendCount = 0;
  const baseProvider = new MockSmsVerificationProvider({
    clock: () => now,
    codeGenerator: () => TEST_SMS_CODE,
    exposeCode: true,
  });
  const provider = {
    async send(options) {
      sendCount += 1;
      return baseProvider.send(options);
    },
    verify: (options) => baseProvider.verify(options),
  };
  const app = await startTestApp({ clock: () => now, provider });
  try {
    const simultaneous = await Promise.all([
      sendCode(app),
      sendCode(app),
    ]);
    assert.deepEqual(
      simultaneous.map((response) => response.statusCode).sort(),
      [201, 429]
    );
    assert.equal(sendCount, 1);
    const first = simultaneous.find(
      (response) => response.statusCode === 201
    );

    now += 60001;
    const second = await sendCode(app);
    assert.equal(second.statusCode, 201);
    assert.equal(sendCount, 2);
    assert.equal(
      app.stores.smsChallengeStore.findById(first.body.challengeId).status,
      'invalidated'
    );
    const oldLogin = await login(app, first.body.challengeId);
    assert.equal(oldLogin.statusCode, 409);
    assert.equal(oldLogin.body.error.code, 'SMS_CHALLENGE_INVALIDATED');
    assert.equal((await login(app, second.body.challengeId)).statusCode, 200);
  } finally {
    await app.dispose();
  }
});

test('wrong codes lock after five attempts and expiry is enforced locally', async () => {
  let now = Date.parse('2026-08-03T01:00:00.000Z');
  const app = await startTestApp({ clock: () => now });
  try {
    const lockedChallenge = (await sendCode(app)).body.challengeId;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await login(app, lockedChallenge, {
        code: '000000',
      });
      assert.equal(response.statusCode, attempt === 5 ? 423 : 401);
    }
    const correctAfterLock = await login(app, lockedChallenge);
    assert.equal(correctAfterLock.statusCode, 423);
    assert.equal(cookieFrom(correctAfterLock), null);

    now += 60001;
    const expiringChallenge = (await sendCode(
      app,
      '13900139000'
    )).body.challengeId;
    now += 300001;
    const expired = await login(app, expiringChallenge, {
      phone: '13900139000',
    });
    assert.equal(expired.statusCode, 410);
    assert.equal(expired.body.error.code, 'SMS_CHALLENGE_EXPIRED');
  } finally {
    await app.dispose();
  }
});

test('phone hourly, IP hourly, and phone daily limits are enforced', async () => {
  let now = Date.parse('2026-08-03T02:00:00.000Z');
  const phoneHourly = await startTestApp({ clock: () => now });
  try {
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await sendCode(phoneHourly)).statusCode, 201);
      now += 60001;
    }
    const limited = await sendCode(phoneHourly);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.error.code, 'SMS_PHONE_HOURLY_LIMIT');
  } finally {
    await phoneHourly.dispose();
  }

  now = Date.parse('2026-08-03T04:00:00.000Z');
  const ipHourly = await startTestApp({ clock: () => now });
  try {
    for (let index = 0; index < 20; index += 1) {
      const phone = `1380000${String(index).padStart(4, '0')}`;
      assert.equal((await sendCode(ipHourly, phone)).statusCode, 201);
    }
    const limited = await sendCode(ipHourly, '13900009999');
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.error.code, 'SMS_IP_HOURLY_LIMIT');
  } finally {
    await ipHourly.dispose();
  }

  now = Date.parse('2026-08-03T06:00:00.000Z');
  const phoneDaily = await startTestApp({ clock: () => now });
  try {
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await sendCode(phoneDaily)).statusCode, 201);
      now += 3600001;
    }
    const limited = await sendCode(phoneDaily);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.error.code, 'SMS_PHONE_DAILY_LIMIT');
  } finally {
    await phoneDaily.dispose();
  }
});

test('ten concurrent correct logins consume a challenge once', async () => {
  const provider = {
    async send() {
      return {
        providerBizId: 'concurrency-biz',
        providerRequestId: 'concurrency-request',
      };
    },
    async verify() {
      return {
        code: 'OK',
        success: true,
        verifyResult: 'PASS',
      };
    },
  };
  const app = await startTestApp({ provider });
  try {
    const challengeId = (await sendCode(app)).body.challengeId;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => login(app, challengeId))
    );
    assert.equal(
      results.filter((response) => response.statusCode === 200).length,
      1
    );
    assert.equal(
      results.filter((response) => cookieFrom(response) !== null).length,
      1
    );
    assert.equal(
      app.stores.smsChallengeStore.findById(challengeId).status,
      'consumed'
    );
  } finally {
    await app.dispose();
  }
});

test('send failure restores retry and records no usable challenge', async () => {
  let failNext = true;
  const baseProvider = new MockSmsVerificationProvider({
    codeGenerator: () => TEST_SMS_CODE,
    exposeCode: true,
  });
  const provider = {
    async send(options) {
      if (failNext) {
        failNext = false;
        throw new Error('simulated provider failure');
      }
      return baseProvider.send(options);
    },
    verify: (options) => baseProvider.verify(options),
  };
  const app = await startTestApp({ provider });
  try {
    const failed = await sendCode(app);
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.body.error.code, 'SMS_SEND_FAILED');
    const recovered = await sendCode(app);
    assert.equal(recovered.statusCode, 201);
  } finally {
    await app.dispose();
  }
});

test('SQLite challenge state is restored by a separate Node process', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sms-challenge-recovery-')
  );
  const databasePath = path.join(directory, 'business.sqlite3');
  const app = await startTestApp({ databasePath });
  let challengeId;
  try {
    challengeId = (await sendCode(app)).body.challengeId;
  } finally {
    await app.dispose();
  }

  try {
    const worker = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'sms_challenge_recovery_worker.js'),
        databasePath,
        challengeId,
        'sent',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(worker.status, 0, worker.stderr);
    assert.equal(worker.stdout, '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
