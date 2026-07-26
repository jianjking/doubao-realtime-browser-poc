'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LIFECYCLE_BOOTSTRAP_MODULE = require(
  '../relay_internal_call_lifecycle_bootstrap'
);
const LIFECYCLE_COORDINATOR_MODULE = require(
  '../relay_internal_call_lifecycle_coordinator'
);

const PROJECT_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(PROJECT_DIR, 'server_doubao_realtime.js');
const SNAPSHOT_SERVER_PATH = path.join(
  PROJECT_DIR,
  'stable_snapshots',
  'doubao_yuhuang_sunwukong_product_v1_2026-07-24',
  'server_doubao_realtime.js'
);

const ROLE_MATRIX = Object.freeze([
  {
    key: 'yuhuang',
    functionName: 'Yuhuang',
    displayName: '玉皇大帝',
    enableName: null,
    speakerName: 'DOUBAO_REALTIME_SPEAKER_ID',
    speakerId: 'S_ViUfvBA92',
  },
  {
    key: 'sunwukong',
    functionName: 'Sunwukong',
    displayName: '孙悟空',
    enableName: 'DOUBAO_ENABLE_SUNWUKONG',
    speakerName: 'DOUBAO_SUNWUKONG_SPEAKER_ID',
    speakerId: 'S_UiUfvBA92',
  },
  {
    key: 'guanyin',
    functionName: 'Guanyin',
    displayName: '观音菩萨',
    enableName: 'DOUBAO_ENABLE_GUANYIN',
    speakerName: 'DOUBAO_GUANYIN_SPEAKER_ID',
    speakerId: 'S_TiUfvBA92',
  },
  {
    key: 'caishen',
    functionName: 'Caishen',
    displayName: '财神爷',
    enableName: 'DOUBAO_ENABLE_CAISHEN',
    speakerName: 'DOUBAO_CAISHEN_SPEAKER_ID',
    speakerId: 'S_SiUfvBA92',
  },
  {
    key: 'rulai',
    functionName: 'Rulai',
    displayName: '如来佛祖',
    enableName: 'DOUBAO_ENABLE_RULAI',
    speakerName: 'DOUBAO_RULAI_SPEAKER_ID',
    speakerId: 'S_RiUfvBA92',
  },
  {
    key: 'zhubajie',
    functionName: 'Zhubajie',
    displayName: '猪八戒',
    enableName: 'DOUBAO_ENABLE_ZHUBAJIE',
    speakerName: 'DOUBAO_ZHUBAJIE_SPEAKER_ID',
    speakerId: 'S_PiUfvBA92',
  },
  {
    key: 'shawujing',
    functionName: 'Shawujing',
    displayName: '沙悟净',
    enableName: 'DOUBAO_ENABLE_SHAWUJING',
    speakerName: 'DOUBAO_SHAWUJING_SPEAKER_ID',
    speakerId: 'S_OiUfvBA92',
  },
  {
    key: 'tangseng',
    functionName: 'Tangseng',
    displayName: '唐僧',
    enableName: 'DOUBAO_ENABLE_TANGSENG',
    speakerName: 'DOUBAO_TANGSENG_SPEAKER_ID',
    speakerId: 'S_NiUfvBA92',
  },
]);

const NEW_ROLES = ROLE_MATRIX.slice(2);
const EVENT = Object.freeze({
  START_CONNECTION: 1,
  CONNECTION_STARTED: 2,
  START_SESSION: 3,
  SESSION_STARTED: 4,
  CONNECTION_FAILED: 90,
  SESSION_FAILED: 91,
  DIALOG_COMMON_ERROR: 92,
});
const INVALID_BUSINESS_CALL_ID_MESSAGE =
  'Invalid business call identifier';
const CONFLICTING_BROWSER_HELLO_MESSAGE =
  'Conflicting browser.hello';
let businessCallIdScenarioCount = 0;

function createEnabledEnvironment() {
  const environment = {
    VOLCENGINE_API_KEY: 'local-vm-test-key',
  };
  for (const role of ROLE_MATRIX) {
    if (role.enableName) {
      environment[role.enableName] = '1';
    }
    environment[role.speakerName] = role.speakerId;
  }
  return environment;
}

function instrumentServerSource() {
  let source = fs.readFileSync(SERVER_PATH, 'utf8');
  for (const role of NEW_ROLES) {
    source = source.replace(
      `function build${role.functionName}SystemPrompt() {`,
      `function build${role.functionName}SystemPrompt() {\n`
        + `  globalThis.__promptCalls.${role.key} += 1;`
    );
    source = source.replace(
      `function resolve${role.functionName}SpeakerId() {`,
      `function resolve${role.functionName}SpeakerId() {\n`
        + `  globalThis.__speakerCalls.${role.key} += 1;`
    );
  }
  source = source.replace(
    /\nstartServer\(\);\s*$/,
    `\nglobalThis.__serverTestExports = {
      CHARACTER_CONFIGS,
      buildStartSessionPayload,
      handleBrowserConnection,
      resolveCharacterConfig,
    };\n`
  );
  return source;
}

function createRuntime(environment) {
  const coordinatorFactoryCalls = [];
  const encodedEvents = [];
  const upstreamInstances = [];
  const logs = [];
  const promptCalls = Object.fromEntries(
    NEW_ROLES.map((role) => [role.key, 0])
  );
  const speakerCalls = Object.fromEntries(
    NEW_ROLES.map((role) => [role.key, 0])
  );

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
      this.readyState = FakeUpstreamWebSocket.CLOSED;
      const handler = this.handlers.get('close');
      if (handler) {
        handler(code, Buffer.from(reason));
      }
    }

    terminate() {
      this.terminateCalls += 1;
      this.readyState = FakeUpstreamWebSocket.CLOSED;
    }

    emitOpen() {
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
      return Buffer.from([eventId]);
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
    __promptCalls: promptCalls,
    __speakerCalls: speakerCalls,
    clearTimeout,
    console: {
      log(message) {
        logs.push(String(message));
      },
    },
    process: {
      env: {
        ...environment,
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
          WebSocketServer: class {},
        };
      }
      if (moduleName === './doubao_protocol.js') {
        return protocol;
      }
      if (moduleName === './relay_internal_call_lifecycle_bootstrap') {
        return LIFECYCLE_BOOTSTRAP_MODULE;
      }
      if (moduleName === './relay_internal_call_lifecycle_coordinator') {
        return {
          createRelayInternalCallLifecycleCoordinator(options) {
            const realCoordinator = LIFECYCLE_COORDINATOR_MODULE
              .createRelayInternalCallLifecycleCoordinator(options);
            const coordinatorMethodCalls = createLifecycleCalls();
            const coordinator = Object.freeze({
              markConnecting() {
                coordinatorMethodCalls.markConnecting += 1;
                return realCoordinator.markConnecting();
              },
              markActive() {
                coordinatorMethodCalls.markActive += 1;
                return realCoordinator.markActive();
              },
              markEnded() {
                coordinatorMethodCalls.markEnded += 1;
                return realCoordinator.markEnded();
              },
              markFailed() {
                coordinatorMethodCalls.markFailed += 1;
                return realCoordinator.markFailed();
              },
            });
            coordinatorFactoryCalls.push({
              dependency: options.dependency,
              callId: options.callId,
              realCoordinator,
              coordinator,
              coordinatorMethodCalls,
            });
            return coordinator;
          },
        };
      }
      throw new Error(`unexpected require: ${moduleName}`);
    },
    setTimeout,
  };

  vm.runInNewContext(instrumentServerSource(), context, {
    filename: SERVER_PATH,
  });

  return {
    coordinatorFactoryCalls,
    encodedEvents,
    exports: context.__serverTestExports,
    logs,
    promptCalls,
    speakerCalls,
    upstreamInstances,
  };
}

class FakeBrowserSocket {
  constructor() {
    this.readyState = 1;
    this.handlers = new Map();
    this.sent = [];
    this.closeCalls = 0;
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
    this.handlers.get('close')(code);
  }
}

function createBrowserConnection(
  runtime,
  internalCallLifecycleDependency
) {
  const browserSocket = new FakeBrowserSocket();
  const contexts = new Set();
  const request = {
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
  if (internalCallLifecycleDependency === undefined) {
    runtime.exports.handleBrowserConnection(
      browserSocket,
      request,
      contexts
    );
  } else {
    runtime.exports.handleBrowserConnection(
      browserSocket,
      request,
      contexts,
      internalCallLifecycleDependency
    );
  }
  assert.equal(contexts.size, 1);
  const context = [...contexts][0];
  assert.equal(context.businessCallId, null);
  assert.equal(context.internalCallLifecycleCoordinator, null);
  if (internalCallLifecycleDependency === undefined) {
    assert.equal(
      context.internalCallLifecycleDependency.enabled,
      false
    );
    assert.equal(
      context.internalCallLifecycleDependency.client,
      null
    );
    assert.equal(
      Object.isFrozen(context.internalCallLifecycleDependency),
      true
    );
  } else {
    assert.equal(
      context.internalCallLifecycleDependency,
      internalCallLifecycleDependency
    );
  }
  return {
    browserSocket,
    context,
    contexts,
  };
}

function createLifecycleCalls() {
  return {
    markConnecting: 0,
    markActive: 0,
    markEnded: 0,
    markFailed: 0,
  };
}

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

function assertLifecycleCalls(lifecycleCalls, expectedMarkConnecting) {
  assert.deepEqual(lifecycleCalls, {
    markConnecting: expectedMarkConnecting,
    markActive: 0,
    markEnded: 0,
    markFailed: 0,
  });
}

function countBrowserMessages(browserSocket, type) {
  return browserSocket.sent.filter((message) => message.type === type).length;
}

async function completeBasicSession(connection, runtime) {
  const relayErrorCount = countBrowserMessages(
    connection.browserSocket,
    'relay.error'
  );
  const upstream = runtime.upstreamInstances[0];
  upstream.emitOpen();
  upstream.emitFrame({
    eventId: EVENT.CONNECTION_STARTED,
    eventName: 'ConnectionStarted',
    json: {},
    messageType: 1,
    payload: Buffer.alloc(0),
  });
  upstream.emitFrame({
    eventId: EVENT.SESSION_STARTED,
    eventName: 'SessionStarted',
    json: {},
    messageType: 1,
    payload: Buffer.alloc(0),
    sessionId: connection.context.sessionId,
  });
  connection.browserSocket.emitJson({
    type: 'browser.audio_start',
    format: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
    inputSampleRate: 48000,
  });
  connection.browserSocket.handlers.get('message')(
    Buffer.alloc(640),
    true
  );
  connection.browserSocket.emitJson({
    type: 'browser.audio_stop',
  });
  assert.equal(
    countBrowserMessages(connection.browserSocket, 'relay.error'),
    relayErrorCount
  );
  connection.browserSocket.emitClose();
  await connection.context.closePromise;
  await Promise.resolve();
  assert.equal(upstream.readyState, 3);
  assert.equal(upstream.closeCalls + upstream.terminateCalls, 1);
  assert.equal(connection.contexts.has(connection.context), false);
  return upstream;
}

async function verifyLifecycleConnectionPair(callIds) {
  const lifecycleCalls = createLifecycleCalls();
  const receivedCallIds = [];
  const dependency = Object.freeze({
    enabled: true,
    client: Object.freeze({
      markConnecting(callId) {
        lifecycleCalls.markConnecting += 1;
        receivedCallIds.push(callId);
      },
      markActive() {
        lifecycleCalls.markActive += 1;
      },
      markEnded() {
        lifecycleCalls.markEnded += 1;
      },
      markFailed() {
        lifecycleCalls.markFailed += 1;
      },
    }),
  });
  const runtime = createRuntime(createEnabledEnvironment());
  const firstConnection = createBrowserConnection(runtime, dependency);
  const secondConnection = createBrowserConnection(runtime, dependency);
  firstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: callIds[0],
  });
  secondConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'sunwukong',
    callId: callIds[1],
  });
  assert.equal(runtime.coordinatorFactoryCalls.length, 2);
  assert.notStrictEqual(
    runtime.coordinatorFactoryCalls[0].coordinator,
    runtime.coordinatorFactoryCalls[1].coordinator
  );
  for (const coordinatorCall of runtime.coordinatorFactoryCalls) {
    assertLifecycleCalls(coordinatorCall.coordinatorMethodCalls, 1);
  }
  assertLifecycleCalls(lifecycleCalls, 0);
  assert.equal(runtime.upstreamInstances.length, 2);
  assert.equal(
    countBrowserMessages(firstConnection.browserSocket, 'relay.hello_ack'),
    1
  );
  assert.equal(
    countBrowserMessages(secondConnection.browserSocket, 'relay.hello_ack'),
    1
  );
  await Promise.resolve();
  for (const coordinatorCall of runtime.coordinatorFactoryCalls) {
    assertLifecycleCalls(coordinatorCall.coordinatorMethodCalls, 1);
  }
  assertLifecycleCalls(lifecycleCalls, 2);
  assert.deepEqual(receivedCallIds, callIds);
}

async function verifyLifecycleDependencyInjection() {
  const lifecycleCalls = createLifecycleCalls();
  const connectingCallIds = [];
  const lifecycleLeakMarker = 'relay-lifecycle-private-marker';
  const injectedDependency = Object.freeze({
    enabled: true,
    lifecycleLeakMarker,
    client: Object.freeze({
      lifecycleLeakMarker,
      markConnecting(callId) {
        lifecycleCalls.markConnecting += 1;
        connectingCallIds.push(callId);
      },
      markActive() {
        lifecycleCalls.markActive += 1;
      },
      markEnded() {
        lifecycleCalls.markEnded += 1;
      },
      markFailed() {
        lifecycleCalls.markFailed += 1;
      },
    }),
  });

  const initialRuntime = createRuntime(createEnabledEnvironment());
  const initialConnection = createBrowserConnection(
    initialRuntime,
    injectedDependency
  );
  assert.equal(initialConnection.context.businessCallId, null);
  assert.equal(
    initialConnection.context.internalCallLifecycleCoordinator,
    null
  );
  assert.equal(initialRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(initialRuntime.upstreamInstances.length, 0);

  const noIdRuntime = createRuntime(createEnabledEnvironment());
  const noIdConnection = createBrowserConnection(
    noIdRuntime,
    injectedDependency
  );
  noIdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
  });
  assert.deepEqual(
    noIdConnection.browserSocket.sent[
      noIdConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.hello_ack',
      received: true,
    }
  );
  assert.equal(noIdConnection.context.businessCallId, null);
  assert.equal(
    noIdConnection.context.internalCallLifecycleCoordinator,
    null
  );
  assert.equal(noIdRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(noIdRuntime.upstreamInstances.length, 1);
  assertLifecycleCalls(lifecycleCalls, 0);
  await completeBasicSession(noIdConnection, noIdRuntime);
  assert.equal(noIdRuntime.coordinatorFactoryCalls.length, 0);
  assertLifecycleCalls(lifecycleCalls, 0);

  const disabledDependency = Object.freeze({
    enabled: false,
    client: null,
  });
  const disabledRuntime = createRuntime(createEnabledEnvironment());
  const disabledConnection = createBrowserConnection(
    disabledRuntime,
    disabledDependency
  );
  const disabledCallId = 'call-disabled-lifecycle';
  disabledConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: disabledCallId,
  });
  const disabledCoordinator =
    disabledConnection.context.internalCallLifecycleCoordinator;
  assert.equal(disabledConnection.context.businessCallId, disabledCallId);
  assert.equal(disabledRuntime.coordinatorFactoryCalls.length, 1);
  assert.equal(
    disabledRuntime.coordinatorFactoryCalls[0].dependency,
    disabledDependency
  );
  assert.equal(
    disabledRuntime.coordinatorFactoryCalls[0].callId,
    disabledCallId
  );
  assert.equal(
    disabledRuntime.coordinatorFactoryCalls[0].coordinator,
    disabledCoordinator
  );
  assert.equal(Object.isFrozen(disabledCoordinator), true);
  for (const methodName of Object.keys(lifecycleCalls)) {
    assert.equal(typeof disabledCoordinator[methodName], 'function');
  }
  assert.equal(disabledRuntime.upstreamInstances.length, 1);
  assert.deepEqual(
    disabledConnection.browserSocket.sent[
      disabledConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.hello_ack',
      received: true,
    }
  );
  assertLifecycleCalls(lifecycleCalls, 0);
  assertLifecycleCalls(
    disabledRuntime.coordinatorFactoryCalls[0].coordinatorMethodCalls,
    1
  );
  assert.equal(
    disabledRuntime.logs.some(
      (message) => message.includes('connecting 状态上报失败')
    ),
    false
  );

  const pendingLifecycleCalls = createLifecycleCalls();
  const pendingCallIds = [];
  const connectingDeferred = createDeferred();
  let connectingSettled = false;
  void connectingDeferred.promise.then(() => {
    connectingSettled = true;
  });
  const pendingDependency = Object.freeze({
    enabled: true,
    client: Object.freeze({
      markConnecting(callId) {
        pendingLifecycleCalls.markConnecting += 1;
        pendingCallIds.push(callId);
        return connectingDeferred.promise;
      },
      markActive() {
        pendingLifecycleCalls.markActive += 1;
      },
      markEnded() {
        pendingLifecycleCalls.markEnded += 1;
      },
      markFailed() {
        pendingLifecycleCalls.markFailed += 1;
      },
    }),
  });
  const pendingRuntime = createRuntime(createEnabledEnvironment());
  const pendingConnection = createBrowserConnection(
    pendingRuntime,
    pendingDependency
  );
  const pendingCallId = 'call-pending-connecting';
  pendingConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: pendingCallId,
  });
  assert.equal(pendingRuntime.coordinatorFactoryCalls.length, 1);
  const pendingCoordinatorCall =
    pendingRuntime.coordinatorFactoryCalls[0];
  assertLifecycleCalls(pendingCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(pendingLifecycleCalls, 0);
  assert.equal(
    countBrowserMessages(
      pendingConnection.browserSocket,
      'relay.hello_ack'
    ),
    1
  );
  assert.equal(pendingRuntime.upstreamInstances.length, 1);
  assert.equal(pendingConnection.context.characterResolved, true);
  assert.equal(pendingConnection.context.businessCallId, pendingCallId);
  assert.equal(
    pendingConnection.context.internalCallLifecycleCoordinator,
    pendingCoordinatorCall.coordinator
  );
  assert.equal(pendingConnection.browserSocket.readyState, 1);
  assert.equal(pendingConnection.browserSocket.closeCalls, 0);
  assert.equal(pendingRuntime.upstreamInstances[0].readyState, 0);
  assert.equal(pendingRuntime.upstreamInstances[0].closeCalls, 0);
  assert.equal(pendingRuntime.upstreamInstances[0].terminateCalls, 0);
  assert.equal(
    countBrowserMessages(pendingConnection.browserSocket, 'relay.error'),
    0
  );
  assert.equal(
    pendingRuntime.logs.some(
      (message) => message.includes('connecting 状态上报失败')
    ),
    false
  );
  assert.equal(connectingSettled, false);
  await Promise.resolve();
  await Promise.resolve();
  assertLifecycleCalls(pendingCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(pendingLifecycleCalls, 1);
  assert.deepEqual(pendingCallIds, [pendingCallId]);
  assert.equal(
    countBrowserMessages(
      pendingConnection.browserSocket,
      'relay.hello_ack'
    ),
    1
  );
  assert.equal(pendingRuntime.upstreamInstances.length, 1);
  assert.equal(pendingConnection.browserSocket.readyState, 1);
  assert.equal(pendingConnection.browserSocket.closeCalls, 0);
  assert.equal(pendingRuntime.upstreamInstances[0].readyState, 0);
  assert.equal(pendingRuntime.upstreamInstances[0].closeCalls, 0);
  assert.equal(pendingRuntime.upstreamInstances[0].terminateCalls, 0);
  assert.equal(
    countBrowserMessages(pendingConnection.browserSocket, 'relay.error'),
    0
  );
  assert.equal(
    pendingRuntime.logs.some(
      (message) => message.includes('connecting 状态上报失败')
    ),
    false
  );
  assert.equal(connectingSettled, false);
  connectingDeferred.resolve('connecting-finished');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(connectingSettled, true);
  assertLifecycleCalls(pendingCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(pendingLifecycleCalls, 1);
  assert.equal(
    pendingRuntime.logs.some(
      (message) => message.includes('connecting 状态上报失败')
    ),
    false
  );

  const failingFactoryRuntime = createRuntime(
    createEnabledEnvironment()
  );
  const failingFactoryConnection = createBrowserConnection(
    failingFactoryRuntime,
    Object.freeze({
      enabled: true,
      client: null,
    })
  );
  assert.throws(
    () => failingFactoryConnection.browserSocket.emitJson({
      type: 'browser.hello',
      client: 'doubao-browser-poc',
      characterKey: 'yuhuang',
      callId: 'call-failing-factory',
    }),
    TypeError
  );
  assert.equal(failingFactoryConnection.context.businessCallId, null);
  assert.equal(
    failingFactoryConnection.context.internalCallLifecycleCoordinator,
    null
  );
  assert.equal(failingFactoryConnection.context.characterResolved, false);
  assert.equal(failingFactoryConnection.context.characterKey, undefined);
  assert.equal(
    failingFactoryConnection.context.characterDisplayName,
    undefined
  );
  assert.equal(
    failingFactoryConnection.context.characterSystemPrompt,
    undefined
  );
  assert.equal(failingFactoryConnection.context.speakerId, undefined);
  assert.equal(
    failingFactoryConnection.browserSocket.sent.filter(
      (message) => message.type === 'relay.hello_ack'
    ).length,
    0
  );
  assert.equal(failingFactoryRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(failingFactoryRuntime.upstreamInstances.length, 0);

  const runtime = createRuntime(createEnabledEnvironment());
  const firstConnection = createBrowserConnection(
    runtime,
    injectedDependency
  );
  const firstCallId = 'call-enabled-lifecycle';
  firstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: firstCallId,
  });
  const firstCoordinator =
    firstConnection.context.internalCallLifecycleCoordinator;
  assert.equal(
    firstConnection.context.internalCallLifecycleDependency,
    injectedDependency
  );
  assert.equal(firstConnection.context.businessCallId, firstCallId);
  assert.equal(runtime.coordinatorFactoryCalls.length, 1);
  const firstCoordinatorCall = runtime.coordinatorFactoryCalls[0];
  assert.equal(
    firstCoordinatorCall.dependency,
    injectedDependency
  );
  assert.equal(
    firstCoordinatorCall.callId,
    firstCallId
  );
  assert.equal(
    firstCoordinatorCall.coordinator,
    firstCoordinator
  );
  assert.notStrictEqual(
    firstCoordinatorCall.realCoordinator,
    firstCoordinatorCall.coordinator
  );
  assert.equal(Object.isFrozen(firstCoordinatorCall.realCoordinator), true);
  assert.equal(Object.isFrozen(firstCoordinator), true);
  assert.equal(runtime.upstreamInstances.length, 1);
  assert.deepEqual(
    firstConnection.browserSocket.sent[
      firstConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.hello_ack',
      received: true,
    }
  );
  assertLifecycleCalls(firstCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(lifecycleCalls, 0);
  await Promise.resolve();
  assertLifecycleCalls(firstCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(lifecycleCalls, 1);
  assert.deepEqual(connectingCallIds, [firstCallId]);

  firstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: firstCallId,
  });
  assert.equal(runtime.coordinatorFactoryCalls.length, 1);
  assert.equal(
    firstConnection.context.internalCallLifecycleCoordinator,
    firstCoordinator
  );
  assert.equal(firstConnection.context.businessCallId, firstCallId);
  assert.equal(firstConnection.context.characterKey, 'yuhuang');
  assert.equal(runtime.upstreamInstances.length, 1);
  await Promise.resolve();
  assertLifecycleCalls(firstCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(lifecycleCalls, 1);

  firstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: 'call-conflicting-lifecycle',
  });
  assert.deepEqual(
    firstConnection.browserSocket.sent[
      firstConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(runtime.coordinatorFactoryCalls.length, 1);
  assert.equal(
    firstConnection.context.internalCallLifecycleCoordinator,
    firstCoordinator
  );
  assert.equal(firstConnection.context.businessCallId, firstCallId);
  assert.equal(runtime.upstreamInstances.length, 1);
  assertLifecycleCalls(firstCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(lifecycleCalls, 1);

  firstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'sunwukong',
    callId: firstCallId,
  });
  assert.deepEqual(
    firstConnection.browserSocket.sent[
      firstConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(runtime.coordinatorFactoryCalls.length, 1);
  assert.equal(
    firstConnection.context.internalCallLifecycleCoordinator,
    firstCoordinator
  );
  assert.equal(firstConnection.context.businessCallId, firstCallId);
  assert.equal(firstConnection.context.characterKey, 'yuhuang');
  assert.equal(runtime.upstreamInstances.length, 1);
  assertLifecycleCalls(firstCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(lifecycleCalls, 1);

  const invalidRoleRuntime = createRuntime(createEnabledEnvironment());
  const invalidRoleConnection = createBrowserConnection(
    invalidRoleRuntime,
    injectedDependency
  );
  invalidRoleConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'unknown-role',
    callId: 'call-invalid-role',
  });
  assert.equal(invalidRoleRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(invalidRoleConnection.context.businessCallId, null);
  assert.equal(
    invalidRoleConnection.context.internalCallLifecycleCoordinator,
    null
  );
  assert.equal(invalidRoleRuntime.upstreamInstances.length, 0);
  assertLifecycleCalls(lifecycleCalls, 1);

  const invalidCallIdRuntime = createRuntime(createEnabledEnvironment());
  const invalidCallIdConnection = createBrowserConnection(
    invalidCallIdRuntime,
    injectedDependency
  );
  invalidCallIdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: ' invalid-call-id',
  });
  assert.deepEqual(
    invalidCallIdConnection.browserSocket.sent[
      invalidCallIdConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.error',
      message: INVALID_BUSINESS_CALL_ID_MESSAGE,
    }
  );
  assert.equal(invalidCallIdRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(invalidCallIdConnection.context.businessCallId, null);
  assert.equal(
    invalidCallIdConnection.context.internalCallLifecycleCoordinator,
    null
  );
  assert.equal(invalidCallIdRuntime.upstreamInstances.length, 0);
  assertLifecycleCalls(lifecycleCalls, 1);

  const disabledRoleEnvironment = createEnabledEnvironment();
  disabledRoleEnvironment.DOUBAO_ENABLE_GUANYIN = '0';
  const invalidLifecycleScenarios = [
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.invalid',
        client: 'doubao-browser-poc',
        characterKey: 'yuhuang',
        callId: 'call-invalid-type',
      },
    },
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.hello',
        client: 'invalid-client',
        characterKey: 'yuhuang',
        callId: 'call-invalid-client',
      },
    },
    {
      environment: disabledRoleEnvironment,
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'guanyin',
        callId: 'call-disabled-role',
      },
    },
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'yuhuang',
        callId: null,
      },
    },
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'yuhuang',
        callId: '',
      },
    },
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'yuhuang',
        callId: 'trailing-call-id ',
      },
    },
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'yuhuang',
        callId: 'unsafe\u0000control',
      },
    },
    {
      environment: createEnabledEnvironment(),
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'yuhuang',
        callId: 'x'.repeat(129),
      },
    },
  ];
  for (const scenario of invalidLifecycleScenarios) {
    const invalidRuntime = createRuntime(scenario.environment);
    const invalidConnection = createBrowserConnection(
      invalidRuntime,
      injectedDependency
    );
    invalidConnection.browserSocket.emitJson(scenario.message);
    assert.equal(invalidRuntime.coordinatorFactoryCalls.length, 0);
    assert.equal(invalidConnection.context.characterResolved, false);
    assert.equal(invalidConnection.context.businessCallId, null);
    assert.equal(
      invalidConnection.context.internalCallLifecycleCoordinator,
      null
    );
    assert.equal(
      countBrowserMessages(
        invalidConnection.browserSocket,
        'relay.hello_ack'
      ),
      0
    );
    assert.equal(invalidRuntime.upstreamInstances.length, 0);
    assertLifecycleCalls(lifecycleCalls, 1);
  }

  const lateIdRuntime = createRuntime(createEnabledEnvironment());
  const lateIdConnection = createBrowserConnection(
    lateIdRuntime,
    injectedDependency
  );
  lateIdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
  });
  lateIdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: 'call-added-later',
  });
  assert.deepEqual(
    lateIdConnection.browserSocket.sent[
      lateIdConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(lateIdRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(lateIdConnection.context.businessCallId, null);
  assert.equal(
    lateIdConnection.context.internalCallLifecycleCoordinator,
    null
  );
  assert.equal(lateIdRuntime.upstreamInstances.length, 1);
  assertLifecycleCalls(lifecycleCalls, 1);

  await verifyLifecycleConnectionPair([
    'call-pair-different-first',
    'call-pair-different-second',
  ]);
  await verifyLifecycleConnectionPair([
    'call-pair-shared',
    'call-pair-shared',
  ]);
  assertLifecycleCalls(lifecycleCalls, 1);

  const isolationRuntime = createRuntime(createEnabledEnvironment());
  const isolatedFirstConnection = createBrowserConnection(
    isolationRuntime,
    injectedDependency
  );
  const isolatedSecondConnection = createBrowserConnection(
    isolationRuntime,
    injectedDependency
  );
  const isolatedThirdConnection = createBrowserConnection(
    isolationRuntime,
    injectedDependency
  );
  const sharedCallId = 'call-shared-across-connections';
  const differentCallId = 'call-different-across-connections';
  isolatedFirstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: sharedCallId,
  });
  isolatedSecondConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'sunwukong',
    callId: differentCallId,
  });
  isolatedThirdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'guanyin',
    callId: sharedCallId,
  });
  assert.equal(isolationRuntime.coordinatorFactoryCalls.length, 3);
  for (const coordinatorCall of isolationRuntime.coordinatorFactoryCalls) {
    assertLifecycleCalls(coordinatorCall.coordinatorMethodCalls, 1);
  }
  assertLifecycleCalls(lifecycleCalls, 1);
  assert.equal(
    isolatedFirstConnection.context.internalCallLifecycleDependency,
    isolatedSecondConnection.context.internalCallLifecycleDependency
  );
  assert.equal(
    isolatedFirstConnection.context.internalCallLifecycleDependency,
    isolatedThirdConnection.context.internalCallLifecycleDependency
  );
  assert.equal(
    isolatedFirstConnection.context.internalCallLifecycleDependency,
    injectedDependency
  );
  assert.notStrictEqual(
    isolatedFirstConnection.context.internalCallLifecycleCoordinator,
    isolatedSecondConnection.context.internalCallLifecycleCoordinator
  );
  assert.notStrictEqual(
    isolatedFirstConnection.context.internalCallLifecycleCoordinator,
    isolatedThirdConnection.context.internalCallLifecycleCoordinator
  );
  assert.notStrictEqual(
    isolatedSecondConnection.context.internalCallLifecycleCoordinator,
    isolatedThirdConnection.context.internalCallLifecycleCoordinator
  );
  assert.equal(
    isolatedFirstConnection.context.internalCallLifecycleCoordinator,
    isolationRuntime.coordinatorFactoryCalls[0].coordinator
  );
  assert.equal(
    isolatedSecondConnection.context.internalCallLifecycleCoordinator,
    isolationRuntime.coordinatorFactoryCalls[1].coordinator
  );
  assert.equal(
    isolatedThirdConnection.context.internalCallLifecycleCoordinator,
    isolationRuntime.coordinatorFactoryCalls[2].coordinator
  );
  assert.equal(
    isolationRuntime.coordinatorFactoryCalls[0].dependency,
    isolationRuntime.coordinatorFactoryCalls[1].dependency
  );
  assert.equal(
    isolationRuntime.coordinatorFactoryCalls[0].callId,
    sharedCallId
  );
  assert.equal(
    isolationRuntime.coordinatorFactoryCalls[1].callId,
    differentCallId
  );
  assert.equal(
    isolationRuntime.coordinatorFactoryCalls[2].callId,
    sharedCallId
  );
  assert.equal(isolationRuntime.upstreamInstances.length, 3);
  for (const connection of [
    isolatedFirstConnection,
    isolatedSecondConnection,
    isolatedThirdConnection,
  ]) {
    assert.equal(
      countBrowserMessages(connection.browserSocket, 'relay.hello_ack'),
      1
    );
  }
  await Promise.resolve();
  for (const coordinatorCall of isolationRuntime.coordinatorFactoryCalls) {
    assertLifecycleCalls(coordinatorCall.coordinatorMethodCalls, 1);
  }
  assertLifecycleCalls(lifecycleCalls, 4);
  assert.deepEqual(connectingCallIds, [
    firstCallId,
    sharedCallId,
    differentCallId,
    sharedCallId,
  ]);
  assert.equal(runtime.upstreamInstances.length, 1);
  await completeBasicSession(firstConnection, runtime);
  assert.equal(
    firstConnection.context.internalCallLifecycleCoordinator,
    firstCoordinator
  );
  assert.equal(
    firstConnection.contexts.has(firstConnection.context),
    false
  );
  assertLifecycleCalls(firstCoordinatorCall.coordinatorMethodCalls, 1);
  assertLifecycleCalls(lifecycleCalls, 4);
  assert.equal(
    connectingCallIds.filter((callId) => callId === firstCallId).length,
    1
  );

  const rejectionCalls = createLifecycleCalls();
  const rejectionSecret = 'SECRET_CONNECTING_FAILURE_94721';
  const rejectionCallId = 'call-rejected-connecting';
  const rejectionCallIds = [];
  const originalRejectionError = new Error(rejectionSecret);
  const rejectionDependency = Object.freeze({
    enabled: true,
    client: Object.freeze({
      markConnecting(callId) {
        rejectionCalls.markConnecting += 1;
        rejectionCallIds.push(callId);
        return Promise.reject(originalRejectionError);
      },
      markActive() {
        rejectionCalls.markActive += 1;
      },
      markEnded() {
        rejectionCalls.markEnded += 1;
      },
      markFailed() {
        rejectionCalls.markFailed += 1;
      },
    }),
  });
  const rejectionRuntime = createRuntime(createEnabledEnvironment());
  const rejectionConnection = createBrowserConnection(
    rejectionRuntime,
    rejectionDependency
  );
  rejectionConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
    callId: rejectionCallId,
  });
  assert.equal(rejectionRuntime.coordinatorFactoryCalls.length, 1);
  const rejectionCoordinatorCall =
    rejectionRuntime.coordinatorFactoryCalls[0];
  assertLifecycleCalls(
    rejectionCoordinatorCall.coordinatorMethodCalls,
    1
  );
  assertLifecycleCalls(rejectionCalls, 0);
  assert.deepEqual(
    rejectionConnection.browserSocket.sent[
      rejectionConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.hello_ack',
      received: true,
    }
  );
  assert.equal(rejectionRuntime.upstreamInstances.length, 1);
  assert.equal(rejectionConnection.browserSocket.readyState, 1);
  assert.equal(rejectionConnection.browserSocket.closeCalls, 0);
  assert.equal(rejectionRuntime.upstreamInstances[0].readyState, 0);
  assert.equal(rejectionRuntime.upstreamInstances[0].closeCalls, 0);
  assert.equal(rejectionRuntime.upstreamInstances[0].terminateCalls, 0);
  assert.equal(
    rejectionConnection.browserSocket.sent.some(
      (message) => message.type === 'relay.error'
    ),
    false
  );
  await new Promise((resolve) => setImmediate(resolve));
  assertLifecycleCalls(
    rejectionCoordinatorCall.coordinatorMethodCalls,
    1
  );
  assertLifecycleCalls(rejectionCalls, 1);
  assert.deepEqual(rejectionCallIds, [rejectionCallId]);
  assert.equal(rejectionConnection.browserSocket.readyState, 1);
  assert.equal(rejectionConnection.browserSocket.closeCalls, 0);
  assert.equal(rejectionRuntime.upstreamInstances[0].readyState, 0);
  assert.equal(rejectionRuntime.upstreamInstances[0].closeCalls, 0);
  assert.equal(rejectionRuntime.upstreamInstances[0].terminateCalls, 0);
  assert.equal(rejectionRuntime.upstreamInstances.length, 1);
  assert.equal(
    countBrowserMessages(rejectionConnection.browserSocket, 'relay.error'),
    0
  );
  assert.equal(
    rejectionRuntime.logs.filter(
      (message) => (
        message.includes(
          '[Relay] 内部 Call 生命周期 connecting 状态上报失败'
        )
      )
    ).length,
    1
  );
  const visibleRejectionLogs = rejectionRuntime.logs.join('\n');
  for (const forbiddenValue of [
    rejectionSecret,
    rejectionCallId,
    originalRejectionError.stack,
    'Authorization',
    'Bearer',
    'token',
    'http://',
    'https://',
    'URL',
    'base URL',
    'HTTP response',
  ]) {
    assert.equal(visibleRejectionLogs.includes(forbiddenValue), false);
  }

  const visibleOutput = JSON.stringify({
    browserMessages: firstConnection.browserSocket.sent,
    encodedEvents: runtime.encodedEvents,
    upstreamOptions: runtime.upstreamInstances.map(
      (instance) => instance.options
    ),
  }) + runtime.logs.join('\n');
  assert.equal(visibleOutput.includes(lifecycleLeakMarker), false);
  assert.equal(
    visibleOutput.includes('internalCallLifecycleCoordinator'),
    false
  );
  assert.equal(
    visibleOutput.includes('internalCallLifecycleDependency'),
    false
  );
}

function connectRole(runtime, role, secondCharacterKey) {
  const {
    browserSocket,
    context,
  } = createBrowserConnection(runtime);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: role.key,
    speaker: 'forged-speaker',
    speakerId: 'forged-speaker-id',
    systemPrompt: 'forged-prompt',
    system_role: 'forged-system-role',
    displayName: 'forged-name',
    enabled: false,
  });
  businessCallIdScenarioCount += 1;

  assert.equal(runtime.upstreamInstances.length, 1);
  assert.equal(context.businessCallId, null);
  assert.equal(context.characterKey, role.key);
  assert.equal(context.characterDisplayName, role.displayName);
  assert.equal(context.speakerId, role.speakerId);
  assert.ok(context.characterSystemPrompt.length > 0);

  const upstream = runtime.upstreamInstances[0];
  upstream.emitOpen();
  upstream.emitFrame({
    eventId: EVENT.CONNECTION_STARTED,
    eventName: 'ConnectionStarted',
    json: {},
    messageType: 1,
    payload: Buffer.alloc(0),
  });

  const connectionEvents = runtime.encodedEvents.filter(
    (event) => event.eventId === EVENT.START_CONNECTION
  );
  const sessionEvents = runtime.encodedEvents.filter(
    (event) => event.eventId === EVENT.START_SESSION
  );
  assert.equal(connectionEvents.length, 1);
  assert.equal(sessionEvents.length, 1);
  assert.equal(
    sessionEvents[0].payload.dialog.system_role,
    context.characterSystemPrompt
  );
  assert.equal(sessionEvents[0].payload.tts.speaker, role.speakerId);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: role.key,
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.hello_ack',
      received: true,
    }
  );
  assert.equal(context.businessCallId, null);
  assert.equal(context.characterKey, role.key);
  assert.equal(runtime.upstreamInstances.length, 1);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: secondCharacterKey,
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(runtime.upstreamInstances.length, 1);
  assert.equal(context.characterKey, role.key);
  assert.equal(
    runtime.encodedEvents.filter(
      (event) => event.eventId === EVENT.START_CONNECTION
    ).length,
    1
  );
  assert.equal(
    runtime.encodedEvents.filter(
      (event) => event.eventId === EVENT.START_SESSION
    ).length,
    1
  );

  return {
    browserSocket,
    context,
    sessionEvent: sessionEvents[0],
  };
}

function verifyBusinessCallIdBinding() {
  const runtime = createRuntime(createEnabledEnvironment());
  const {
    browserSocket,
    context,
  } = createBrowserConnection(runtime);
  const businessCallId = 'call-业务/relay-%';
  const expectedCharacterKey = 'yuhuang';

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
    callId: businessCallId,
  });
  businessCallIdScenarioCount += 1;
  assert.equal(context.businessCallId, businessCallId);
  assert.equal(runtime.upstreamInstances.length, 1);
  const expectedSpeakerId = context.speakerId;
  const expectedSystemPrompt = context.characterSystemPrompt;

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
    callId: businessCallId,
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.hello_ack',
      received: true,
    }
  );
  assert.equal(context.businessCallId, businessCallId);
  assert.equal(runtime.upstreamInstances.length, 1);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
    callId: 'call-different',
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(context.businessCallId, businessCallId);
  assert.equal(context.characterKey, expectedCharacterKey);
  assert.equal(runtime.upstreamInstances.length, 1);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'sunwukong',
    callId: businessCallId,
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(context.businessCallId, businessCallId);
  assert.equal(context.characterKey, expectedCharacterKey);
  assert.equal(context.speakerId, expectedSpeakerId);
  assert.equal(context.characterSystemPrompt, expectedSystemPrompt);
  assert.equal(runtime.upstreamInstances.length, 1);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(context.businessCallId, businessCallId);
  assert.equal(context.characterKey, expectedCharacterKey);
  assert.equal(context.speakerId, expectedSpeakerId);
  assert.equal(context.characterSystemPrompt, expectedSystemPrompt);
  assert.equal(runtime.upstreamInstances.length, 1);

  browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
    callId: 'unsafe\u0085control',
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    browserSocket.sent[browserSocket.sent.length - 1],
    {
      type: 'relay.error',
      message: INVALID_BUSINESS_CALL_ID_MESSAGE,
    }
  );
  assert.equal(context.businessCallId, businessCallId);
  assert.equal(context.characterKey, expectedCharacterKey);
  assert.equal(context.speakerId, expectedSpeakerId);
  assert.equal(context.characterSystemPrompt, expectedSystemPrompt);
  assert.equal(runtime.upstreamInstances.length, 1);

  const conflictingCharacterMessages = [
    {
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        callId: businessCallId,
      },
      expectedMessage: CONFLICTING_BROWSER_HELLO_MESSAGE,
    },
    {
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: ' invalid-role',
        callId: businessCallId,
      },
      expectedMessage: '角色键格式无效',
    },
    {
      message: {
        type: 'browser.hello',
        client: 'doubao-browser-poc',
        characterKey: 'unknown-role',
        callId: businessCallId,
      },
      expectedMessage: '未知角色',
    },
  ];
  for (const scenario of conflictingCharacterMessages) {
    browserSocket.emitJson(scenario.message);
    businessCallIdScenarioCount += 1;
    assert.deepEqual(
      browserSocket.sent[browserSocket.sent.length - 1],
      {
        type: 'relay.error',
        message: scenario.expectedMessage,
      }
    );
    assert.equal(context.businessCallId, businessCallId);
    assert.equal(context.characterKey, expectedCharacterKey);
    assert.equal(context.speakerId, expectedSpeakerId);
    assert.equal(context.characterSystemPrompt, expectedSystemPrompt);
    assert.equal(runtime.upstreamInstances.length, 1);
  }

  const missingIdRuntime = createRuntime(createEnabledEnvironment());
  const missingIdConnection = createBrowserConnection(missingIdRuntime);
  missingIdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
  });
  businessCallIdScenarioCount += 1;
  assert.equal(missingIdConnection.context.businessCallId, null);
  assert.equal(missingIdRuntime.upstreamInstances.length, 1);
  const missingIdSpeakerId = missingIdConnection.context.speakerId;
  const missingIdSystemPrompt =
    missingIdConnection.context.characterSystemPrompt;

  missingIdConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: expectedCharacterKey,
    callId: businessCallId,
  });
  businessCallIdScenarioCount += 1;
  assert.deepEqual(
    missingIdConnection.browserSocket.sent[
      missingIdConnection.browserSocket.sent.length - 1
    ],
    {
      type: 'relay.error',
      message: CONFLICTING_BROWSER_HELLO_MESSAGE,
    }
  );
  assert.equal(missingIdConnection.context.businessCallId, null);
  assert.equal(
    missingIdConnection.context.characterKey,
    expectedCharacterKey
  );
  assert.equal(
    missingIdConnection.context.speakerId,
    missingIdSpeakerId
  );
  assert.equal(
    missingIdConnection.context.characterSystemPrompt,
    missingIdSystemPrompt
  );
  assert.equal(missingIdRuntime.upstreamInstances.length, 1);

  const upstream = runtime.upstreamInstances[0];
  upstream.emitOpen();
  upstream.emitFrame({
    eventId: EVENT.CONNECTION_STARTED,
    eventName: 'ConnectionStarted',
    json: {},
    messageType: 1,
    payload: Buffer.alloc(0),
  });
  assert.equal(
    JSON.stringify(runtime.encodedEvents).includes(businessCallId),
    false
  );
  assert.equal(
    JSON.stringify(upstream.options).includes(businessCallId),
    false
  );
  assert.equal(runtime.logs.join('\n').includes(businessCallId), false);

  const invalidValues = [
    null,
    42,
    '',
    '   ',
    ' leading-call',
    'trailing-call ',
    'x'.repeat(129),
    'unsafe\u0000control',
    'unsafe\u001fcontrol',
    'unsafe\u007fcontrol',
    'unsafe\u0080control',
    'unsafe\u0085control',
    'unsafe\u009fcontrol',
  ];
  for (const invalidValue of invalidValues) {
    const invalidRuntime = createRuntime(createEnabledEnvironment());
    const invalidConnection = createBrowserConnection(invalidRuntime);
    invalidConnection.browserSocket.emitJson({
      type: 'browser.hello',
      client: 'doubao-browser-poc',
      characterKey: 'yuhuang',
      callId: invalidValue,
    });
    businessCallIdScenarioCount += 1;

    assert.equal(invalidConnection.context.businessCallId, null);
    assert.equal(invalidConnection.context.characterResolved, false);
    assert.equal(invalidRuntime.upstreamInstances.length, 0);
    assert.deepEqual(
      invalidConnection.browserSocket.sent[
        invalidConnection.browserSocket.sent.length - 1
      ],
      {
        type: 'relay.error',
        message: INVALID_BUSINESS_CALL_ID_MESSAGE,
      }
    );
    assert.equal(
      invalidConnection.browserSocket.sent.some((message) => (
        JSON.stringify(message).includes(
          typeof invalidValue === 'string' ? invalidValue : 'never-match'
        )
        && message.type === 'relay.error'
        && message.message !== INVALID_BUSINESS_CALL_ID_MESSAGE
      )),
      false
    );
    if (typeof invalidValue === 'string'
      && invalidValue.trim().length >= 4) {
      assert.equal(
        invalidRuntime.logs.join('\n').includes(invalidValue),
        false
      );
    }
  }
}

function verifyLifecycleBoundary() {
  const serverSource = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.match(
    serverSource,
    /require\('\.\/relay_internal_call_lifecycle_bootstrap'\)/
  );
  assert.match(
    serverSource,
    /createRelayInternalCallLifecycleDependency\s*\(\{/
  );
  assert.match(
    serverSource,
    /require\('\.\/relay_internal_call_lifecycle_coordinator'\)/
  );
  const coordinatorSpecifier =
    "require('./relay_internal_call_lifecycle_coordinator')";
  const coordinatorRequireIndex =
    serverSource.indexOf(coordinatorSpecifier);
  const handlerIndex = serverSource.indexOf(
    'function handleBrowserMessage'
  );
  assert.ok(coordinatorRequireIndex >= 0);
  assert.equal(
    serverSource.indexOf(
      coordinatorSpecifier,
      coordinatorRequireIndex + 1
    ),
    -1
  );
  assert.ok(handlerIndex >= 0);
  assert.ok(coordinatorRequireIndex < handlerIndex);
  assert.equal(
    serverSource.slice(handlerIndex).includes(coordinatorSpecifier),
    false
  );
  assert.equal(
    (
      serverSource.match(
        /\bcreateRelayInternalCallLifecycleCoordinator\b/g
      ) || []
    ).length,
    2
  );
  assert.equal(
    (
      serverSource.match(
        /createRelayInternalCallLifecycleCoordinator\s*\(\{/g
      ) || []
    ).length,
    1
  );
  assert.match(
    serverSource,
    /createRelayInternalCallLifecycleCoordinator\s*\(\{\s*dependency:\s*context\.internalCallLifecycleDependency,\s*callId:\s*nextBusinessCallId,\s*\}\)/
  );
  assert.match(
    serverSource,
    /internalCallLifecycleCoordinator:\s*null/
  );
  assert.match(
    serverSource,
    /context\.internalCallLifecycleCoordinator\s*=\s*nextInternalCallLifecycleCoordinator/
  );
  const markConnectingMatches =
    serverSource.match(/\.markConnecting\s*\(\)/g) || [];
  assert.equal(markConnectingMatches.length, 1);
  assert.match(
    serverSource,
    /if \(context\.internalCallLifecycleCoordinator !== null\) \{\s*void context\.internalCallLifecycleCoordinator\s*\.markConnecting\(\)\s*\.catch\(\(\) => \{\s*log\('\[Relay\] 内部 Call 生命周期 connecting 状态上报失败'\);\s*\}\);\s*\}/
  );
  assert.doesNotMatch(
    serverSource,
    /await\s+context\.internalCallLifecycleCoordinator[\s\S]{0,80}\.markConnecting\s*\(/
  );
  const coordinatorAssignmentIndex = serverSource.indexOf(
    'context.internalCallLifecycleCoordinator =',
    handlerIndex
  );
  const characterResolvedIndex = serverSource.indexOf(
    'context.characterResolved = true;',
    handlerIndex
  );
  const markConnectingIndex = serverSource.indexOf(
    '.markConnecting()',
    handlerIndex
  );
  const helloAckIndex = serverSource.indexOf(
    "type: 'relay.hello_ack'",
    markConnectingIndex
  );
  const connectUpstreamIndex = serverSource.indexOf(
    'connectDoubaoUpstream(context);',
    markConnectingIndex
  );
  assert.ok(coordinatorAssignmentIndex >= 0);
  assert.ok(coordinatorAssignmentIndex < characterResolvedIndex);
  assert.ok(characterResolvedIndex < markConnectingIndex);
  assert.ok(markConnectingIndex < helloAckIndex);
  assert.ok(helloAckIndex < connectUpstreamIndex);
  const forbiddenPatterns = [
    /internal_call_lifecycle_client/,
    /\.markActive\s*\(/,
    /\.markEnded\s*\(/,
    /\.markFailed\s*\(/,
    /\bBUSINESS_INTERNAL_API_TOKEN\b/,
    /\bBUSINESS_BACKEND_INTERNAL_BASE_URL\b/,
    /lifecycleState/,
    /lifecycleRequestTail/,
    /lifecycleFinalized/,
    /lifecycleRequestInFlight/,
    /JSON\.stringify\s*\(\s*context/,
    /sendJson\([^;]*internalCallLifecycleCoordinator/,
    /console\.[a-z]+\([^;]*internalCallLifecycleCoordinator/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(serverSource, pattern);
  }
}

function extractPrompt(source, functionName) {
  const pattern = new RegExp(
    `function build${functionName}SystemPrompt\\(\\) \\{\\r?\\n`
      + '  return `([\\s\\S]*?)`;\\r?\\n\\}'
  );
  const match = source.match(pattern);
  assert.ok(match, `missing prompt ${functionName}`);
  return match[1];
}

function hashText(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function verifyPromptRegression() {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  const snapshot = fs.readFileSync(SNAPSHOT_SERVER_PATH, 'utf8');
  const expected = {
    Yuhuang: {
      characters: 1345,
      hash: 'f002298123baaf55db7758bd562b7b9f0de50da8a5f2a5026dd797bbd05b3b1c',
    },
    Sunwukong: {
      characters: 1544,
      hash: 'ad2ff808df40d988df3d103ee92ba53a3d8820d6988a86107298cc67085e7cd3',
    },
  };
  for (const [functionName, expectation] of Object.entries(expected)) {
    const prompt = extractPrompt(source, functionName);
    assert.equal(prompt, extractPrompt(snapshot, functionName));
    assert.equal(prompt.length, expectation.characters);
    assert.equal(hashText(prompt), expectation.hash);
  }

  const requiredSections = [
    '【身份边界】',
    '【表达风格】',
    '【停止和打断】',
    '【日常陪伴】',
    '【角色特有边界】',
    '【高风险安全规则——最高优先级】',
    '【医疗和健康边界】',
    '【防诈骗与财产安全】',
    '【隐私规则】',
  ];
  for (const role of NEW_ROLES) {
    const prompt = extractPrompt(source, role.functionName);
    assert.ok(prompt.length > 900);
    for (const section of requiredSections) {
      assert.ok(
        prompt.includes(section),
        `${role.key} missing ${section}`
      );
    }
  }
}

function verifyStrictEnableSwitches() {
  const disabledValues = [
    undefined,
    '',
    ' ',
    'true',
    'TRUE',
    'yes',
    '0',
    '2',
  ];
  for (const role of NEW_ROLES) {
    for (const value of disabledValues) {
      const environment = {
        VOLCENGINE_API_KEY: 'local-vm-test-key',
        [role.speakerName]: role.speakerId,
      };
      if (value !== undefined) {
        environment[role.enableName] = value;
      }
      const runtime = createRuntime(environment);
      assert.throws(
        () => runtime.exports.resolveCharacterConfig(role.key),
        {
          message: `${role.displayName}语音尚未接入`,
        }
      );
      assert.equal(runtime.promptCalls[role.key], 0);
      assert.equal(runtime.speakerCalls[role.key], 0);
      assert.equal(runtime.upstreamInstances.length, 0);
    }
  }
}

function verifyMissingSpeakers() {
  for (const role of NEW_ROLES) {
    const runtime = createRuntime({
      VOLCENGINE_API_KEY: 'local-vm-test-key',
      [role.enableName]: '1',
    });
    assert.throws(
      () => runtime.exports.resolveCharacterConfig(role.key),
      {
        message: `${role.speakerName} 未配置`,
      }
    );
    assert.equal(runtime.promptCalls[role.key], 1);
    assert.equal(runtime.speakerCalls[role.key], 1);
    assert.equal(runtime.upstreamInstances.length, 0);
  }
}

function verifyUnknownCharacters() {
  const runtime = createRuntime(createEnabledEnvironment());
  for (const characterKey of [
    'guanyin2',
    'GUANYIN',
    '',
    'constructor',
    '__proto__',
  ]) {
    assert.throws(
      () => runtime.exports.resolveCharacterConfig(characterKey)
    );
  }
  assert.equal(runtime.upstreamInstances.length, 0);
}

function verifyEightRoleConnections() {
  const speakers = new Set();
  const promptHashes = new Map();
  for (const role of ROLE_MATRIX) {
    const runtime = createRuntime(createEnabledEnvironment());
    const nextRole = ROLE_MATRIX[
      (ROLE_MATRIX.findIndex((item) => item.key === role.key) + 1)
      % ROLE_MATRIX.length
    ];
    const result = connectRole(runtime, role, nextRole.key);
    assert.equal(result.context.characterDisplayName, role.displayName);
    assert.equal(result.context.speakerId, role.speakerId);
    speakers.add(result.sessionEvent.payload.tts.speaker);
    promptHashes.set(
      role.key,
      hashText(result.sessionEvent.payload.dialog.system_role)
    );
  }
  assert.equal(speakers.size, ROLE_MATRIX.length);
  assert.equal(promptHashes.size, ROLE_MATRIX.length);
  return promptHashes;
}

async function main() {
  verifyPromptRegression();
  verifyStrictEnableSwitches();
  verifyMissingSpeakers();
  verifyUnknownCharacters();
  const promptHashes = verifyEightRoleConnections();
  verifyBusinessCallIdBinding();
  await verifyLifecycleDependencyInjection();
  verifyLifecycleBoundary();

  process.stdout.write('eight_character_role_matrix_test: PASS\n');
  process.stdout.write(`roles=${ROLE_MATRIX.map((role) => role.key).join(',')}\n`);
  for (const role of ROLE_MATRIX) {
    process.stdout.write(
      `${role.key}\t${role.displayName}\t${role.speakerId}`
        + `\tpromptSha=${promptHashes.get(role.key)}\n`
    );
  }
  process.stdout.write(
    'verified=enable-switches,missing-speakers,malicious-fields,'
      + 'unknown-keys,repeated-hello,start-connection,start-session,'
      + 'business-call-id-binding,invalid-call-ids,upstream-isolation,'
      + 'lifecycle-dependency-injection,lifecycle-connecting-fire-and-observe,'
      + 'lifecycle-pending-nonblocking,lifecycle-dual-layer-calls,'
      + 'lifecycle-boundary\n'
  );
  process.stdout.write(
    `businessCallIdScenarios=${businessCallIdScenarioCount}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
