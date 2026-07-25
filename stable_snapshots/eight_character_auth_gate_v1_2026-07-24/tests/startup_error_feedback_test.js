'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

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
    /错误：8765端口已被占用，请先停止旧的首页静态服务器。/
  );
  assert.ok(
    source.indexOf('check_port_in_use 3001')
      < source.indexOf('请输入 VOLCENGINE_API_KEY')
  );
  assert.match(source, /kill -0 "\$STATIC_SERVER_PID"/);
  assert.doesNotMatch(
    source,
    /python -m http\.server[^\n]*>\/dev\/null 2>&1/
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
    /错误：8765端口已被占用，请先停止旧的首页静态服务器。/
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

async function main() {
  verifyStartupScript();
  await verifyImmediateRelayErrorFeedback();
  verifySafeServerCharacterLogging();

  process.stdout.write('startup_error_feedback_test: PASS\n');
  process.stdout.write(
    'verified=3001-preflight,8765-preflight,strict-shell,static-alive,'
      + 'session-waiter-immediate,audio-waiter-immediate,'
      + 'active-nonfatal-preserved,sanitized-role-log\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
