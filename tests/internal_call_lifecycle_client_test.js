'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const clientModule = require('../internal_call_lifecycle_client');
const {
  InternalCallLifecycleClientError,
  createInternalCallLifecycleClient,
  createInternalCallLifecycleClientFromEnv,
} = clientModule;

const TEST_TOKEN = 'relay_internal_test_token_0123456789ABCDEF';
const BASE_URL = 'http://127.0.0.1:3002';
const CREATED_AT = '2026-07-26T00:00:00.000Z';

function buildResponseBody(callId, status) {
  return {
    call: {
      id: callId,
      role: {
        slug: 'yuhuang',
        displayName: '玉皇大帝',
      },
      status,
      createdAt: CREATED_AT,
      startedAt: null,
      endedAt: null,
    },
  };
}

function createJsonResponse(status, responseBody) {
  return {
    status,
    async json() {
      return responseBody;
    },
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

test('configuration validation accepts only safe client settings', () => {
  const fetchImpl = async () => createJsonResponse(
    200,
    buildResponseBody('unused', 'connecting')
  );
  const invalidBaseUrls = [
    undefined,
    '127.0.0.1:3002',
    'ws://127.0.0.1:3002',
    'http://user:pass@127.0.0.1:3002',
    'http://127.0.0.1:3002/path',
    'http://127.0.0.1:3002?token=x',
    'http://127.0.0.1:3002?',
    'http://127.0.0.1:3002#fragment',
    'http://127.0.0.1:3002#',
    'http://127.0.0.1:\n3002',
    ' http://127.0.0.1:3002',
    'http://127.0.0.1:3002 ',
  ];

  for (const baseUrl of invalidBaseUrls) {
    assert.throws(() => {
      createInternalCallLifecycleClient({
        baseUrl,
        token: TEST_TOKEN,
        fetchImpl,
      });
    }, (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(
        error.message,
        'baseUrl must be an absolute HTTP(S) origin'
      );
      assert.equal(error.message.includes(TEST_TOKEN), false);
      assert.equal(String(error.stack).includes(TEST_TOKEN), false);
      return true;
    });
  }

  const invalidTokens = [
    undefined,
    'short',
    'a'.repeat(31),
    `${'a'.repeat(32)} `,
    `${'a'.repeat(32)}\n`,
    `${'a'.repeat(31)}+`,
    `${'a'.repeat(31)}/`,
    `${'a'.repeat(31)}=`,
  ];
  for (const token of invalidTokens) {
    assert.throws(() => {
      createInternalCallLifecycleClient({
        baseUrl: BASE_URL,
        token,
        fetchImpl,
      });
    }, (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(
        error.message,
        'internal API token must be a base64url string '
          + 'of at least 32 characters'
      );
      if (typeof token === 'string' && token !== '') {
        assert.equal(error.message.includes(token), false);
        assert.equal(String(error.stack).includes(token), false);
      }
      return true;
    });
  }

  for (const timeoutMs of [
    NaN,
    Infinity,
    -Infinity,
    '3000',
    null,
    99,
    30001,
    100.5,
  ]) {
    assert.throws(() => {
      createInternalCallLifecycleClient({
        baseUrl: BASE_URL,
        token: TEST_TOKEN,
        timeoutMs,
        fetchImpl,
      });
    }, (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(
        error.message,
        'timeoutMs must be an integer between 100 and 30000'
      );
      assert.equal(error.message.includes(TEST_TOKEN), false);
      assert.equal(String(error.stack).includes(TEST_TOKEN), false);
      return true;
    });
  }

  for (const invalidFetch of [null, 123]) {
    assert.throws(() => {
      createInternalCallLifecycleClient({
        baseUrl: BASE_URL,
        token: TEST_TOKEN,
        fetchImpl: invalidFetch,
      });
    }, (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(error.message, 'fetchImpl must be a function');
      assert.equal(error.message.includes(TEST_TOKEN), false);
      assert.equal(String(error.stack).includes(TEST_TOKEN), false);
      return true;
    });
  }

  const clientWithoutSlash = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    timeoutMs: 100,
    fetchImpl,
  });
  const clientWithSlash = createInternalCallLifecycleClient({
    baseUrl: `${BASE_URL}/`,
    token: TEST_TOKEN,
    timeoutMs: 30000,
    fetchImpl,
  });
  const httpsClient = createInternalCallLifecycleClient({
    baseUrl: 'https://business-internal.example.com',
    token: TEST_TOKEN,
    fetchImpl,
  });
  assert.equal(typeof clientWithoutSlash.markConnecting, 'function');
  assert.equal(typeof clientWithSlash.markActive, 'function');
  assert.equal(typeof httpsClient.markEnded, 'function');
});

test('environment factory reads exact names without trimming or mutation', async () => {
  let fetchCalls = 0;
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    fetchCalls += 1;
    capturedUrl = url;
    capturedOptions = options;
    return createJsonResponse(
      200,
      buildResponseBody('call-env', 'connecting')
    );
  };
  const env = Object.freeze({
    BUSINESS_BACKEND_INTERNAL_BASE_URL: BASE_URL,
    BUSINESS_INTERNAL_API_TOKEN: TEST_TOKEN,
    UNRELATED_VALUE: 'preserved',
  });
  const before = JSON.stringify(env);
  const client = createInternalCallLifecycleClientFromEnv({
    env,
    timeoutMs: 100,
    fetchImpl,
  });

  assert.equal(typeof client.markConnecting, 'function');
  assert.equal(JSON.stringify(env), before);
  const call = await client.markConnecting('call-env');
  assert.deepEqual(
    call,
    buildResponseBody('call-env', 'connecting').call
  );
  assert.equal(fetchCalls, 1);
  assert.equal(
    capturedUrl,
    `${BASE_URL}/internal/calls/call-env/connecting`
  );
  assert.equal(
    capturedOptions.headers.Authorization,
    `Bearer ${TEST_TOKEN}`
  );

  let timeoutSignal;
  const timeoutClient = createInternalCallLifecycleClientFromEnv({
    env,
    timeoutMs: 100,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      timeoutSignal = options.signal;
      options.signal.addEventListener('abort', () => {
        reject(new Error('expected env timeout abort'));
      }, { once: true });
    }),
  });
  await assert.rejects(
    timeoutClient.markConnecting('call-env-timeout'),
    (error) => {
      assert.equal(error.code, 'INTERNAL_CALL_TIMEOUT');
      assert.equal(error.retryable, true);
      return true;
    }
  );
  assert.equal(timeoutSignal.aborted, true);

  assert.throws(() => {
    createInternalCallLifecycleClientFromEnv({
      env: {
        BUSINESS_INTERNAL_API_TOKEN: TEST_TOKEN,
      },
      fetchImpl,
    });
  }, {
    name: 'TypeError',
    message: 'baseUrl must be an absolute HTTP(S) origin',
  });
  assert.throws(() => {
    createInternalCallLifecycleClientFromEnv({
      env: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: BASE_URL,
      },
      fetchImpl,
    });
  }, {
    name: 'TypeError',
    message: 'internal API token must be a base64url string '
      + 'of at least 32 characters',
  });
  assert.throws(() => {
    createInternalCallLifecycleClientFromEnv({
      env: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: ` ${BASE_URL}`,
        BUSINESS_INTERNAL_API_TOKEN: TEST_TOKEN,
      },
      fetchImpl,
    });
  }, {
    name: 'TypeError',
    message: 'baseUrl must be an absolute HTTP(S) origin',
  });
  assert.throws(() => {
    createInternalCallLifecycleClientFromEnv({
      env: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: BASE_URL,
        BUSINESS_INTERNAL_API_TOKEN: `${TEST_TOKEN} `,
      },
      fetchImpl,
    });
  }, {
    name: 'TypeError',
    message: 'internal API token must be a base64url string '
      + 'of at least 32 characters',
  });
});

test('connecting request is fixed and does not expose the token', async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    const responseBody = buildResponseBody('call-1', 'connecting');
    Object.assign(responseBody.call, {
      userId: 'user-secret',
      balanceCents: 5000,
      token: TEST_TOKEN,
      speakerId: 'speaker-secret',
      systemPrompt: 'prompt-secret',
      extra: 'extra-secret',
    });
    return createJsonResponse(200, responseBody);
  };
  const client = createInternalCallLifecycleClient({
    baseUrl: `${BASE_URL}/`,
    token: TEST_TOKEN,
    fetchImpl,
  });

  const call = await client.markConnecting('call-1');

  assert.equal(
    capturedUrl,
    `${BASE_URL}/internal/calls/call-1/connecting`
  );
  assert.equal(capturedOptions.method, 'POST');
  assert.deepEqual(capturedOptions.headers, {
    Authorization: `Bearer ${TEST_TOKEN}`,
    Accept: 'application/json',
  });
  assert.equal(capturedOptions.redirect, 'error');
  assert.equal(capturedOptions.cache, 'no-store');
  assert.ok(capturedOptions.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(capturedOptions, 'body'), false);
  assert.equal(
    Object.keys(capturedOptions.headers).some(
      (name) => name.toLowerCase() === 'content-type'
    ),
    false
  );
  assert.equal(capturedUrl.includes(TEST_TOKEN), false);
  assert.deepEqual(call, buildResponseBody('call-1', 'connecting').call);
  assert.equal(JSON.stringify(call).includes(TEST_TOKEN), false);
});

test('four public methods use fixed lifecycle mappings only', async () => {
  const receivedPaths = [];
  const fetchImpl = async (url) => {
    const parsedUrl = new URL(url);
    receivedPaths.push(parsedUrl.pathname);
    const targetStatus = parsedUrl.pathname.split('/').at(-1);
    return createJsonResponse(
      200,
      buildResponseBody('call-map', targetStatus)
    );
  };
  const client = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    fetchImpl,
  });

  await client.markConnecting('call-map');
  await client.markActive('call-map');
  await client.markEnded('call-map');
  await client.markFailed('call-map');

  assert.deepEqual(receivedPaths, [
    '/internal/calls/call-map/connecting',
    '/internal/calls/call-map/active',
    '/internal/calls/call-map/ended',
    '/internal/calls/call-map/failed',
  ]);
  assert.deepEqual(Object.keys(client).sort(), [
    'markActive',
    'markConnecting',
    'markEnded',
    'markFailed',
  ]);
  for (const forbiddenName of [
    'setStatus',
    'markStatus',
    'transition',
    'request',
    'postLifecycle',
  ]) {
    assert.equal(client[forbiddenName], undefined);
    assert.equal(clientModule[forbiddenName], undefined);
  }
  assert.deepEqual(Object.keys(clientModule).sort(), [
    'InternalCallLifecycleClientError',
    'createInternalCallLifecycleClient',
    'createInternalCallLifecycleClientFromEnv',
  ]);
});

test('callId validation rejects whitespace and encodes path data', async () => {
  const receivedUrls = [];
  let expectedCallId;
  const fetchImpl = async (url) => {
    receivedUrls.push(url);
    return createJsonResponse(
      200,
      buildResponseBody(expectedCallId, 'connecting')
    );
  };
  const client = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    fetchImpl,
  });

  for (const callId of [null, '', '   ', ' call', 'call ']) {
    await assert.rejects(client.markConnecting(callId), {
      name: 'TypeError',
      message: 'callId must be a non-empty string',
    });
  }
  assert.equal(receivedUrls.length, 0);

  expectedCallId = '通话 一号/#?%';
  const call = await client.markConnecting(expectedCallId);
  const encodedCallId = encodeURIComponent(expectedCallId);
  assert.deepEqual(receivedUrls, [
    `${BASE_URL}/internal/calls/${encodedCallId}/connecting`,
  ]);
  assert.equal(call.id, expectedCallId);
  assert.equal(
    new URL(receivedUrls[0]).pathname,
    `/internal/calls/${encodedCallId}/connecting`
  );
  assert.equal(new URL(receivedUrls[0]).search, '');
  assert.equal(receivedUrls[0].includes(expectedCallId), false);
  assert.equal(receivedUrls[0].includes(TEST_TOKEN), false);
});

test('HTTP errors are safely classified without response leakage', async () => {
  const scenarios = [
    {
      status: 401,
      responseBody: {
        error: {
          code: 'INTERNAL_AUTH_REQUIRED',
          message: `do not expose ${TEST_TOKEN}`,
        },
      },
      remoteCode: 'INTERNAL_AUTH_REQUIRED',
      retryable: false,
      forbiddenText: 'do not expose',
    },
    {
      status: 404,
      responseBody: {
        error: {
          code: 'CALL_NOT_FOUND',
          message: 'full server message',
        },
      },
      remoteCode: 'CALL_NOT_FOUND',
      retryable: false,
      forbiddenText: 'full server message',
    },
    {
      status: 409,
      responseBody: {
        error: {
          code: 'INVALID_CALL_TRANSITION',
          message: 'full transition details',
        },
      },
      remoteCode: 'INVALID_CALL_TRANSITION',
      retryable: false,
      forbiddenText: 'full transition details',
    },
    {
      status: 429,
      responseBody: {
        error: {
          message: 'rate details',
        },
      },
      remoteCode: null,
      retryable: true,
      forbiddenText: 'rate details',
    },
    {
      status: 500,
      jsonError: new SyntaxError(`<html>${TEST_TOKEN}</html>`),
      remoteCode: null,
      retryable: true,
      forbiddenText: '<html>',
    },
    {
      status: 400,
      responseBody: {
        error: {
          code: 'bad-code',
          message: 'server secret',
        },
      },
      remoteCode: null,
      retryable: false,
      forbiddenText: 'server secret',
    },
  ];
  let scenarioIndex = 0;
  const fetchImpl = async () => {
    const scenario = scenarios[scenarioIndex];
    scenarioIndex += 1;
    if (scenario.jsonError) {
      return {
        status: scenario.status,
        async json() {
          throw scenario.jsonError;
        },
      };
    }
    return createJsonResponse(scenario.status, scenario.responseBody);
  };
  const client = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    fetchImpl,
  });

  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    await assert.rejects(
      client.markConnecting(`call-http-${index}`),
      (error) => {
        assert.ok(error instanceof InternalCallLifecycleClientError);
        assert.equal(error.code, 'INTERNAL_CALL_HTTP_ERROR');
        assert.equal(error.statusCode, scenario.status);
        assert.equal(error.remoteCode, scenario.remoteCode);
        assert.equal(error.retryable, scenario.retryable);
        assert.equal(error.message.includes(TEST_TOKEN), false);
        assert.equal(String(error.stack).includes(TEST_TOKEN), false);
        assert.equal(error.message.includes('full server message'), false);
        assert.equal(
          String(error.stack).includes('full server message'),
          false
        );
        assert.equal(error.message.includes('transition details'), false);
        assert.equal(
          String(error.stack).includes('transition details'),
          false
        );
        assert.equal(error.message.includes('<html>'), false);
        assert.equal(String(error.stack).includes('<html>'), false);
        assert.equal(error.message.includes('server secret'), false);
        assert.equal(String(error.stack).includes('server secret'), false);
        assert.equal(error.message.includes(scenario.forbiddenText), false);
        assert.equal(
          String(error.stack).includes(scenario.forbiddenText),
          false
        );
        return true;
      }
    );
  }
});

test('successful responses are validated and cropped to public fields', async () => {
  const validBody = buildResponseBody('call-response', 'connecting');
  Object.assign(validBody.call, {
    userId: 'user-secret',
    balanceCents: 10000,
    token: TEST_TOKEN,
    speakerId: 'speaker-secret',
    systemPrompt: 'prompt-secret',
    extra: 'extra-secret',
  });
  let thisBoundResponse;
  thisBoundResponse = {
    status: 200,
    async json() {
      assert.equal(this, thisBoundResponse);
      return validBody;
    },
  };
  const invalidScenarios = [
    {
      response: null,
      statusCode: null,
    },
    {
      response: 'not-a-response',
      statusCode: null,
    },
    {
      response: 42,
      statusCode: null,
    },
    {
      response: createJsonResponse(200.5, {}),
      statusCode: null,
    },
    {
      response: createJsonResponse(99, {}),
      statusCode: null,
    },
    {
      response: createJsonResponse(600, {}),
      statusCode: null,
    },
    {
      response: { status: 200 },
      statusCode: 200,
    },
    {
      response: { status: 200, json: 'not-a-function' },
      statusCode: 200,
    },
    {
      response: {
        get status() {
          throw new Error(`response getter secret ${TEST_TOKEN}`);
        },
      },
      statusCode: null,
      forbiddenText: 'response getter secret',
    },
    {
      response: {
        status: 200,
        get json() {
          throw new Error(`json getter secret ${TEST_TOKEN}`);
        },
      },
      statusCode: 200,
      forbiddenText: 'json getter secret',
    },
    {
      response: new Proxy({}, {
        get(target, property) {
          if (property === 'status') {
            throw new Error(`proxy getter secret ${TEST_TOKEN}`);
          }
          return target[property];
        },
      }),
      statusCode: null,
      forbiddenText: 'proxy getter secret',
    },
    {
      response: {
        status: 200,
        async json() {
          throw new SyntaxError(`invalid JSON ${TEST_TOKEN}`);
        },
      },
      statusCode: 200,
      forbiddenText: 'invalid JSON',
    },
    {
      response: createJsonResponse(200, []),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {}),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, { call: [] }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(
        200,
        buildResponseBody('different-call', 'connecting')
      ),
      statusCode: 200,
    },
    {
      response: createJsonResponse(
        200,
        buildResponseBody('call-response', 'active')
      ),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          role: undefined,
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          role: {
            displayName: '玉皇大帝',
          },
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          role: {
            slug: '',
            displayName: '玉皇大帝',
          },
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          role: {
            slug: 'yuhuang',
          },
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          role: {
            slug: 'yuhuang',
            displayName: '',
          },
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          createdAt: undefined,
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          startedAt: 123,
        },
      }),
      statusCode: 200,
    },
    {
      response: createJsonResponse(200, {
        call: {
          ...buildResponseBody('call-response', 'connecting').call,
          endedAt: {},
        },
      }),
      statusCode: 200,
    },
  ];
  const responses = [
    thisBoundResponse,
    ...invalidScenarios.map((scenario) => scenario.response),
  ];
  let responseIndex = 0;
  const fetchImpl = async () => {
    const response = responses[responseIndex];
    responseIndex += 1;
    return response;
  };
  const client = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    fetchImpl,
  });

  const call = await client.markConnecting('call-response');
  assert.deepEqual(
    call,
    buildResponseBody('call-response', 'connecting').call
  );
  assert.deepEqual(Object.keys(call), [
    'id',
    'role',
    'status',
    'createdAt',
    'startedAt',
    'endedAt',
  ]);
  assert.equal(JSON.stringify(call).includes(TEST_TOKEN), false);

  for (const scenario of invalidScenarios) {
    await assert.rejects(
      client.markConnecting('call-response'),
      (error) => {
        assert.ok(error instanceof InternalCallLifecycleClientError);
        assert.equal(error.code, 'INTERNAL_CALL_INVALID_RESPONSE');
        assert.equal(error.statusCode, scenario.statusCode);
        assert.equal(error.remoteCode, null);
        assert.equal(error.retryable, true);
        assert.equal(
          error.message,
          'Internal call lifecycle response was invalid'
        );
        assert.equal(error.message.includes(TEST_TOKEN), false);
        assert.equal(String(error.stack).includes(TEST_TOKEN), false);
        if (scenario.forbiddenText) {
          assert.equal(
            error.message.includes(scenario.forbiddenText),
            false
          );
          assert.equal(
            String(error.stack).includes(scenario.forbiddenText),
            false
          );
        }
        return true;
      }
    );
  }
});

test('client timeout aborts the request and is retryable', async () => {
  let aborted = false;
  const fetchImpl = async (url, options) => new Promise(
    (resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error(`aborted request ${TEST_TOKEN}`));
      }, { once: true });
    }
  );
  const client = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    timeoutMs: 100,
    fetchImpl,
  });

  await assert.rejects(client.markConnecting('call-timeout'), (error) => {
    assert.ok(error instanceof InternalCallLifecycleClientError);
    assert.equal(error.code, 'INTERNAL_CALL_TIMEOUT');
    assert.equal(error.statusCode, null);
    assert.equal(error.remoteCode, null);
    assert.equal(error.retryable, true);
    assert.equal(error.message, 'Internal call lifecycle request timed out');
    assert.equal(error.message.includes(TEST_TOKEN), false);
    assert.equal(String(error.stack).includes(TEST_TOKEN), false);
    return true;
  });
  assert.equal(aborted, true);

  let fastSignal;
  const fastClient = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    timeoutMs: 100,
    fetchImpl: async (url, options) => {
      fastSignal = options.signal;
      return createJsonResponse(
        200,
        buildResponseBody('call-fast', 'connecting')
      );
    },
  });
  await fastClient.markConnecting('call-fast');
  await new Promise((resolve) => {
    setTimeout(resolve, 160);
  });
  assert.equal(fastSignal.aborted, false);
});

test('network errors use a fixed safe retryable error', async () => {
  const originalMessage = 'socket failed with secret-looking-data';
  const fetchImpl = async () => {
    throw new Error(originalMessage);
  };
  const client = createInternalCallLifecycleClient({
    baseUrl: BASE_URL,
    token: TEST_TOKEN,
    fetchImpl,
  });

  await assert.rejects(client.markConnecting('call-network'), (error) => {
    assert.ok(error instanceof InternalCallLifecycleClientError);
    assert.equal(error.code, 'INTERNAL_CALL_NETWORK_ERROR');
    assert.equal(error.statusCode, null);
    assert.equal(error.remoteCode, null);
    assert.equal(error.retryable, true);
    assert.equal(
      error.message,
      'Internal call lifecycle network request failed'
    );
    assert.equal(error.message.includes(originalMessage), false);
    assert.equal(String(error.stack).includes(originalMessage), false);
    assert.equal(error.message.includes(TEST_TOKEN), false);
    assert.equal(String(error.stack).includes(TEST_TOKEN), false);
    return true;
  });
});

test('local HTTP integration sends safe repeatable lifecycle requests', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let requestBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      requestBody += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        accept: request.headers.accept,
        contentType: request.headers['content-type'],
        body: requestBody,
      });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Connection', 'close');
      response.end(JSON.stringify({
        ...buildResponseBody('call-integration', 'connecting'),
        serverExtra: TEST_TOKEN,
      }));
    });
  });

  try {
    await listenOnTemporaryPort(server);
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    const client = createInternalCallLifecycleClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: TEST_TOKEN,
      timeoutMs: 3000,
    });

    const firstCall = await client.markConnecting('call-integration');
    const secondCall = await client.markConnecting('call-integration');
    assert.deepEqual(
      firstCall,
      buildResponseBody('call-integration', 'connecting').call
    );
    assert.deepEqual(secondCall, firstCall);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.method, 'POST');
      assert.equal(
        request.url,
        '/internal/calls/call-integration/connecting'
      );
      assert.equal(request.authorization, `Bearer ${TEST_TOKEN}`);
      assert.equal(request.accept, 'application/json');
      assert.equal(request.contentType, undefined);
      assert.equal(request.body, '');
    }

    await closeServer(server);
    await assert.rejects(
      client.markConnecting('call-integration'),
      (error) => {
        assert.equal(error.code, 'INTERNAL_CALL_NETWORK_ERROR');
        assert.equal(error.retryable, true);
        assert.equal(error.message.includes(TEST_TOKEN), false);
        return true;
      }
    );
  } finally {
    await closeServer(server);
  }
});
