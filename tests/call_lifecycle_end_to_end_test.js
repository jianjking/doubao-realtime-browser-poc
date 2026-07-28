'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const { createApp } = require('../business_backend/app');
const {
  PUBLIC_ROLES,
} = require('../business_backend/config/public_roles');
const {
  createRelayInternalCallLifecycleDependency,
} = require('../relay_internal_call_lifecycle_bootstrap');
const {
  createRelayInternalCallLifecycleCoordinator,
} = require('../relay_internal_call_lifecycle_coordinator');

const PROJECT_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(PROJECT_DIR, 'server_doubao_realtime.js');
const TEST_DEVELOPMENT_CODE = '654321';
const TEST_PHONE = '13800138000';
const STATUS_TIMEOUT_MS = 3000;
const EVENT = Object.freeze({
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  CONNECTION_FINISHED: 52,
  START_SESSION: 100,
  TASK_REQUEST: 200,
  FINISH_SESSION: 102,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  USAGE_RESPONSE: 154,
  ASR_INFO: 450,
  ASR_RESPONSE: 451,
  ASR_ENDED: 459,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352,
  TTS_ENDED: 359,
  CHAT_TEXT_QUERY: 501,
  CHAT_RESPONSE: 550,
  CHAT_TEXT_QUERY_CONFIRMED: 553,
  CHAT_ENDED: 559,
  DIALOG_COMMON_ERROR: 599,
});
const LIFECYCLE_NAMES = new Set([
  'connecting',
  'active',
  'ended',
  'failed',
]);

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
  if (!server || !server.listening) {
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
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  });
}

function createLifecycleRequestRecorder() {
  const requests = new Map();

  function record(request) {
    if (request.method !== 'POST') {
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    } catch {
      return;
    }

    const match = /^\/internal\/calls\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (!match || !LIFECYCLE_NAMES.has(match[2])) {
      return;
    }

    let callId;
    try {
      callId = decodeURIComponent(match[1]);
    } catch {
      return;
    }
    const lifecycle = match[2];
    const callRequests = requests.get(callId) || {
      connecting: 0,
      active: 0,
      ended: 0,
      failed: 0,
    };
    callRequests[lifecycle] += 1;
    requests.set(callId, callRequests);
  }

  function countsFor(callId) {
    return {
      connecting: 0,
      active: 0,
      ended: 0,
      failed: 0,
      ...(requests.get(callId) || {}),
    };
  }

  return {
    countsFor,
    record,
  };
}

async function startBusinessBackend(internalToken) {
  let now = Date.parse('2026-07-27T00:00:00.000Z');
  const app = createApp({
    clock() {
      const currentTime = now;
      now += 1000;
      return currentTime;
    },
    developmentVerificationCode: TEST_DEVELOPMENT_CODE,
    initialBalanceCents: 100,
    internalApiToken: internalToken,
  });
  const recorder = createLifecycleRequestRecorder();
  const server = http.createServer(app);
  server.prependListener('request', recorder.record);
  await listenOnTemporaryPort(server);
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return {
    port: address.port,
    recorder,
    server,
  };
}

function requestPath({
  port,
  requestPathname,
  method = 'GET',
  headers = {},
  body,
}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPathname,
      method,
      headers: {
        Connection: 'close',
        ...headers,
      },
      agent: false,
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
  requestPathname,
  requestBody,
  cookiePair,
}) {
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
    requestPathname,
    method: 'POST',
    headers,
    body,
  });
}

function parseJsonResponse(response, expectedStatusCode) {
  assert.equal(response.statusCode, expectedStatusCode);
  let result;
  try {
    result = JSON.parse(response.body);
  } catch (error) {
    throw new Error('Public Call API response was not valid JSON', {
      cause: error,
    });
  }
  return result;
}

function extractSessionCookie(response) {
  const setCookieHeaders = response.headers['set-cookie'];
  assert.ok(Array.isArray(setCookieHeaders));
  assert.equal(setCookieHeaders.length, 1);
  const cookiePair = setCookieHeaders[0].split(';', 1)[0];
  assert.match(cookiePair, /^companion_session=[A-Za-z0-9_-]+$/);
  return cookiePair;
}

async function login(port) {
  const response = await requestJson({
    port,
    requestPathname: '/api/auth/login',
    requestBody: {
      phone: TEST_PHONE,
      code: TEST_DEVELOPMENT_CODE,
    },
  });
  parseJsonResponse(response, 200);
  return extractSessionCookie(response);
}

async function createPendingCall(port, cookiePair) {
  const response = await requestJson({
    port,
    requestPathname: '/api/calls',
    requestBody: {
      roleSlug: 'yuhuang',
    },
    cookiePair,
  });
  return parseJsonResponse(response, 201).call;
}

async function getPublicCall(port, cookiePair, callId) {
  const response = await requestPath({
    port,
    requestPathname: `/api/calls/${encodeURIComponent(callId)}`,
    headers: {
      Cookie: cookiePair,
    },
  });
  const call = parseJsonResponse(response, 200).call;
  assert.equal(Object.hasOwn(call, 'userId'), false);
  return call;
}

async function getPublicAccount(port, cookiePair) {
  const response = await requestPath({
    port,
    requestPathname: '/api/me',
    headers: {
      Cookie: cookiePair,
    },
  });
  return parseJsonResponse(response, 200).account;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForCallStatus({
  port,
  cookiePair,
  callId,
  expectedStatus,
  timeoutMs = STATUS_TIMEOUT_MS,
}) {
  const deadline = Date.now() + timeoutMs;
  let call;
  do {
    call = await getPublicCall(port, cookiePair, callId);
    if (call.status === expectedStatus) {
      return call;
    }
    await delay(10);
  } while (Date.now() < deadline);

  assert.equal(call.status, expectedStatus);
  return call;
}

function instrumentServerSource() {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  const instrumented = source.replace(
    /\nstartServer\(\);\s*$/,
    `\nglobalThis.__serverTestExports = {
      handleBrowserConnection,
      handleBrowserMessage,
      handleDoubaoMessage,
    };\n`
  );
  assert.notEqual(instrumented, source);
  return instrumented;
}

function createRelayRuntime() {
  const encodedEvents = [];
  const logs = [];
  const upstreamInstances = [];

  class FakeUpstreamWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.readyState = FakeUpstreamWebSocket.CONNECTING;
      this.handlers = new Map();
      this.sent = [];
      this.closeCalls = 0;
      this.terminateCalls = 0;
      upstreamInstances.push(this);
    }

    on(eventName, handler) {
      this.handlers.set(eventName, handler);
    }

    send(data, options, callback) {
      this.sent.push(data);
      const completion = typeof options === 'function'
        ? options
        : callback;
      if (completion) {
        completion();
      }
    }

    close(code = 1000, reason = '') {
      this.closeCalls += 1;
      if (this.readyState === FakeUpstreamWebSocket.CLOSED) {
        return;
      }
      this.readyState = FakeUpstreamWebSocket.CLOSED;
      const handler = this.handlers.get('close');
      if (handler) {
        handler(code, Buffer.from(reason));
      }
    }

    terminate() {
      this.terminateCalls += 1;
      this.close(1006, 'terminated');
    }

    emitOpen() {
      assert.equal(this.readyState, FakeUpstreamWebSocket.CONNECTING);
      this.readyState = FakeUpstreamWebSocket.OPEN;
      this.handlers.get('open')();
    }

    emitFrame(frame) {
      this.handlers.get('message')(frame, true);
    }
  }

  const protocol = {
    EVENT,
    DoubaoProtocolError: class DoubaoProtocolError extends Error {},
    encodeClientAudioEvent() {
      return Buffer.alloc(4);
    },
    encodeClientJsonEvent(eventId, payload, sessionId) {
      encodedEvents.push({
        eventId,
        payload,
        sessionId,
      });
      return Buffer.from([eventId & 0xff]);
    },
    getEventName(eventId) {
      return `event-${eventId}`;
    },
    parseServerFrame(data) {
      return data;
    },
  };

  const context = {
    Buffer,
    URL,
    __dirname: PROJECT_DIR,
    __filename: SERVER_PATH,
    clearTimeout,
    console: {
      log(message) {
        logs.push(String(message));
      },
    },
    process: {
      env: {
        VOLCENGINE_API_KEY: 'local-end-to-end-key',
      },
    },
    require(moduleName) {
      if (moduleName === 'node:crypto') {
        return crypto;
      }
      if (moduleName === 'node:http') {
        return {};
      }
      if (moduleName === 'node:path') {
        return path;
      }
      if (moduleName === 'express') {
        const express = () => ({
          use() {},
        });
        express.static = () => () => {};
        return express;
      }
      if (moduleName === 'ws') {
        return {
          WebSocket: FakeUpstreamWebSocket,
          WebSocketServer: class FakeWebSocketServer {},
        };
      }
      if (moduleName === './doubao_protocol.js') {
        return protocol;
      }
      if (moduleName === './relay_internal_call_lifecycle_bootstrap') {
        return {
          createRelayInternalCallLifecycleDependency,
        };
      }
      if (moduleName === './relay_internal_call_lifecycle_coordinator') {
        return {
          createRelayInternalCallLifecycleCoordinator,
        };
      }
      throw new Error(`Unexpected Relay require: ${moduleName}`);
    },
    setTimeout,
  };

  vm.runInNewContext(instrumentServerSource(), context, {
    filename: SERVER_PATH,
  });

  return {
    encodedEvents,
    exports: context.__serverTestExports,
    logs,
    upstreamInstances,
  };
}

class FakeBrowserSocket {
  constructor() {
    this.readyState = 1;
    this.handlers = new Map();
    this.sent = [];
    this.closeCalls = 0;
    this.closeEventEmitted = false;
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  send(data, callback) {
    this.sent.push(JSON.parse(data));
    if (callback) {
      callback();
    }
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  emitJson(message) {
    this.handlers.get('message')(
      Buffer.from(JSON.stringify(message)),
      false
    );
  }

  emitClose(code = 1000) {
    if (this.closeEventEmitted) {
      return;
    }
    this.closeEventEmitted = true;
    this.readyState = 3;
    this.handlers.get('close')(code);
  }
}

function createBrowserConnection(runtime, dependency) {
  const browserSocket = new FakeBrowserSocket();
  const contexts = new Set();
  runtime.exports.handleBrowserConnection(
    browserSocket,
    {
      socket: {
        remoteAddress: '127.0.0.1',
      },
    },
    contexts,
    dependency
  );
  assert.equal(contexts.size, 1);
  return {
    browserSocket,
    context: [...contexts][0],
    contexts,
  };
}

function emitFrame(connection, eventId, eventName, options = {}) {
  connection.context.upstreamSocket.emitFrame({
    eventId,
    eventName,
    json: options.json || {},
    messageType: 1,
    payload: Buffer.alloc(0),
    ...(options.sessionId === undefined
      ? {}
      : { sessionId: options.sessionId }),
  });
}

function emitConnectionStarted(connection) {
  const upstream = connection.context.upstreamSocket;
  assert.ok(upstream);
  upstream.emitOpen();
  emitFrame(
    connection,
    EVENT.CONNECTION_STARTED,
    'ConnectionStarted'
  );
  assert.equal(typeof connection.context.sessionId, 'string');
  return upstream;
}

function emitSessionStarted(connection) {
  emitFrame(
    connection,
    EVENT.SESSION_STARTED,
    'SessionStarted',
    {
      sessionId: connection.context.sessionId,
    }
  );
}

function emitSessionFinished(connection) {
  emitFrame(
    connection,
    EVENT.SESSION_FINISHED,
    'SessionFinished',
    {
      sessionId: connection.context.sessionId,
    }
  );
}

function emitSessionFailed(connection) {
  emitFrame(
    connection,
    EVENT.SESSION_FAILED,
    'SessionFailed',
    {
      json: {
        message: 'Session failed for end-to-end test',
      },
      sessionId: connection.context.sessionId,
    }
  );
}

function emitConnectionFinished(connection) {
  emitFrame(
    connection,
    EVENT.CONNECTION_FINISHED,
    'ConnectionFinished'
  );
}

function browserMessageCount(connection, type) {
  return connection.browserSocket.sent.filter(
    (message) => message.type === type
  ).length;
}

function encodedEventCount(runtime, eventId) {
  return runtime.encodedEvents.filter(
    (event) => event.eventId === eventId
  ).length;
}

async function flushRelayCleanup() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

async function cleanupConnection(connection) {
  if (!connection) {
    return;
  }

  connection.browserSocket.emitClose();
  const upstream = connection.context.upstreamSocket;
  if (upstream && upstream.readyState !== 3) {
    emitConnectionFinished(connection);
  }
  if (connection.context.closePromise) {
    await connection.context.closePromise;
  }
  await flushRelayCleanup();
}

function assertNoSensitiveRelayLeak(runtime, connections, token) {
  const observed = JSON.stringify({
    logs: runtime.logs,
    browserMessages: connections.map(
      (connection) => connection.browserSocket.sent
    ),
  });
  assert.equal(observed.includes(token), false);
  assert.equal(observed.includes('Authorization'), false);
  assert.equal(observed.includes('Bearer'), false);
  assert.equal(observed.includes('userId'), false);
}

function createLifecycleDependency(port, internalToken) {
  return createRelayInternalCallLifecycleDependency({
    env: {
      BUSINESS_BACKEND_INTERNAL_BASE_URL:
        `http://127.0.0.1:${port}`,
      BUSINESS_INTERNAL_API_TOKEN: internalToken,
    },
    timeoutMs: STATUS_TIMEOUT_MS,
  });
}

async function runNormalScenario({
  runtime,
  dependency,
  port,
  cookiePair,
  callId,
}) {
  const lifecycle = ['pending'];
  const connection = createBrowserConnection(runtime, dependency);
  connection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId,
  });

  let call = await waitForCallStatus({
    port,
    cookiePair,
    callId,
    expectedStatus: 'connecting',
  });
  lifecycle.push(call.status);

  emitConnectionStarted(connection);
  assert.equal(
    encodedEventCount(runtime, EVENT.START_SESSION),
    1
  );
  emitSessionStarted(connection);
  call = await waitForCallStatus({
    port,
    cookiePair,
    callId,
    expectedStatus: 'active',
  });
  lifecycle.push(call.status);
  assert.equal(typeof call.startedAt, 'string');
  assert.equal(call.endedAt, null);
  assert.equal(browserMessageCount(
    connection,
    'relay.session_started'
  ), 1);

  emitSessionFinished(connection);
  call = await waitForCallStatus({
    port,
    cookiePair,
    callId,
    expectedStatus: 'ended',
  });
  lifecycle.push(call.status);
  assert.equal(typeof call.startedAt, 'string');
  assert.equal(typeof call.endedAt, 'string');
  assert.equal(browserMessageCount(
    connection,
    'relay.session_finished'
  ), 1);
  assert.equal(lifecycle.includes('failed'), false);

  connection.browserSocket.emitClose();
  assert.ok(connection.context.closePromise);
  emitConnectionFinished(connection);
  await connection.context.closePromise;
  await flushRelayCleanup();
  assert.equal(connection.contexts.size, 0);
  assert.equal(connection.context.upstreamCloseTimer, undefined);

  return {
    call,
    connection,
    lifecycle,
  };
}

async function runFailedScenario({
  runtime,
  dependency,
  port,
  cookiePair,
  callId,
}) {
  const lifecycle = ['pending'];
  const connection = createBrowserConnection(runtime, dependency);
  connection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId,
  });

  let call = await waitForCallStatus({
    port,
    cookiePair,
    callId,
    expectedStatus: 'connecting',
  });
  lifecycle.push(call.status);

  emitConnectionStarted(connection);
  assert.equal(
    encodedEventCount(runtime, EVENT.START_SESSION),
    2
  );
  emitSessionStarted(connection);
  call = await waitForCallStatus({
    port,
    cookiePair,
    callId,
    expectedStatus: 'active',
  });
  lifecycle.push(call.status);
  assert.equal(typeof call.startedAt, 'string');

  emitSessionFailed(connection);
  call = await waitForCallStatus({
    port,
    cookiePair,
    callId,
    expectedStatus: 'failed',
  });
  lifecycle.push(call.status);
  assert.equal(typeof call.startedAt, 'string');
  assert.equal(typeof call.endedAt, 'string');
  assert.notEqual(call.status, 'ended');
  assert.equal(connection.context.closing, true);
  assert.ok(connection.context.closePromise);
  assert.equal(browserMessageCount(
    connection,
    'relay.cloud_error'
  ), 1);
  assert.equal(connection.context.finishSessionSent, true);
  assert.equal(connection.context.finishConnectionSent, true);
  assert.equal(
    encodedEventCount(runtime, EVENT.FINISH_SESSION),
    2
  );
  assert.equal(
    encodedEventCount(runtime, EVENT.FINISH_CONNECTION),
    2
  );

  emitConnectionFinished(connection);
  await connection.context.closePromise;
  connection.browserSocket.emitClose();
  await flushRelayCleanup();
  assert.equal(connection.contexts.size, 0);
  assert.equal(connection.context.upstreamCloseTimer, undefined);

  return {
    call,
    connection,
    lifecycle,
  };
}

async function main() {
  const internalToken = crypto.randomBytes(32).toString('base64url');
  let backend;
  let normalResult;
  let failedResult;
  let normalConnection;
  let failedConnection;

  try {
    backend = await startBusinessBackend(internalToken);
    const cookiePair = await login(backend.port);
    const initialAccount = await getPublicAccount(
      backend.port,
      cookiePair
    );
    assert.equal(initialAccount.balanceCents, 100);
    assert.equal(
      Number.isSafeInteger(initialAccount.balanceCents),
      true
    );
    const normalPendingCall = await createPendingCall(
      backend.port,
      cookiePair
    );
    const failedPendingCall = await createPendingCall(
      backend.port,
      cookiePair
    );
    assert.equal(normalPendingCall.status, 'pending');
    assert.equal(failedPendingCall.status, 'pending');
    assert.equal(Object.hasOwn(normalPendingCall, 'userId'), false);
    assert.equal(Object.hasOwn(failedPendingCall, 'userId'), false);
    assert.notEqual(normalPendingCall.id, failedPendingCall.id);

    const dependency = createLifecycleDependency(
      backend.port,
      internalToken
    );
    assert.equal(dependency.enabled, true);
    const runtime = createRelayRuntime();

    normalResult = await runNormalScenario({
      runtime,
      dependency,
      port: backend.port,
      cookiePair,
      callId: normalPendingCall.id,
    });
    normalConnection = normalResult.connection;
    const normalEndedAccount = await getPublicAccount(
      backend.port,
      cookiePair
    );
    const yuhuangRole = PUBLIC_ROLES.find(
      (role) => role.slug === 'yuhuang'
    );
    assert.ok(yuhuangRole);
    const normalChargeFen = Math.ceil(
      normalResult.call.durationMs / yuhuangRole.billingUnitMs
    ) * yuhuangRole.pricePerBillingUnitFen;
    assert.ok(normalChargeFen > 0);
    assert.equal(
      normalEndedAccount.balanceCents,
      initialAccount.balanceCents - normalChargeFen
    );

    failedResult = await runFailedScenario({
      runtime,
      dependency,
      port: backend.port,
      cookiePair,
      callId: failedPendingCall.id,
    });
    failedConnection = failedResult.connection;
    const failedAccount = await getPublicAccount(
      backend.port,
      cookiePair
    );
    assert.equal(
      failedAccount.balanceCents,
      normalEndedAccount.balanceCents
    );

    assert.deepEqual(
      backend.recorder.countsFor(normalPendingCall.id),
      {
        connecting: 1,
        active: 1,
        ended: 1,
        failed: 0,
      }
    );
    assert.deepEqual(
      backend.recorder.countsFor(failedPendingCall.id),
      {
        connecting: 1,
        active: 1,
        ended: 0,
        failed: 1,
      }
    );

    const finalNormalCall = await getPublicCall(
      backend.port,
      cookiePair,
      normalPendingCall.id
    );
    const finalFailedCall = await getPublicCall(
      backend.port,
      cookiePair,
      failedPendingCall.id
    );
    assert.equal(finalNormalCall.status, 'ended');
    assert.equal(finalFailedCall.status, 'failed');
    assert.equal(
      Object.hasOwn(finalNormalCall, 'chargeFen'),
      false
    );
    assert.equal(
      Object.hasOwn(finalFailedCall, 'chargeFen'),
      false
    );
    assert.equal(normalResult.call.status, 'ended');
    assert.equal(failedResult.call.status, 'failed');
    assert.notEqual(
      normalConnection.context.sessionId,
      failedConnection.context.sessionId
    );
    assert.notEqual(
      normalConnection.context.internalCallLifecycleCoordinator,
      failedConnection.context.internalCallLifecycleCoordinator
    );
    assertNoSensitiveRelayLeak(
      runtime,
      [normalConnection, failedConnection],
      internalToken
    );

    assert.deepEqual(
      normalResult.lifecycle,
      ['pending', 'connecting', 'active', 'ended']
    );
    assert.deepEqual(
      failedResult.lifecycle,
      ['pending', 'connecting', 'active', 'failed']
    );

    console.log('call_lifecycle_end_to_end_test: PASS');
    console.log(
      'normalLifecycle=pending>connecting>active>ended'
    );
    console.log(
      'failedLifecycle=pending>connecting>active>failed'
    );
  } finally {
    await cleanupConnection(normalConnection);
    await cleanupConnection(failedConnection);
    if (backend) {
      await closeServer(backend.server);
    }
  }
}

main().catch((error) => {
  process.nextTick(() => {
    throw error;
  });
});
