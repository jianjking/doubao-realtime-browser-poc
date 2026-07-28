'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const {
  createRelayInternalCallLifecycleDependency,
} = require('../relay_internal_call_lifecycle_bootstrap');
const realLifecycleCoordinatorModule = require(
  '../relay_internal_call_lifecycle_coordinator'
);

const PROJECT_DIR = path.resolve(__dirname, '..');
const START_SCRIPT_PATH = path.join(PROJECT_DIR, 'start_full_demo.sh');
const MIC_JS_PATH = path.join(
  PROJECT_DIR,
  'public/doubao_mic_single_turn.js'
);
const SERVER_JS_PATH = path.join(PROJECT_DIR, 'server_doubao_realtime.js');

class FakeClassList {
  add() {}
  remove() {}
  toggle() {}
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.disabled = false;
    this.handlers = new Map();
    this.textContent = '';
  }

  addEventListener(eventName, handler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName).push(handler);
  }
}

function findBash() {
  const candidates = [
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'bash',
  ];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  throw new Error('未找到可用于启动脚本测试的 bash');
}

function toBashPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function runMockedPortScenario(bashPath, statuses) {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'doubao-port-check-')
  );
  const mockPath = path.join(temporaryDirectory, 'mock-node.sh');
  fs.writeFileSync(
    mockPath,
    `node() {
  if [[ "$1" == "-" && "$2" == "3001" ]]; then
    return "\${MOCK_3001_STATUS}"
  fi
  if [[ "$1" == "-" && "$2" == "8765" ]]; then
    return "\${MOCK_8765_STATUS}"
  fi
  return 99
}
`,
    'utf8'
  );
  const command = `export PATH="/usr/bin:/bin:$PATH"
source '${toBashPath(mockPath)}'
source '${toBashPath(START_SCRIPT_PATH)}'`;
  const result = spawnSync(bashPath, ['-c', command], {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      MOCK_3001_STATUS: String(statuses.port3001),
      MOCK_8765_STATUS: String(statuses.port8765),
    },
    input: '',
    windowsHide: true,
  });
  fs.rmSync(temporaryDirectory, {
    force: true,
    recursive: true,
  });
  return result;
}

function verifyStartupScript() {
  const source = fs.readFileSync(START_SCRIPT_PATH, 'utf8');
  assert.match(source, /^set -euo pipefail$/m);
  assert.match(source, /require\('node:net'\)/);
  assert.match(source, /check_port_in_use 3001/);
  assert.match(source, /check_port_in_use 8765/);
  assert.match(
    source,
    /错误：3001端口已被占用，请先停止旧的Realtime Relay。/
  );
  assert.match(
    source,
    /错误：8765端口已被占用，请先停止旧的业务后端与首页服务。/
  );
  assert.ok(
    source.indexOf('check_port_in_use 3001')
      < source.indexOf('请输入 VOLCENGINE_API_KEY')
  );
  assert.match(source, /kill -0 "\$BUSINESS_BACKEND_PID"/);
  assert.match(source, /node business_backend\/server\.js/);
  assert.match(source, /BUSINESS_BACKEND_PORT="8765"/);
  assert.match(
    source,
    /BUSINESS_BACKEND_INTERNAL_BASE_URL="http:\/\/127\.0\.0\.1:8765\/internal"/
  );
  assert.match(source, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.doesNotMatch(
    source,
    /python -m http\.server/
  );
  assert.match(
    source,
    /ui_prototypes\/yuhuang_mobile_v1\/index\.html/
  );

  const bashPath = findBash();
  const port3001 = runMockedPortScenario(bashPath, {
    port3001: 0,
    port8765: 1,
  });
  assert.notEqual(port3001.status, 0);
  assert.match(
    port3001.stderr,
    /错误：3001端口已被占用，请先停止旧的Realtime Relay。/
  );
  assert.doesNotMatch(port3001.stdout, /VOLCENGINE_API_KEY/);

  const port8765 = runMockedPortScenario(bashPath, {
    port3001: 1,
    port8765: 0,
  });
  assert.notEqual(port8765.status, 0);
  assert.match(
    port8765.stderr,
    /错误：8765端口已被占用，请先停止旧的业务后端与首页服务。/
  );
  assert.doesNotMatch(port8765.stdout, /VOLCENGINE_API_KEY/);
}

function loadMicRuntime() {
  let source = fs.readFileSync(MIC_JS_PATH, 'utf8');
  source = source.replace(
    "publishRealtimeCallState('idle');",
    `publishRealtimeCallState('idle');
    globalThis.__startupTest = {
      getSnapshot: () => realtimeCallSnapshot,
      handleRelayMessage,
      prepareAudioWaiter(callId, socket, reject) {
        activeProductCallId = callId;
        relaySocket = socket;
        pendingSessionReady = null;
        pendingAudioActive = { callId, socket, reject };
      },
      prepareActiveCall(callId, socket) {
        activeProductCallId = callId;
        relaySocket = socket;
        pendingSessionReady = null;
        pendingAudioActive = null;
      },
      prepareSessionWaiter(callId, socket, reject) {
        activeProductCallId = callId;
        relaySocket = socket;
        pendingSessionReady = { callId, socket, reject };
        pendingAudioActive = null;
      },
    };`
  );

  const ids = [
    'connectButton',
    'disconnectButton',
    'startMicrophoneButton',
    'stopMicrophoneButton',
    'connectionState',
    'microphoneState',
    'playbackState',
    'turnState',
    'logOutput',
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  const window = {
    addEventListener() {},
    clearTimeout,
    location: {
      search: '?characterKey=guanyin',
    },
    setTimeout,
  };

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
  }

  const context = {
    AudioContext: class {},
    Blob,
    Element: FakeElement,
    Int16Array,
    URLSearchParams,
    WebSocket: FakeWebSocket,
    clearTimeout,
    console,
    document,
    globalThis: null,
    navigator: {},
    setTimeout,
    window,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, {
    filename: MIC_JS_PATH,
  });
  return {
    api: context.__startupTest,
    WebSocket: FakeWebSocket,
  };
}

function createSocket(WebSocketClass) {
  return {
    closeCalls: [],
    readyState: WebSocketClass.OPEN,
    close(code, reason) {
      this.closeCalls.push({
        code,
        reason,
      });
      this.readyState = WebSocketClass.CLOSING;
    },
  };
}

async function verifyImmediateRelayErrorFeedback() {
  const runtime = loadMicRuntime();
  const sessionSocket = createSocket(runtime.WebSocket);
  const sessionErrors = [];
  runtime.api.prepareSessionWaiter(
    1,
    sessionSocket,
    (error) => sessionErrors.push(error)
  );
  const startedAt = Date.now();
  await runtime.api.handleRelayMessage({
    data: JSON.stringify({
      type: 'relay.error',
      message: '观音语音尚未接入',
    }),
  }, {
    callId: 1,
    socket: sessionSocket,
  });
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(sessionErrors.length, 1);
  assert.equal(sessionSocket.closeCalls.length, 1);
  assert.deepEqual(sessionSocket.closeCalls[0], {
    code: 1011,
    reason: 'relay startup error',
  });
  assert.equal(runtime.api.getSnapshot().state, 'stopping');

  const audioSocket = createSocket(runtime.WebSocket);
  const audioErrors = [];
  runtime.api.prepareAudioWaiter(
    2,
    audioSocket,
    (error) => audioErrors.push(error)
  );
  await runtime.api.handleRelayMessage({
    data: JSON.stringify({
      type: 'relay.error',
      message: '音色未配置',
    }),
  }, {
    callId: 2,
    socket: audioSocket,
  });
  assert.equal(audioErrors.length, 1);
  assert.equal(audioSocket.closeCalls.length, 1);

  const activeSocket = createSocket(runtime.WebSocket);
  runtime.api.prepareActiveCall(3, activeSocket);
  await runtime.api.handleRelayMessage({
    data: JSON.stringify({
      type: 'relay.error',
      message: '普通非致命提示',
    }),
  }, {
    callId: 3,
    socket: activeSocket,
  });
  assert.equal(activeSocket.closeCalls.length, 0);
}

function verifySafeServerCharacterLogging() {
  const source = fs.readFileSync(SERVER_JS_PATH, 'utf8');
  assert.match(source, /function describeRejectedCharacterKey\(/);
  assert.match(
    source,
    /\.replace\(\/\[\\u0000-\\u001f\\u007f-\\u009f\]\/g, ''\)/
  );
  assert.match(source, /\.slice\(0, 48\)/);
  assert.match(source, /non-string:/);
  assert.match(source, /\[Relay\] 角色解析失败/);
  const catchBlock = source.match(
    /characterConfig = resolveCharacterConfig\(rawCharacterKey\);[\s\S]*?sendJson\(context\.browserSocket,[\s\S]*?return;/
  )[0];
  assert.doesNotMatch(
    catchBlock,
    /API_KEY|characterSystemPrompt|speakerId|sessionId|JSON\.stringify\(message\)/
  );
}

function instrumentServerLoggingSource() {
  return fs.readFileSync(SERVER_JS_PATH, 'utf8').replace(
    /\nstartServer\(\);\s*$/,
    '\nglobalThis.__serverLoggingTestExports = {\n'
      + '  handleBrowserConnection,\n'
      + '};\n'
  );
}

function instrumentServerStartupSource() {
  return fs.readFileSync(SERVER_JS_PATH, 'utf8')
    .replace(
      '  const contexts = new Set();',
      '  const contexts = new Set();\n'
        + '  globalThis.__startupLifecycleContexts = contexts;'
    )
    .replace(
      /\nstartServer\(\);\s*$/,
      '\nglobalThis.__startupLifecycleTestExports = {\n'
        + '  startServer,\n'
        + '};\n'
    );
}

function createLifecycleStartupRuntime(environment = {}) {
  const bootstrapCalls = [];
  const coordinatorFactoryCalls = [];
  const dependencies = [];
  const events = [];
  const httpServers = [];
  const websocketServers = [];

  class FakeHttpServer {
    constructor() {
      this.handlers = new Map();
      this.listenCalls = [];
    }

    on(eventName, handler) {
      this.handlers.set(eventName, handler);
    }

    listen(...args) {
      events.push('listen');
      this.listenCalls.push(args);
    }
  }

  class FakeWebSocketServer {
    constructor(options) {
      events.push('websocket-create');
      this.clients = new Set();
      this.handlers = new Map();
      this.options = options;
      websocketServers.push(this);
    }

    on(eventName, handler) {
      if (eventName === 'connection') {
        events.push('connection-handler');
      }
      this.handlers.set(eventName, handler);
    }
  }

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
  }

  const protocol = {
    EVENT: {},
    DoubaoProtocolError: class DoubaoProtocolError extends Error {},
    encodeClientAudioEvent() {
      return Buffer.alloc(0);
    },
    encodeClientJsonEvent() {
      return Buffer.alloc(0);
    },
    getEventName() {
      return 'test-event';
    },
    parseServerFrame(value) {
      return value;
    },
  };
  const context = {
    Buffer,
    URL,
    __dirname: PROJECT_DIR,
    __filename: SERVER_JS_PATH,
    clearTimeout,
    console: {
      log() {},
    },
    process: {
      env: {
        VOLCENGINE_API_KEY: 'local-vm-test-key',
        ...environment,
      },
      once() {},
    },
    require(moduleName) {
      if (moduleName === 'node:crypto') {
        return require('node:crypto');
      }
      if (moduleName === 'node:http') {
        return {
          createServer() {
            events.push('http-create');
            const server = new FakeHttpServer();
            httpServers.push(server);
            return server;
          },
        };
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
          WebSocket: FakeWebSocket,
          WebSocketServer: FakeWebSocketServer,
        };
      }
      if (moduleName === './doubao_protocol.js') {
        return protocol;
      }
      if (moduleName === './relay_internal_call_lifecycle_bootstrap') {
        return {
          createRelayInternalCallLifecycleDependency(options) {
            events.push('lifecycle-dependency');
            bootstrapCalls.push(options);
            const dependency =
              createRelayInternalCallLifecycleDependency(options);
            dependencies.push(dependency);
            return dependency;
          },
        };
      }
      if (moduleName === './relay_internal_call_lifecycle_coordinator') {
        return {
          createRelayInternalCallLifecycleCoordinator(options) {
            const coordinator = realLifecycleCoordinatorModule
              .createRelayInternalCallLifecycleCoordinator(options);
            coordinatorFactoryCalls.push({
              dependency: options.dependency,
              callId: options.callId,
              coordinator,
            });
            return coordinator;
          },
        };
      }
      throw new Error(`unexpected require: ${moduleName}`);
    },
    setTimeout,
  };

  vm.runInNewContext(instrumentServerStartupSource(), context, {
    filename: SERVER_JS_PATH,
  });

  return {
    bootstrapCalls,
    coordinatorFactoryCalls,
    dependencies,
    events,
    exports: context.__startupLifecycleTestExports,
    get contexts() {
      return context.__startupLifecycleContexts;
    },
    httpServers,
    websocketServers,
  };
}

class FakeStartupBrowserSocket {
  constructor() {
    this.handlers = new Map();
    this.readyState = 1;
    this.sent = [];
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
}

function assertStartupFailedBeforeServer(runtime) {
  assert.equal(runtime.httpServers.length, 0);
  assert.equal(runtime.websocketServers.length, 0);
  assert.equal(runtime.events.includes('listen'), false);
}

function verifyLifecycleStartupAssembly() {
  let disabledFetchCalls = 0;
  const disabledFetchImpl = async () => {
    disabledFetchCalls += 1;
    throw new Error('disabled lifecycle fetch must not run');
  };
  const disabledRuntime = createLifecycleStartupRuntime();
  disabledRuntime.exports.startServer({
    lifecycleEnv: {},
    lifecycleFetchImpl: disabledFetchImpl,
  });
  assert.equal(disabledRuntime.bootstrapCalls.length, 1);
  assert.equal(disabledRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(disabledRuntime.dependencies.length, 1);
  assert.equal(disabledRuntime.dependencies[0].enabled, false);
  assert.equal(disabledRuntime.dependencies[0].client, null);
  assert.equal(Object.isFrozen(disabledRuntime.dependencies[0]), true);
  assert.equal(disabledRuntime.httpServers.length, 1);
  assert.equal(disabledRuntime.websocketServers.length, 1);
  assert.equal(disabledRuntime.httpServers[0].listenCalls.length, 1);
  assert.equal(disabledFetchCalls, 0);
  assert.deepEqual(disabledRuntime.events, [
    'lifecycle-dependency',
    'http-create',
    'websocket-create',
    'connection-handler',
    'listen',
  ]);

  const enabledEnv = {
    BUSINESS_BACKEND_INTERNAL_BASE_URL: 'http://127.0.0.1:3002',
    BUSINESS_INTERNAL_API_TOKEN:
      'startup_lifecycle_token_0123456789ABCDEF',
  };
  let enabledFetchCalls = 0;
  const enabledFetchImpl = async () => {
    enabledFetchCalls += 1;
    throw new Error('enabled lifecycle fetch must not run during startup');
  };
  const enabledRuntime = createLifecycleStartupRuntime();
  enabledRuntime.exports.startServer({
    lifecycleEnv: enabledEnv,
    lifecycleFetchImpl: enabledFetchImpl,
  });
  assert.equal(enabledRuntime.bootstrapCalls.length, 1);
  assert.equal(enabledRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(enabledRuntime.bootstrapCalls[0].env, enabledEnv);
  assert.equal(
    enabledRuntime.bootstrapCalls[0].fetchImpl,
    enabledFetchImpl
  );
  assert.equal(enabledRuntime.dependencies.length, 1);
  assert.equal(enabledRuntime.dependencies[0].enabled, true);
  assert.equal(Object.isFrozen(enabledRuntime.dependencies[0]), true);
  assert.equal(Object.isFrozen(enabledRuntime.dependencies[0].client), true);
  assert.equal(enabledRuntime.httpServers.length, 1);
  assert.equal(enabledRuntime.websocketServers.length, 1);
  assert.equal(enabledRuntime.httpServers[0].listenCalls.length, 1);
  assert.equal(enabledFetchCalls, 0);

  const connectionHandler =
    enabledRuntime.websocketServers[0].handlers.get('connection');
  assert.equal(typeof connectionHandler, 'function');
  connectionHandler(
    new FakeStartupBrowserSocket(),
    {
      socket: {
        remoteAddress: '127.0.0.1',
      },
    }
  );
  connectionHandler(
    new FakeStartupBrowserSocket(),
    {
      socket: {
        remoteAddress: '127.0.0.2',
      },
    }
  );
  const [firstContext, secondContext] = [...enabledRuntime.contexts];
  assert.equal(enabledRuntime.contexts.size, 2);
  assert.equal(
    firstContext.internalCallLifecycleDependency,
    enabledRuntime.dependencies[0]
  );
  assert.equal(
    secondContext.internalCallLifecycleDependency,
    enabledRuntime.dependencies[0]
  );
  assert.equal(
    firstContext.internalCallLifecycleDependency,
    secondContext.internalCallLifecycleDependency
  );
  assert.equal(enabledRuntime.bootstrapCalls.length, 1);
  assert.equal(enabledRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(enabledFetchCalls, 0);

  const pairRuntime = createLifecycleStartupRuntime();
  let pairFetchCalls = 0;
  assert.throws(() => {
    pairRuntime.exports.startServer({
      lifecycleEnv: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: 'http://127.0.0.1:3002',
      },
      lifecycleFetchImpl: async () => {
        pairFetchCalls += 1;
      },
    });
  }, {
    name: 'TypeError',
    message:
      'BUSINESS_BACKEND_INTERNAL_BASE_URL and '
      + 'BUSINESS_INTERNAL_API_TOKEN must be configured together',
  });
  assert.equal(pairRuntime.bootstrapCalls.length, 1);
  assert.equal(pairRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(pairFetchCalls, 0);
  assertStartupFailedBeforeServer(pairRuntime);

  const invalidRuntime = createLifecycleStartupRuntime();
  let invalidFetchCalls = 0;
  assert.throws(() => {
    invalidRuntime.exports.startServer({
      lifecycleEnv: {
        BUSINESS_BACKEND_INTERNAL_BASE_URL: 'not-a-url',
        BUSINESS_INTERNAL_API_TOKEN:
          'startup_lifecycle_token_0123456789ABCDEF',
      },
      lifecycleFetchImpl: async () => {
        invalidFetchCalls += 1;
      },
    });
  }, {
    name: 'TypeError',
  });
  assert.equal(invalidRuntime.bootstrapCalls.length, 1);
  assert.equal(invalidRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(invalidFetchCalls, 0);
  assertStartupFailedBeforeServer(invalidRuntime);

  const getterSecret = 'startup getter secret must stay private';
  const getterRuntime = createLifecycleStartupRuntime();
  let getterFetchCalls = 0;
  assert.throws(() => {
    getterRuntime.exports.startServer({
      lifecycleEnv: {
        get BUSINESS_BACKEND_INTERNAL_BASE_URL() {
          throw new Error(getterSecret);
        },
        BUSINESS_INTERNAL_API_TOKEN:
          'startup_lifecycle_token_0123456789ABCDEF',
      },
      lifecycleFetchImpl: async () => {
        getterFetchCalls += 1;
      },
    });
  }, (error) => {
    assert.equal(error.name, 'TypeError');
    assert.equal(
      error.message,
      'Unable to read Relay internal lifecycle configuration'
    );
    assert.equal(error.message.includes(getterSecret), false);
    assert.equal(String(error.stack).includes(getterSecret), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  assert.equal(getterRuntime.bootstrapCalls.length, 1);
  assert.equal(getterRuntime.coordinatorFactoryCalls.length, 0);
  assert.equal(getterFetchCalls, 0);
  assertStartupFailedBeforeServer(getterRuntime);
}

function createServerLoggingRuntime(environment) {
  const logs = [];
  const upstreamInstances = [];

  class FakeUpstreamWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      upstreamInstances.push(this);
    }
  }

  const protocol = {
    EVENT: {},
    DoubaoProtocolError: class DoubaoProtocolError extends Error {},
    encodeClientAudioEvent() {
      return Buffer.alloc(0);
    },
    encodeClientJsonEvent() {
      return Buffer.alloc(0);
    },
    getEventName() {
      return 'test-event';
    },
    parseServerFrame(value) {
      return value;
    },
  };

  const context = {
    Buffer,
    URL,
    __dirname: PROJECT_DIR,
    __filename: SERVER_JS_PATH,
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
        return require('node:crypto');
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
        return {
          createRelayInternalCallLifecycleDependency,
        };
      }
      if (moduleName === './relay_internal_call_lifecycle_coordinator') {
        return realLifecycleCoordinatorModule;
      }
      throw new Error(`unexpected require: ${moduleName}`);
    },
    setTimeout,
  };

  vm.runInNewContext(instrumentServerLoggingSource(), context, {
    filename: SERVER_JS_PATH,
  });

  return {
    exports: context.__serverLoggingTestExports,
    logs,
    upstreamInstances,
    WebSocket: FakeUpstreamWebSocket,
  };
}

class FakeServerBrowserSocket {
  constructor(openState) {
    this.readyState = openState;
    this.handlers = new Map();
    this.sent = [];
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

  emitJson(message) {
    this.handlers.get('message')(
      Buffer.from(JSON.stringify(message)),
      false
    );
  }
}

function verifySpeakerIdsAreRedactedFromTerminalLogs() {
  const environmentSpeakerId = 'configured-env-speaker-9-1';
  const runtime = createServerLoggingRuntime({
    VOLCENGINE_API_KEY: 'local-vm-test-key',
    DOUBAO_GUANYIN_SPEAKER_ID: environmentSpeakerId,
  });
  const browserSocket = new FakeServerBrowserSocket(
    runtime.WebSocket.OPEN
  );
  runtime.exports.handleBrowserConnection(
    browserSocket,
    {
      socket: {
        remoteAddress: '127.0.0.1',
      },
    },
    new Set()
  );

  const scenarios = [
    {
      characterKey: 'S_TiUfvBA92',
      expectedError: '角色键格式无效',
    },
    {
      characterKey: 'S_ViUfvBA92',
      expectedError: '角色键格式无效',
    },
    {
      characterKey: environmentSpeakerId,
      expectedError: '未知角色',
    },
  ];

  for (const scenario of scenarios) {
    const responseCount = browserSocket.sent.length;
    const logCount = runtime.logs.length;
    browserSocket.emitJson({
      type: 'browser.hello',
      client: 'doubao-browser-poc',
      characterKey: scenario.characterKey,
    });

    const responses = browserSocket.sent.slice(responseCount);
    assert.equal(responses.length, 1);
    assert.deepEqual(responses[0], {
      type: 'relay.error',
      message: scenario.expectedError,
    });

    const scenarioLogs = runtime.logs.slice(logCount).join('\n');
    assert.match(
      scenarioLogs,
      /key=string:\[redacted-speaker-id\]/
    );
    assert.doesNotMatch(scenarioLogs, new RegExp(scenario.characterKey));
    assert.equal(runtime.upstreamInstances.length, 0);
  }

  const allLogs = runtime.logs.join('\n');
  for (const scenario of scenarios) {
    assert.doesNotMatch(allLogs, new RegExp(scenario.characterKey));
  }
  assert.equal(runtime.upstreamInstances.length, 0);
}

async function main() {
  verifyStartupScript();
  await verifyImmediateRelayErrorFeedback();
  verifyLifecycleStartupAssembly();
  verifySafeServerCharacterLogging();
  verifySpeakerIdsAreRedactedFromTerminalLogs();

  process.stdout.write('startup_error_feedback_test: PASS\n');
  process.stdout.write(
    'verified=3001-preflight,8765-preflight,strict-shell,static-alive,'
      + 'session-waiter-immediate,audio-waiter-immediate,'
      + 'active-nonfatal-preserved,sanitized-role-log,'
      + 'speaker-id-redaction,lifecycle-startup-assembly\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
