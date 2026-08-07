'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');

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
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
        });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
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

test('GET /api/me requires a valid session', async () => {
  const { port, server } = await startApp(createApp());

  try {
    const response = await requestPath({
      port,
      path: '/api/me',
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(parseJson(response.body), AUTH_REQUIRED_RESPONSE);
  } finally {
    await closeServer(server);
  }
});

test('guest creation returns a cookie usable with GET /api/me', async () => {
  const { port, server } = await startApp(createApp());

  try {
    const createResponse = await requestPath({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    assert.equal(createResponse.statusCode, 201);

    const createBody = parseJson(createResponse.body);
    assert.equal(createBody.authMode, 'development_guest');
    assert.equal(createBody.principal.type, 'guest');
    assert.equal(typeof createBody.principal.id, 'string');
    assert.notEqual(createBody.principal.id, '');
    assert.equal(
      new Date(createBody.session.expiresAt).toISOString(),
      createBody.session.expiresAt
    );

    const { cookiePair, rawToken, setCookie } =
      extractSessionCookie(createResponse);
    assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
    assert.match(setCookie, /;\s*SameSite=Lax(?:;|$)/i);
    assert.match(setCookie, /;\s*Path=\/(?:;|$)/i);
    assert.match(setCookie, /;\s*Max-Age=86400(?:;|$)/i);
    assert.equal(createResponse.body.includes(rawToken), false);
    assert.equal(createResponse.body.includes('tokenHash'), false);

    const meResponse = await requestPath({
      port,
      path: '/api/me',
      headers: {
        Cookie: `unrelated=value; ${cookiePair}`,
      },
    });
    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(parseJson(meResponse.body), {
      principal: {
        type: 'guest',
        id: createBody.principal.id,
      },
      account: null,
      permissions: {
        canRecharge: false,
        paymentMode: 'disabled',
        paymentProviders: {
          alipay: false,
          wechat: false,
        },
        publicPaymentEntryEnabled: false,
      },
    });
  } finally {
    await closeServer(server);
  }
});

test('GET /api/me rejects forged and malformed session cookies', async () => {
  const { port, server } = await startApp(createApp());

  try {
    const forgedResponse = await requestPath({
      port,
      path: '/api/me',
      headers: {
        Cookie: 'companion_session_extra=ignored; companion_session=forged',
      },
    });
    assert.equal(forgedResponse.statusCode, 401);
    assert.deepEqual(parseJson(forgedResponse.body), AUTH_REQUIRED_RESPONSE);

    const malformedResponse = await requestPath({
      port,
      path: '/api/me',
      headers: {
        Cookie: 'companion_session=%E0%A4%A',
      },
    });
    assert.equal(malformedResponse.statusCode, 401);
    assert.deepEqual(
      parseJson(malformedResponse.body),
      AUTH_REQUIRED_RESPONSE
    );
  } finally {
    await closeServer(server);
  }
});

test('guest sessions expire after 24 hours', async () => {
  let now = Date.parse('2026-07-25T00:00:00.000Z');
  const app = createApp({
    clock: () => now,
  });
  const { port, server } = await startApp(app);

  try {
    const createResponse = await requestPath({
      port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const { cookiePair } = extractSessionCookie(createResponse);

    now += (86400 * 1000) + 1;
    const meResponse = await requestPath({
      port,
      path: '/api/me',
      headers: {
        Cookie: cookiePair,
      },
    });
    assert.equal(meResponse.statusCode, 401);
    assert.deepEqual(parseJson(meResponse.body), AUTH_REQUIRED_RESPONSE);
  } finally {
    await closeServer(server);
  }
});

test('separate applications do not share guest sessions', async () => {
  const appA = await startApp(createApp());
  const appB = await startApp(createApp());

  try {
    const createResponse = await requestPath({
      port: appA.port,
      path: '/api/auth/guest',
      method: 'POST',
    });
    const { cookiePair } = extractSessionCookie(createResponse);
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

test('health endpoint remains available', async () => {
  const { port, server } = await startApp(createApp());

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
