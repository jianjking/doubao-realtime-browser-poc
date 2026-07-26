'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const bootstrapModule = require(
  '../relay_internal_call_lifecycle_bootstrap'
);
const {
  createRelayInternalCallLifecycleDependency,
} = bootstrapModule;

const BASE_URL = 'http://127.0.0.1:3002';
const TEST_TOKEN = 'bootstrap_test_token_0123456789ABCDEF';
const PAIR_ERROR_MESSAGE =
  'BUSINESS_BACKEND_INTERNAL_BASE_URL and '
  + 'BUSINESS_INTERNAL_API_TOKEN must be configured together';
const READ_ERROR_MESSAGE =
  'Unable to read Relay internal lifecycle configuration';

function createEnabledEnv(overrides = {}) {
  return {
    BUSINESS_BACKEND_INTERNAL_BASE_URL: BASE_URL,
    BUSINESS_INTERNAL_API_TOKEN: TEST_TOKEN,
    ...overrides,
  };
}

function buildResponseBody(callId, status) {
  return {
    call: {
      id: callId,
      role: {
        slug: 'yuhuang',
        displayName: '玉皇大帝',
      },
      status,
      createdAt: '2026-07-26T00:00:00.000Z',
      startedAt: null,
      endedAt: null,
      token: TEST_TOKEN,
      userId: 'private-user',
    },
  };
}

function assertSafeError(error, forbiddenValues = []) {
  assert.equal(error.name, 'TypeError');
  assert.equal(Object.hasOwn(error, 'cause'), false);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(error.message.includes(forbiddenValue), false);
    assert.equal(String(error.stack).includes(forbiddenValue), false);
  }
  return true;
}

test('completely missing configuration disables lifecycle safely', () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not run');
  };
  const environments = [
    {},
    {
      BUSINESS_BACKEND_INTERNAL_BASE_URL: undefined,
      BUSINESS_INTERNAL_API_TOKEN: undefined,
    },
  ];

  for (const env of environments) {
    const dependency = createRelayInternalCallLifecycleDependency({
      env,
      fetchImpl,
    });
    assert.deepEqual(Object.keys(dependency), ['enabled', 'client']);
    assert.equal(dependency.enabled, false);
    assert.equal(dependency.client, null);
    assert.equal(Object.isFrozen(dependency), true);
  }
  assert.equal(fetchCalls, 0);
});

test('complete valid configuration creates a frozen dependency', () => {
  let fetchCalls = 0;
  const dependency = createRelayInternalCallLifecycleDependency({
    env: createEnabledEnv(),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch must not run during creation');
    },
  });

  assert.deepEqual(Object.keys(bootstrapModule), [
    'createRelayInternalCallLifecycleDependency',
  ]);
  assert.equal(
    typeof bootstrapModule.createRelayInternalCallLifecycleDependency,
    'function'
  );
  assert.deepEqual(Object.keys(dependency), ['enabled', 'client']);
  assert.equal(dependency.enabled, true);
  assert.notEqual(dependency.client, null);
  assert.equal(Object.isFrozen(dependency), true);
  assert.equal(Object.isFrozen(dependency.client), true);
  assert.deepEqual(Object.keys(dependency.client).sort(), [
    'markActive',
    'markConnecting',
    'markEnded',
    'markFailed',
  ]);
  assert.equal(fetchCalls, 0);
});

test('enabled dependency directly reuses the existing client', async () => {
  let fetchCalls = 0;
  let capturedUrl;
  let capturedOptions;
  const callId = '通话 一号/#?%';
  const fetchImpl = async (url, options) => {
    fetchCalls += 1;
    capturedUrl = url;
    capturedOptions = options;
    return {
      status: 200,
      async json() {
        return buildResponseBody(callId, 'connecting');
      },
    };
  };
  const dependency = createRelayInternalCallLifecycleDependency({
    env: createEnabledEnv(),
    timeoutMs: 500,
    fetchImpl,
  });

  assert.equal(fetchCalls, 0);
  const call = await dependency.client.markConnecting(callId);

  assert.equal(fetchCalls, 1);
  assert.equal(
    capturedUrl,
    `${BASE_URL}/internal/calls/`
      + `${encodeURIComponent(callId)}/connecting`
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
  assert.deepEqual(call, {
    id: callId,
    role: {
      slug: 'yuhuang',
      displayName: '玉皇大帝',
    },
    status: 'connecting',
    createdAt: '2026-07-26T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
  });
  assert.equal(Object.hasOwn(call, 'token'), false);
  assert.equal(Object.hasOwn(call, 'userId'), false);
});

test('base URL without token fails with a fixed safe error', () => {
  const baseUrl = 'https://base-only-secret.example.com';
  let fetchCalls = 0;

  assert.throws(() => {
    createRelayInternalCallLifecycleDependency({
      env: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: baseUrl,
      },
      fetchImpl: async () => {
        fetchCalls += 1;
      },
    });
  }, (error) => {
    assertSafeError(error, [baseUrl]);
    assert.equal(error.message, PAIR_ERROR_MESSAGE);
    return true;
  });
  assert.equal(fetchCalls, 0);
});

test('token without base URL fails without exposing the token', () => {
  const token = 'token_only_secret_0123456789ABCDEF';
  let fetchCalls = 0;

  assert.throws(() => {
    createRelayInternalCallLifecycleDependency({
      env: {
        BUSINESS_INTERNAL_API_TOKEN: token,
      },
      fetchImpl: async () => {
        fetchCalls += 1;
      },
    });
  }, (error) => {
    assertSafeError(error, [token]);
    assert.equal(error.message, PAIR_ERROR_MESSAGE);
    return true;
  });
  assert.equal(fetchCalls, 0);
});

test('explicit invalid configuration never silently disables', () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not run');
  };
  const scenarios = [
    createEnabledEnv({
      BUSINESS_BACKEND_INTERNAL_BASE_URL: '',
      BUSINESS_INTERNAL_API_TOKEN: '',
    }),
    createEnabledEnv({
      BUSINESS_BACKEND_INTERNAL_BASE_URL: '   ',
    }),
    createEnabledEnv({
      BUSINESS_INTERNAL_API_TOKEN: '   ',
    }),
    createEnabledEnv({
      BUSINESS_BACKEND_INTERNAL_BASE_URL: 'not-a-url',
    }),
    createEnabledEnv({
      BUSINESS_INTERNAL_API_TOKEN: 'short-token',
    }),
    createEnabledEnv({
      BUSINESS_BACKEND_INTERNAL_BASE_URL: null,
    }),
    createEnabledEnv({
      BUSINESS_INTERNAL_API_TOKEN: null,
    }),
    createEnabledEnv({
      BUSINESS_BACKEND_INTERNAL_BASE_URL: 123,
    }),
    createEnabledEnv({
      BUSINESS_INTERNAL_API_TOKEN: 123,
    }),
  ];

  for (const env of scenarios) {
    assert.throws(() => {
      createRelayInternalCallLifecycleDependency({
        env,
        fetchImpl,
      });
    }, (error) => {
      assertSafeError(error, [TEST_TOKEN]);
      return true;
    });
  }

  assert.throws(() => {
    createRelayInternalCallLifecycleDependency({
      env: createEnabledEnv(),
      timeoutMs: 99,
      fetchImpl,
    });
  }, {
    name: 'TypeError',
    message: 'timeoutMs must be an integer between 100 and 30000',
  });
  assert.throws(() => {
    createRelayInternalCallLifecycleDependency({
      env: createEnabledEnv(),
      fetchImpl: null,
    });
  }, {
    name: 'TypeError',
    message: 'fetchImpl must be a function',
  });
  assert.equal(fetchCalls, 0);
});

test('env container validation is strict and env is not modified', () => {
  for (const env of [null, 'text', 123, true, []]) {
    assert.throws(() => {
      createRelayInternalCallLifecycleDependency({ env });
    }, {
      name: 'TypeError',
      message: 'env must be an object',
    });
  }

  let fetchCalls = 0;
  const env = Object.freeze({
    ...createEnabledEnv(),
    UNRELATED_VALUE: 'preserved',
  });
  const beforeJson = JSON.stringify(env);
  const beforeKeys = Object.keys(env);
  const dependency = createRelayInternalCallLifecycleDependency({
    env,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch must not run');
    },
  });

  assert.equal(dependency.enabled, true);
  assert.equal(JSON.stringify(env), beforeJson);
  assert.deepEqual(Object.keys(env), beforeKeys);
  assert.equal(env.UNRELATED_VALUE, 'preserved');
  assert.equal(Object.isFrozen(env), true);
  assert.equal(fetchCalls, 0);
});

test('throwing getters and proxies become fixed safe errors', () => {
  const scenarios = [
    {
      env: {
        get BUSINESS_BACKEND_INTERNAL_BASE_URL() {
          throw new Error('base getter secret details');
        },
        BUSINESS_INTERNAL_API_TOKEN: TEST_TOKEN,
      },
      forbiddenText: 'base getter secret details',
    },
    {
      env: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: BASE_URL,
        get BUSINESS_INTERNAL_API_TOKEN() {
          throw new Error('token getter secret details');
        },
      },
      forbiddenText: 'token getter secret details',
    },
    {
      env: new Proxy({}, {
        get() {
          throw new Error('proxy secret details');
        },
      }),
      forbiddenText: 'proxy secret details',
    },
  ];
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not run');
  };

  for (const scenario of scenarios) {
    assert.throws(() => {
      createRelayInternalCallLifecycleDependency({
        env: scenario.env,
        fetchImpl,
      });
    }, (error) => {
      assertSafeError(error, [scenario.forbiddenText, TEST_TOKEN]);
      assert.equal(error.message, READ_ERROR_MESSAGE);
      return true;
    });
  }
  assert.equal(fetchCalls, 0);

  let baseUrlReads = 0;
  let tokenReads = 0;
  const singleReadEnv = {
    get BUSINESS_BACKEND_INTERNAL_BASE_URL() {
      baseUrlReads += 1;
      if (baseUrlReads > 1) {
        throw new Error('base URL was read more than once');
      }
      return BASE_URL;
    },
    get BUSINESS_INTERNAL_API_TOKEN() {
      tokenReads += 1;
      if (tokenReads > 1) {
        throw new Error('token was read more than once');
      }
      return TEST_TOKEN;
    },
  };
  const dependency = createRelayInternalCallLifecycleDependency({
    env: singleReadEnv,
    fetchImpl,
  });
  assert.equal(dependency.enabled, true);
  assert.equal(baseUrlReads, 1);
  assert.equal(tokenReads, 1);
  assert.equal(fetchCalls, 0);
});
