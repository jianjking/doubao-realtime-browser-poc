'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const coordinatorModule = require(
  '../relay_internal_call_lifecycle_coordinator'
);
const {
  createRelayInternalCallLifecycleCoordinator,
} = coordinatorModule;

const DEPENDENCY_ERROR_MESSAGE =
  'dependency must be a valid Relay internal lifecycle dependency';
const CALL_ID_ERROR_MESSAGE =
  'callId must be a non-empty trimmed string when lifecycle is enabled';
const PUBLIC_KEYS = [
  'markActive',
  'markConnecting',
  'markEnded',
  'markFailed',
];

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

function createClientSpy(implementations = {}) {
  const calls = [];
  const client = {
    markConnecting(callId) {
      calls.push({
        method: 'markConnecting',
        callId,
        thisValue: this,
      });
      if (implementations.markConnecting) {
        return implementations.markConnecting(callId);
      }
      return Promise.resolve('connecting');
    },
    markActive(callId) {
      calls.push({
        method: 'markActive',
        callId,
        thisValue: this,
      });
      if (implementations.markActive) {
        return implementations.markActive(callId);
      }
      return Promise.resolve('active');
    },
    markEnded(callId) {
      calls.push({
        method: 'markEnded',
        callId,
        thisValue: this,
      });
      if (implementations.markEnded) {
        return implementations.markEnded(callId);
      }
      return Promise.resolve('ended');
    },
    markFailed(callId) {
      calls.push({
        method: 'markFailed',
        callId,
        thisValue: this,
      });
      if (implementations.markFailed) {
        return implementations.markFailed(callId);
      }
      return Promise.resolve('failed');
    },
  };
  return {
    client,
    calls,
  };
}

function createEnabledDependency(client) {
  return {
    enabled: true,
    client,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function assertDependencyValidationError(callback, forbiddenValues = []) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, 'TypeError');
    assert.equal(error.message, DEPENDENCY_ERROR_MESSAGE);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    for (const forbiddenValue of forbiddenValues) {
      assert.equal(error.message.includes(forbiddenValue), false);
      assert.equal(String(error.stack).includes(forbiddenValue), false);
    }
    return true;
  });
}

function createSingleReadAccessorClient() {
  const reads = {
    markConnecting: 0,
    markActive: 0,
    markEnded: 0,
    markFailed: 0,
  };
  const calls = [];
  const methods = {};
  const client = {
    safeExtraField: 'preserved',
  };

  for (const methodName of PUBLIC_KEYS) {
    methods[methodName] = function lifecycleMethod(callId) {
      calls.push({
        method: methodName,
        callId,
        thisValue: this,
      });
      return Promise.resolve(`${methodName}-accessor-result`);
    };
    Object.defineProperty(client, methodName, {
      enumerable: true,
      get() {
        reads[methodName] += 1;
        if (reads[methodName] > 1) {
          throw new Error(`second read secret ${methodName}`);
        }
        return methods[methodName];
      },
    });
  }

  return {
    calls,
    client,
    methods,
    reads,
  };
}

test('dependency validation rejects every invalid dependency shape', () => {
  const validSpy = createClientSpy();
  const validClient = validSpy.client;
  const invalidDependencies = [
    undefined,
    null,
    'dependency',
    42,
    true,
    [],
    {},
    { client: null },
    { enabled: 'true', client: validClient },
    { enabled: false, client: validClient },
    { enabled: false },
    { enabled: true },
    { enabled: true, client: null },
    { enabled: true, client: 'client' },
    { enabled: true, client: 42 },
    { enabled: true, client: [] },
  ];

  for (const methodName of PUBLIC_KEYS) {
    const missingMethodClient = {
      ...validClient,
    };
    delete missingMethodClient[methodName];
    invalidDependencies.push({
      enabled: true,
      client: missingMethodClient,
    });

    invalidDependencies.push({
      enabled: true,
      client: {
        ...validClient,
        [methodName]: 'not-a-function',
      },
    });
  }

  for (const dependency of invalidDependencies) {
    assertDependencyValidationError(() => {
      createRelayInternalCallLifecycleCoordinator({ dependency });
    });
  }

  const enabledGetterSecret = 'secret dependency enabled getter';
  const enabledGetterDependency = {};
  Object.defineProperty(enabledGetterDependency, 'enabled', {
    get() {
      throw new Error(enabledGetterSecret);
    },
  });

  const clientGetterSecret = 'secret dependency client getter';
  const clientGetterDependency = {
    enabled: true,
  };
  Object.defineProperty(clientGetterDependency, 'client', {
    get() {
      throw new Error(clientGetterSecret);
    },
  });

  const getterScenarios = [
    {
      dependency: enabledGetterDependency,
      secret: enabledGetterSecret,
    },
    {
      dependency: clientGetterDependency,
      secret: clientGetterSecret,
    },
  ];
  for (const methodName of PUBLIC_KEYS) {
    const secret = `secret ${methodName} getter`;
    const getterClient = {
      ...validClient,
    };
    Object.defineProperty(getterClient, methodName, {
      get() {
        throw new Error(secret);
      },
    });
    getterScenarios.push({
      dependency: {
        enabled: true,
        client: getterClient,
      },
      secret,
    });
  }

  for (const scenario of getterScenarios) {
    assertDependencyValidationError(() => {
      createRelayInternalCallLifecycleCoordinator({
        dependency: scenario.dependency,
        callId: 'call-getter-error',
      });
    }, [scenario.secret]);
  }
  assert.deepEqual(validSpy.calls, []);
});

test('disabled coordinator is frozen and every method is a safe no-op', async () => {
  const dependency = {
    enabled: false,
    client: null,
  };
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency,
    callId: null,
  });

  assert.equal(Object.isFrozen(coordinator), true);
  assert.deepEqual(Object.keys(coordinator), PUBLIC_KEYS);

  const promises = [
    coordinator.markActive(),
    coordinator.markConnecting(),
    coordinator.markEnded(),
    coordinator.markFailed(),
  ];
  for (const promise of promises) {
    assert.ok(promise instanceof Promise);
    assert.equal(await promise, null);
  }
  assert.deepEqual(dependency, {
    enabled: false,
    client: null,
  });
});

test('enabled coordinator validates callId without calling the client', () => {
  const spy = createClientSpy();
  const dependency = createEnabledDependency(spy.client);
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency,
    callId: 'call-valid',
  });

  assert.equal(Object.isFrozen(coordinator), true);
  assert.deepEqual(Object.keys(coordinator), PUBLIC_KEYS);
  assert.deepEqual(spy.calls, []);

  const invalidCallIds = [
    null,
    undefined,
    '',
    '   ',
    ' leading',
    'trailing ',
    123,
  ];
  for (const callId of invalidCallIds) {
    assert.throws(() => {
      createRelayInternalCallLifecycleCoordinator({
        dependency,
        callId,
      });
    }, (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(error.message, CALL_ID_ERROR_MESSAGE);
      if (typeof callId === 'string' && callId !== '') {
        assert.equal(error.message.includes(callId), false);
      }
      return true;
    });
  }
  assert.deepEqual(spy.calls, []);
});

test('connecting active and ended requests execute in strict serial order', async () => {
  const connectingDeferred = createDeferred();
  const activeDeferred = createDeferred();
  const endedDeferred = createDeferred();
  const spy = createClientSpy({
    markConnecting() {
      return connectingDeferred.promise;
    },
    markActive() {
      return activeDeferred.promise;
    },
    markEnded() {
      return endedDeferred.promise;
    },
  });
  const callId = 'call-serial';
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency: createEnabledDependency(spy.client),
    callId,
  });

  const connectingPromise = coordinator.markConnecting();
  const activePromise = coordinator.markActive();
  const endedPromise = coordinator.markEnded();

  assert.deepEqual(spy.calls, []);
  await flushMicrotasks();
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting']
  );

  connectingDeferred.resolve('connecting-result');
  assert.equal(await connectingPromise, 'connecting-result');
  await flushMicrotasks();
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting', 'markActive']
  );

  activeDeferred.resolve('active-result');
  assert.equal(await activePromise, 'active-result');
  await flushMicrotasks();
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting', 'markActive', 'markEnded']
  );

  endedDeferred.resolve('ended-result');
  assert.equal(await endedPromise, 'ended-result');
  assert.deepEqual(
    spy.calls.map((call) => call.callId),
    [callId, callId, callId]
  );
});

test('duplicate accepted states return the original Promise exactly once', async () => {
  for (const methodName of PUBLIC_KEYS) {
    const spy = createClientSpy();
    const coordinator = createRelayInternalCallLifecycleCoordinator({
      dependency: createEnabledDependency(spy.client),
      callId: `call-duplicate-${methodName}`,
    });

    const first = coordinator[methodName]();
    const second = coordinator[methodName]();

    assert.equal(first, second);
    await first;
    assert.deepEqual(
      spy.calls.map((call) => call.method),
      [methodName]
    );
  }
});

test('rollback is a no-op while accepted duplicate states reuse Promises', async () => {
  const spy = createClientSpy();
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency: createEnabledDependency(spy.client),
    callId: 'call-no-rollback',
  });

  const connectingPromise = coordinator.markConnecting();
  assert.equal(coordinator.markConnecting(), connectingPromise);
  const activePromise = coordinator.markActive();
  assert.equal(coordinator.markActive(), activePromise);
  const rollbackPromise = coordinator.markConnecting();

  assert.notEqual(rollbackPromise, connectingPromise);
  assert.equal(await rollbackPromise, null);
  assert.equal(await connectingPromise, 'connecting');
  assert.equal(await activePromise, 'active');
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting', 'markActive']
  );
});

test('ended wins the first terminal race and blocks every later state', async () => {
  const spy = createClientSpy();
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency: createEnabledDependency(spy.client),
    callId: 'call-ended-wins',
  });

  const connectingPromise = coordinator.markConnecting();
  const endedPromise = coordinator.markEnded();
  const failedPromise = coordinator.markFailed();
  const activePromise = coordinator.markActive();

  assert.equal(coordinator.markEnded(), endedPromise);
  assert.equal(await failedPromise, null);
  assert.equal(await activePromise, null);
  await connectingPromise;
  await endedPromise;
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting', 'markEnded']
  );
});

test('failed wins the first terminal race and blocks every later state', async () => {
  const spy = createClientSpy();
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency: createEnabledDependency(spy.client),
    callId: 'call-failed-wins',
  });

  const failedPromise = coordinator.markFailed();
  const endedPromise = coordinator.markEnded();
  const connectingPromise = coordinator.markConnecting();
  const activePromise = coordinator.markActive();

  assert.equal(coordinator.markFailed(), failedPromise);
  assert.equal(await endedPromise, null);
  assert.equal(await connectingPromise, null);
  assert.equal(await activePromise, null);
  assert.equal(await failedPromise, 'failed');
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markFailed']
  );
});

test('a rejected request preserves its error and the queue continues', async () => {
  const originalError = new Error('original connecting failure');
  const connectingDeferred = createDeferred();
  const activeDeferred = createDeferred();
  const endedDeferred = createDeferred();
  const spy = createClientSpy({
    markConnecting() {
      return connectingDeferred.promise;
    },
    markActive() {
      return activeDeferred.promise;
    },
    markEnded() {
      return endedDeferred.promise;
    },
  });
  const coordinator = createRelayInternalCallLifecycleCoordinator({
    dependency: createEnabledDependency(spy.client),
    callId: 'call-rejection',
  });

  const connectingPromise = coordinator.markConnecting();
  const activePromise = coordinator.markActive();
  const endedPromise = coordinator.markEnded();

  await flushMicrotasks();
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting']
  );

  connectingDeferred.reject(originalError);
  await assert.rejects(connectingPromise, (receivedError) => {
    assert.equal(receivedError, originalError);
    return true;
  });
  await flushMicrotasks();
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting', 'markActive']
  );

  activeDeferred.resolve('active-after-rejection');
  assert.equal(await activePromise, 'active-after-rejection');
  await flushMicrotasks();
  assert.deepEqual(
    spy.calls.map((call) => call.method),
    ['markConnecting', 'markActive', 'markEnded']
  );

  endedDeferred.resolve('ended-after-rejection');
  assert.equal(await endedPromise, 'ended-after-rejection');
  assert.equal(
    spy.calls.filter((call) => call.method === 'markConnecting').length,
    1
  );
});

test('dependency and client stay intact private and directly bound', async () => {
  const callId = 'call-original-reference';
  const spy = createClientSpy();
  spy.client.safeExtraField = 'preserved';
  Object.freeze(spy.client);
  const dependency = Object.freeze({
    enabled: true,
    client: spy.client,
  });
  const dependencyKeys = Object.keys(dependency);
  const clientKeys = Object.keys(spy.client);

  const mainCoordinator = createRelayInternalCallLifecycleCoordinator({
    dependency,
    callId,
  });
  const failedCoordinator = createRelayInternalCallLifecycleCoordinator({
    dependency,
    callId,
  });
  await mainCoordinator.markConnecting();
  await mainCoordinator.markActive();
  await mainCoordinator.markEnded();
  await failedCoordinator.markFailed();

  assert.deepEqual(Object.keys(dependency), dependencyKeys);
  assert.deepEqual(Object.keys(spy.client), clientKeys);
  assert.equal(dependency.client, spy.client);
  assert.equal(spy.client.safeExtraField, 'preserved');
  for (const call of spy.calls) {
    assert.equal(call.thisValue, spy.client);
    assert.equal(call.callId, callId);
  }
  for (const coordinator of [mainCoordinator, failedCoordinator]) {
    assert.deepEqual(Object.keys(coordinator), PUBLIC_KEYS);
    for (const privateKey of [
      'state',
      'terminalState',
      'tail',
      'requests',
      'callId',
      'dependency',
      'client',
      'enabled',
    ]) {
      assert.equal(Object.hasOwn(coordinator, privateKey), false);
    }
  }
  assert.deepEqual(Object.keys(coordinatorModule), [
    'createRelayInternalCallLifecycleCoordinator',
  ]);

  const accessorCallId = 'call-accessor-reference';
  const mainAccessor = createSingleReadAccessorClient();
  const failedAccessor = createSingleReadAccessorClient();
  Object.freeze(mainAccessor.client);
  Object.freeze(failedAccessor.client);
  const mainAccessorCoordinator =
    createRelayInternalCallLifecycleCoordinator({
      dependency: Object.freeze({
        enabled: true,
        client: mainAccessor.client,
      }),
      callId: accessorCallId,
    });
  const failedAccessorCoordinator =
    createRelayInternalCallLifecycleCoordinator({
      dependency: Object.freeze({
        enabled: true,
        client: failedAccessor.client,
      }),
      callId: accessorCallId,
    });

  let accessorSynchronousError = null;
  let accessorConnectingPromise;
  try {
    accessorConnectingPromise =
      mainAccessorCoordinator.markConnecting();
  } catch (error) {
    accessorSynchronousError = error;
  }
  assert.equal(accessorSynchronousError, null);
  assert.ok(accessorConnectingPromise instanceof Promise);
  assert.equal(
    mainAccessorCoordinator.markConnecting(),
    accessorConnectingPromise
  );
  const accessorActivePromise = mainAccessorCoordinator.markActive();
  const accessorEndedPromise = mainAccessorCoordinator.markEnded();
  const accessorFailedPromise = failedAccessorCoordinator.markFailed();
  for (const promise of [
    accessorActivePromise,
    accessorEndedPromise,
    accessorFailedPromise,
  ]) {
    assert.ok(promise instanceof Promise);
  }
  assert.equal(
    await accessorConnectingPromise,
    'markConnecting-accessor-result'
  );
  assert.equal(
    await accessorActivePromise,
    'markActive-accessor-result'
  );
  assert.equal(
    await accessorEndedPromise,
    'markEnded-accessor-result'
  );
  assert.equal(
    await accessorFailedPromise,
    'markFailed-accessor-result'
  );

  for (const accessor of [mainAccessor, failedAccessor]) {
    assert.deepEqual(accessor.reads, {
      markConnecting: 1,
      markActive: 1,
      markEnded: 1,
      markFailed: 1,
    });
    for (const call of accessor.calls) {
      assert.equal(call.thisValue, accessor.client);
      assert.equal(call.callId, accessorCallId);
    }
  }
  assert.deepEqual(
    mainAccessor.calls.map((call) => call.method),
    ['markConnecting', 'markActive', 'markEnded']
  );
  assert.deepEqual(
    failedAccessor.calls.map((call) => call.method),
    ['markFailed']
  );

  let swappingGetterReads = 0;
  let functionACalls = 0;
  let functionBCalls = 0;
  let functionAThis;
  let functionACallId;
  const functionA = function functionA(callIdValue) {
    functionACalls += 1;
    functionAThis = this;
    functionACallId = callIdValue;
    return Promise.resolve('function-a-result');
  };
  const functionB = function functionB() {
    functionBCalls += 1;
    return Promise.resolve('function-b-result');
  };
  const swappingClient = {
    get markConnecting() {
      swappingGetterReads += 1;
      return swappingGetterReads === 1 ? functionA : functionB;
    },
    markActive() {
      return Promise.resolve('active');
    },
    markEnded() {
      return Promise.resolve('ended');
    },
    markFailed() {
      return Promise.resolve('failed');
    },
  };
  const swappingCallId = 'call-cached-function';
  const swappingCoordinator =
    createRelayInternalCallLifecycleCoordinator({
      dependency: {
        enabled: true,
        client: swappingClient,
      },
      callId: swappingCallId,
    });
  let swappingSynchronousError = null;
  let swappingPromise;
  try {
    swappingPromise = swappingCoordinator.markConnecting();
  } catch (error) {
    swappingSynchronousError = error;
  }
  assert.equal(swappingSynchronousError, null);
  assert.ok(swappingPromise instanceof Promise);
  assert.equal(swappingCoordinator.markConnecting(), swappingPromise);
  assert.equal(await swappingPromise, 'function-a-result');
  assert.equal(swappingGetterReads, 1);
  assert.equal(functionACalls, 1);
  assert.equal(functionBCalls, 0);
  assert.equal(functionAThis, swappingClient);
  assert.equal(functionACallId, swappingCallId);

  const sourcePath = path.join(
    __dirname,
    '..',
    'relay_internal_call_lifecycle_coordinator.js'
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const forbiddenPattern = new RegExp(
    'console\\.(?:log|error|warn|debug)|process\\.(?:stdout|stderr)'
    + '|fetch\\s*\\(|Authorization|Bearer|BUSINESS_INTERNAL_API_TOKEN'
    + '|BUSINESS_BACKEND_INTERNAL_BASE_URL'
  );
  assert.equal(forbiddenPattern.test(source), false);
});
