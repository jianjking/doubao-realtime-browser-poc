'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const {
  normalizeTrustedClientIp,
} = require('../routes/payment_routes');
const {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
} = require('./sms_test_helpers');

function request(port, {
  path,
  method = 'GET',
  headers = {},
  body,
}) {
  const payload = body === undefined
    ? null
    : Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...headers,
        ...(payload === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        }),
      },
    }, (response) => {
      response.setEncoding('utf8');
      let responseBody = '';
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => resolve({
        body: responseBody === '' ? null : JSON.parse(responseBody),
        headers: response.headers,
        statusCode: response.statusCode,
      }));
    });
    outgoing.on('error', reject);
    if (payload !== null) {
      outgoing.write(payload);
    }
    outgoing.end();
  });
}

async function startApp(nodeEnv) {
  const app = createApp({
    ...createMockSmsTestOptions(),
    nodeEnv,
  });
  app.get('/__test/request-info', (request, response) => {
    response.json({
      ip: request.ip,
      ips: request.ips,
      protocol: request.protocol,
      secure: request.secure,
    });
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    app,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function extractCookie(response) {
  const values = response.headers['set-cookie'];
  assert.ok(Array.isArray(values));
  assert.equal(values.length, 1);
  return {
    pair: values[0].split(';', 1)[0],
    raw: values[0],
  };
}

test('production trusts only loopback proxies and restores secure sessions', async () => {
  const harness = await startApp('production');
  const trustProxy = harness.app.get('trust proxy fn');
  assert.equal(harness.app.get('trust proxy'), 'loopback');
  assert.equal(typeof trustProxy, 'function');
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(trustProxy(address, 0), true);
  }
  for (const address of ['198.51.100.10', '203.0.113.8', '2001:db8::1']) {
    assert.equal(trustProxy(address, 0), false);
  }

  const forwardedHeaders = {
    'X-Forwarded-For': '198.51.100.10, 203.0.113.8',
    'X-Forwarded-Proto': 'https',
  };
  try {
    const requestInfo = await request(harness.port, {
      path: '/__test/request-info',
      headers: forwardedHeaders,
    });
    assert.equal(requestInfo.statusCode, 200);
    assert.deepEqual(requestInfo.body, {
      ip: '203.0.113.8',
      ips: ['203.0.113.8'],
      protocol: 'https',
      secure: true,
    });

    const { challengeId } = await requestSmsChallenge(
      harness.port,
      '13800138000'
    );
    const login = await request(harness.port, {
      path: '/api/auth/login',
      method: 'POST',
      headers: forwardedHeaders,
      body: {
        phone: '13800138000',
        challengeId,
        code: TEST_SMS_CODE,
      },
    });
    assert.equal(login.statusCode, 200);
    const cookie = extractCookie(login);
    assert.match(cookie.raw, /;\s*Secure(?:;|$)/i);
    assert.match(cookie.raw, /;\s*HttpOnly(?:;|$)/i);
    assert.match(cookie.raw, /;\s*SameSite=Lax(?:;|$)/i);
    assert.match(cookie.raw, /;\s*Path=\/(?:;|$)/i);
    assert.match(cookie.raw, /;\s*Max-Age=86400(?:;|$)/i);

    const me = await request(harness.port, {
      path: '/api/me',
      headers: {
        ...forwardedHeaders,
        Cookie: cookie.pair,
      },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.body.principal.type, 'user');

    const directRequestInfo = await request(harness.port, {
      path: '/__test/request-info',
    });
    assert.equal(directRequestInfo.body.secure, false);
    assert.equal(directRequestInfo.body.protocol, 'http');

    const directGuest = await request(harness.port, {
      path: '/api/auth/guest',
      method: 'POST',
    });
    assert.equal(directGuest.statusCode, 201);
    assert.match(extractCookie(directGuest).raw, /;\s*Secure(?:;|$)/i);
  } finally {
    await harness.close();
  }
});

test('development HTTP sessions remain compatible without proxy trust', async () => {
  const harness = await startApp('development');
  try {
    assert.equal(harness.app.get('trust proxy'), false);
    const requestInfo = await request(harness.port, {
      path: '/__test/request-info',
      headers: {
        'X-Forwarded-For': '198.51.100.10',
        'X-Forwarded-Proto': 'https',
      },
    });
    assert.equal(requestInfo.body.secure, false);
    assert.equal(requestInfo.body.protocol, 'http');
    assert.equal(requestInfo.body.ip, '127.0.0.1');
    assert.deepEqual(requestInfo.body.ips, []);

    const guest = await request(harness.port, {
      path: '/api/auth/guest',
      method: 'POST',
    });
    const cookie = extractCookie(guest);
    assert.doesNotMatch(cookie.raw, /;\s*Secure(?:;|$)/i);
    const me = await request(harness.port, {
      path: '/api/me',
      headers: { Cookie: cookie.pair },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.body.principal.type, 'guest');
  } finally {
    await harness.close();
  }
});

test('payment client IP uses only Express trusted proxy output', () => {
  assert.equal(
    normalizeTrustedClientIp({ ip: '198.51.100.10' }),
    '198.51.100.10'
  );
  assert.equal(
    normalizeTrustedClientIp({ ip: '::ffff:198.51.100.10' }),
    '198.51.100.10'
  );
  assert.equal(
    normalizeTrustedClientIp({ ip: '2001:db8::10' }),
    '2001:db8::10'
  );
  assert.equal(normalizeTrustedClientIp({
    ip: '',
    headers: { 'x-forwarded-for': '198.51.100.10' },
  }), '');
  assert.equal(normalizeTrustedClientIp({
    ip: '::1',
    ips: [],
    app: { get: () => 'loopback' },
  }), '');
  assert.equal(normalizeTrustedClientIp({
    ip: '127.0.0.2',
    ips: [],
    app: { get: () => 'loopback' },
  }), '');
  assert.equal(normalizeTrustedClientIp({
    ip: '203.0.113.8',
    ips: ['203.0.113.8'],
    app: { get: () => 'loopback' },
  }), '203.0.113.8');
});
