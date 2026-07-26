'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LIFECYCLE_BOOTSTRAP_MODULE = require(
  '../relay_internal_call_lifecycle_bootstrap'
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
      this.readyState = FakeUpstreamWebSocket.CLOSED;
      const handler = this.handlers.get('close');
      if (handler) {
        handler(code, Buffer.from(reason));
      }
    }

    terminate() {
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
      throw new Error(`unexpected require: ${moduleName}`);
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

async function verifyLifecycleDependencyInjection() {
  const lifecycleCalls = {
    markConnecting: 0,
    markActive: 0,
    markEnded: 0,
    markFailed: 0,
  };
  const injectedDependency = Object.freeze({
    enabled: true,
    client: Object.freeze({
      markConnecting() {
        lifecycleCalls.markConnecting += 1;
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
  const firstConnection = createBrowserConnection(
    runtime,
    injectedDependency
  );
  const secondConnection = createBrowserConnection(
    runtime,
    injectedDependency
  );

  assert.equal(
    firstConnection.context.internalCallLifecycleDependency,
    injectedDependency
  );
  assert.equal(
    secondConnection.context.internalCallLifecycleDependency,
    injectedDependency
  );
  assert.equal(
    firstConnection.context.internalCallLifecycleDependency,
    secondConnection.context.internalCallLifecycleDependency
  );

  firstConnection.browserSocket.emitJson({
    type: 'browser.hello',
    client: 'doubao-browser-poc',
    characterKey: 'yuhuang',
  });
  assert.equal(runtime.upstreamInstances.length, 1);
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
    sessionId: firstConnection.context.sessionId,
  });
  firstConnection.browserSocket.emitClose();
  await firstConnection.context.closePromise;
  await Promise.resolve();
  assert.equal(
    firstConnection.contexts.has(firstConnection.context),
    false
  );
  assert.deepEqual(lifecycleCalls, {
    markConnecting: 0,
    markActive: 0,
    markEnded: 0,
    markFailed: 0,
  });
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
  const forbiddenPatterns = [
    /internal_call_lifecycle_client/,
    /\.markConnecting\s*\(/,
    /\.markActive\s*\(/,
    /\.markEnded\s*\(/,
    /\.markFailed\s*\(/,
    /\bBUSINESS_INTERNAL_API_TOKEN\b/,
    /\bBUSINESS_BACKEND_INTERNAL_BASE_URL\b/,
    /lifecycleState/,
    /lifecycleRequestTail/,
    /lifecycleFinalized/,
    /lifecycleRequestInFlight/,
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
      + 'lifecycle-dependency-injection,lifecycle-zero-calls,'
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
