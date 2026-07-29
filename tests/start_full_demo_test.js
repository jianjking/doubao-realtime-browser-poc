'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createInternalCallLifecycleClient,
} = require('../internal_call_lifecycle_client');

const PROJECT_DIR = path.resolve(__dirname, '..');
const START_SCRIPT_PATH = path.join(PROJECT_DIR, 'start_full_demo.sh');
const SYNTHETIC_SECRETS = Object.freeze([
  'synthetic-volc-key-for-startup-test',
  'synthetic-asr-key-for-startup-test',
  'synthetic-model-key-for-startup-test',
  'synthetic-tts-key-for-startup-test',
]);

function findGitBash() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\msys64\\usr\\bin\\bash.exe',
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
  throw new Error('未找到 Windows Git Bash');
}

function toBashPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function toGitBashSearchPath(filePath) {
  return toBashPath(filePath).replace(
    /^([A-Za-z]):\//,
    (_match, drive) => `/${drive.toLowerCase()}/`
  );
}

function buildEnvironment(overrides = {}) {
  const env = { ...process.env };
  const managedNames = [
    'VOLCENGINE_API_KEY',
    'DOUBAO_ASR_API_KEY',
    'DOUBAO_ASR_RESOURCE_ID',
    'FORTUNE_TEXT_MODEL_BASE_URL',
    'FORTUNE_TEXT_MODEL_API_KEY',
    'FORTUNE_TEXT_MODEL_NAME',
    'FORTUNE_TEXT_MODEL_DISABLE_THINKING',
    'FORTUNE_TTS_API_KEY',
    'FORTUNE_TTS_RESOURCE_ID',
    'FORTUNE_TTS_SPEAKER_ID',
    'MOCK_BACKEND_MODE',
    'MOCK_EVENT_FILE',
  ];
  for (const name of managedNames) {
    delete env[name];
  }
  const configured = {
    ...env,
    VOLCENGINE_API_KEY: SYNTHETIC_SECRETS[0],
    DOUBAO_ASR_API_KEY: SYNTHETIC_SECRETS[1],
    DOUBAO_ASR_RESOURCE_ID: 'volc.seedasr.sauc.duration',
    FORTUNE_TEXT_MODEL_BASE_URL: 'https://model.invalid/v1',
    FORTUNE_TEXT_MODEL_API_KEY: SYNTHETIC_SECRETS[2],
    FORTUNE_TEXT_MODEL_NAME: 'synthetic-model',
    FORTUNE_TEXT_MODEL_DISABLE_THINKING: '1',
    FORTUNE_TTS_API_KEY: SYNTHETIC_SECRETS[3],
    FORTUNE_TTS_RESOURCE_ID: 'synthetic.tts.resource',
    FORTUNE_TTS_SPEAKER_ID: 'synthetic-speaker',
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete configured[name];
    } else {
      configured[name] = value;
    }
  }
  return configured;
}

function writeMockRuntime(temporaryDirectory) {
  const mockServicePath = path.join(temporaryDirectory, 'mock_service.js');
  fs.writeFileSync(mockServicePath, `'use strict';
const fs = require('node:fs');
const http = require('node:http');
const role = process.argv[2];
const mode = process.argv[3];
const eventFile = process.env.MOCK_EVENT_FILE;
const portFile = process.env.MOCK_PORT_FILE_DIR + '/' + role + '.port';
function record(event) {
  fs.appendFileSync(eventFile, event + '\\n', 'utf8');
}
const server = http.createServer((request, response) => {
  if (role === 'backend' && request.url === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"status":"ok","service":"mock-business"}');
    return;
  }
  if (role === 'backend'
      && request.url === '/ui_prototypes/yuhuang_mobile_v1/choice.html') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>mock choice</title>');
    return;
  }
  if (role === 'relay' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('mock relay');
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  fs.writeFileSync(portFile, String(port), 'utf8');
  record('ready:' + role + ':' + port);
  if (mode === 'fail') {
    setTimeout(() => process.exit(7), 150);
  }
});
function stop() {
  server.close(() => {
    record('stopped:' + role);
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
`, 'utf8');

  const readinessProbePath = path.join(
    temporaryDirectory,
    'readiness_probe.js'
  );
  fs.writeFileSync(readinessProbePath, `'use strict';
const fs = require('node:fs');
const http = require('node:http');
const requestedUrl = new URL(process.argv[2]);
const role = requestedUrl.port === '8765' ? 'backend' : 'relay';
const portFile = process.env.MOCK_PORT_FILE_DIR + '/' + role + '.port';
if (!fs.existsSync(portFile)) {
  process.exit(1);
}
const port = Number(fs.readFileSync(portFile, 'utf8'));
const request = http.get({
  host: '127.0.0.1',
  port,
  path: requestedUrl.pathname,
}, (response) => {
  response.resume();
  response.once('end', () => {
    process.exit(response.statusCode === 200 ? 0 : 1);
  });
});
request.once('error', () => process.exit(1));
request.setTimeout(500, () => {
  request.destroy();
  process.exit(1);
});
`, 'utf8');

  const nodeShimPath = path.join(temporaryDirectory, 'node');
  const realNode = toBashPath(process.execPath);
  const mockService = toBashPath(mockServicePath);
  const readinessProbe = toBashPath(readinessProbePath);
  fs.writeFileSync(nodeShimPath, `#!/usr/bin/env bash
if [[ "$1" == "business_backend/server.js" ]]; then
  exec '${realNode}' '${mockService}' backend "\${MOCK_BACKEND_MODE:-run}"
fi
if [[ "$1" == "server_doubao_realtime.js" ]]; then
  exec '${realNode}' '${mockService}' relay run
fi
if [[ "$1" == "-" && "$2" == "port-open" ]]; then
  exit 1
fi
if [[ "$1" == "-" && "$2" == "token" ]]; then
  printf 'offline_internal_token_0123456789ABCDEF'
  exit 0
fi
if [[ "$1" == "-" && "$2" == "http-ready" ]]; then
  exec '${realNode}' '${readinessProbe}' "$3"
fi
exec '${realNode}' "$@"
`, 'utf8');
  fs.chmodSync(nodeShimPath, 0o755);
}

function assertSecretsAbsent(output) {
  for (const secret of SYNTHETIC_SECRETS) {
    assert.equal(output.includes(secret), false);
  }
}

function runScript(bashPath, {
  envOverrides = {},
  input = '',
  harness = null,
} = {}) {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'doubao-full-demo-')
  );
  const eventFile = path.join(temporaryDirectory, 'events.log');
  const stdoutFile = path.join(temporaryDirectory, 'stdout.log');
  const stderrFile = path.join(temporaryDirectory, 'stderr.log');
  fs.writeFileSync(eventFile, '', 'utf8');
  writeMockRuntime(temporaryDirectory);

  const defaultHarness = `bash '${toBashPath(START_SCRIPT_PATH)}'`;
  const scriptCommand = harness
    ? harness({
      eventFile: toBashPath(eventFile),
      stdoutFile: toBashPath(stdoutFile),
      stderrFile: toBashPath(stderrFile),
    })
    : defaultHarness;
  const command = `export PATH='${toGitBashSearchPath(temporaryDirectory)}':"$PATH"
${scriptCommand}`;
  const result = spawnSync(bashPath, ['-c', command], {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    env: {
      ...buildEnvironment(envOverrides),
      MOCK_EVENT_FILE: eventFile,
      MOCK_PORT_FILE_DIR: temporaryDirectory,
    },
    input,
    timeout: 20000,
    windowsHide: true,
  });
  const artifact = {
    result,
    events: fs.readFileSync(eventFile, 'utf8'),
    capturedStdout: fs.existsSync(stdoutFile)
      ? fs.readFileSync(stdoutFile, 'utf8')
      : '',
    capturedStderr: fs.existsSync(stderrFile)
      ? fs.readFileSync(stderrFile, 'utf8')
      : '',
  };
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  return artifact;
}

function successfulHarness({ eventFile, stdoutFile, stderrFile }) {
  return `set -u
bash '${toBashPath(START_SCRIPT_PATH)}' >'${stdoutFile}' 2>'${stderrFile}' &
script_pid=$!
ready=0
for attempt in {1..100}; do
  if grep -q '手机端入口' '${stdoutFile}' 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$script_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  kill "$script_pid" 2>/dev/null || true
  wait "$script_pid" 2>/dev/null || true
  exit 91
fi
if ! grep -q 'ready:backend:' '${eventFile}' \
  || ! grep -q 'ready:relay:' '${eventFile}'; then
  kill "$script_pid" 2>/dev/null || true
  wait "$script_pid" 2>/dev/null || true
  exit 92
fi
if ! node - http-ready \
  'http://127.0.0.1:8765/ui_prototypes/yuhuang_mobile_v1/choice.html' \
  </dev/null; then
  kill "$script_pid" 2>/dev/null || true
  wait "$script_pid" 2>/dev/null || true
  exit 95
fi
kill -TERM "$script_pid"
set +e
wait "$script_pid"
status=$?
set -e
if [[ "$status" -ne 130 ]]; then
  exit 93
fi
exit 0`;
}

function runSuccessfulLifecycle(bashPath) {
  return runScript(bashPath, { harness: successfulHarness });
}

function isPortOpen(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    function finish(value) {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => {
      if (error && error.code === 'ECONNREFUSED') {
        finish(false);
        return;
      }
      reject(error);
    });
    socket.setTimeout(1000, () => finish(false));
  });
}

async function main() {
  const bashPath = findGitBash();
  const source = fs.readFileSync(START_SCRIPT_PATH, 'utf8');

  assert.match(
    source,
    /BUSINESS_BACKEND_INTERNAL_BASE_URL="http:\/\/127\.0\.0\.1:8765"/
  );
  assert.doesNotMatch(
    source,
    /BUSINESS_BACKEND_INTERNAL_BASE_URL="http:\/\/127\.0\.0\.1:8765\/internal"/
  );
  assert.match(source, /^trap handle_signal INT TERM$/m);

  let requestedUrl = null;
  const client = createInternalCallLifecycleClient({
    baseUrl: 'http://127.0.0.1:8765',
    token: 'startup_path_test_token_0123456789ABCDEF',
    fetchImpl: async (url) => {
      requestedUrl = url;
      throw new Error('synthetic offline network stop');
    },
  });
  await assert.rejects(
    client.markConnecting('call/path test'),
    (error) => error && error.code === 'INTERNAL_CALL_NETWORK_ERROR'
  );
  assert.equal(
    requestedUrl,
    'http://127.0.0.1:8765/internal/calls/call%2Fpath%20test/connecting'
  );
  assert.equal(requestedUrl.includes('/internal/internal/'), false);

  const missing = runScript(bashPath, {
    envOverrides: { DOUBAO_ASR_API_KEY: undefined },
  });
  assert.notEqual(missing.result.status, 0);
  assert.match(missing.result.stderr, /DOUBAO_ASR_API_KEY/);
  assert.equal(missing.events, '');
  assertSecretsAbsent(missing.result.stdout + missing.result.stderr);

  const invalidThinking = runScript(bashPath, {
    envOverrides: { FORTUNE_TEXT_MODEL_DISABLE_THINKING: 'enabled' },
  });
  assert.notEqual(invalidThinking.result.status, 0);
  assert.match(
    invalidThinking.result.stderr,
    /FORTUNE_TEXT_MODEL_DISABLE_THINKING/
  );
  assert.equal(invalidThinking.events, '');
  assertSecretsAbsent(
    invalidThinking.result.stdout + invalidThinking.result.stderr
  );

  const firstSuccess = runSuccessfulLifecycle(bashPath);
  assert.equal(firstSuccess.result.status, 0);
  assert.match(firstSuccess.capturedStdout, /手机端入口/);
  assert.match(firstSuccess.capturedStdout, /Realtime Relay/);
  assert.match(firstSuccess.capturedStdout, /求签 ASR/);
  assert.match(firstSuccess.events, /ready:backend:\d+/);
  assert.match(firstSuccess.events, /ready:relay:\d+/);
  assertSecretsAbsent(
    firstSuccess.capturedStdout + firstSuccess.capturedStderr
  );
  assert.doesNotMatch(
    firstSuccess.capturedStdout + firstSuccess.capturedStderr,
    /请输入/
  );
  for (const match of firstSuccess.events.matchAll(/ready:\w+:(\d+)/g)) {
    assert.equal(await isPortOpen(Number(match[1])), false);
  }

  const secondSuccess = runSuccessfulLifecycle(bashPath);
  assert.equal(secondSuccess.result.status, 0);
  for (const match of secondSuccess.events.matchAll(/ready:\w+:(\d+)/g)) {
    assert.equal(await isPortOpen(Number(match[1])), false);
  }

  const abnormal = runScript(bashPath, {
    envOverrides: { MOCK_BACKEND_MODE: 'fail' },
  });
  assert.notEqual(abnormal.result.status, 0);
  assert.match(abnormal.events, /ready:backend:\d+/);
  assert.match(abnormal.events, /ready:relay:\d+/);
  assertSecretsAbsent(abnormal.result.stdout + abnormal.result.stderr);
  for (const match of abnormal.events.matchAll(/ready:\w+:(\d+)/g)) {
    assert.equal(await isPortOpen(Number(match[1])), false);
  }

  console.log('start_full_demo_test: PASS');
  console.log(
    'verified=base-origin,internal-path,missing-config,thinking-validation,'
      + 'existing-env,no-secret-echo,child-failure-cleanup,readiness,'
      + 'ctrl-c-cleanup,restart-no-port-residue,no-external-network'
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
