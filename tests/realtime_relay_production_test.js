'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');

const PROJECT_DIR = path.resolve(__dirname, '..');
const PRODUCTION_ENTRY = path.join(
  PROJECT_DIR,
  'realtime_relay_production.js'
);
const SERVER_MODULE = path.join(PROJECT_DIR, 'server_doubao_realtime.js');
const TEST_INTERNAL_TOKEN =
  'offline_internal_token_0123456789ABCDEF';
const SECRET_SENTINELS = Object.freeze([
  'offline-realtime-key-not-secret',
  'offline-asr-key-not-secret',
  TEST_INTERNAL_TOKEN,
]);

const {
  isLoopbackAddress,
  validateProductionRelayConfig,
} = require('../realtime_relay_production_config');
const { startServer } = require('../server_doubao_realtime');

function createProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    REALTIME_RELAY_HOST: '127.0.0.1',
    REALTIME_RELAY_PORT: '3001',
    VOLCENGINE_API_KEY: SECRET_SENTINELS[0],
    BUSINESS_BACKEND_INTERNAL_BASE_URL: 'http://127.0.0.1:1',
    BUSINESS_INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,
    DOUBAO_ENABLE_FORTUNE_ASR: '1',
    DOUBAO_ASR_API_KEY: SECRET_SENTINELS[1],
    DOUBAO_ASR_RESOURCE_ID: 'volc.seedasr.sauc.duration',
    ...overrides,
  };
}

function createChildEnv(overrides = {}) {
  const environment = {};
  for (const name of [
    'ALLUSERSPROFILE',
    'APPDATA',
    'ComSpec',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'PATH',
    'PATHEXT',
    'SystemDrive',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'WINDIR',
  ]) {
    if (process.env[name] !== undefined) {
      environment[name] = process.env[name];
    }
  }
  return Object.assign(environment, createProductionEnv(), overrides);
}

function getFreePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const currentRequest = http.get({
      host: '127.0.0.1',
      path: pathname,
      port,
      timeout: 1000,
    }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({
        body,
        statusCode: response.statusCode,
      }));
    });
    currentRequest.once('error', reject);
    currentRequest.once('timeout', () => {
      currentRequest.destroy(new Error('request timed out'));
    });
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`Relay exited before health check: ${child.exitCode}`);
    }
    try {
      const response = await request(port, '/health');
      if (response.statusCode === 200) {
        return response;
      }
    } catch {
      // The child can still be between validation and listen.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Relay health check did not become ready');
}

function connectWebSocket(port, pathname) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${pathname}`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket timed out: ${pathname}`));
    }, 3000);
    socket.once('open', () => {
      clearTimeout(timer);
      socket.close(1000, 'offline upgrade verified');
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function rejectUnknownWebSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/unknown?x=1`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('unknown WebSocket path timed out'));
    }, 3000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('open', () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error('unknown WebSocket path was accepted'));
    });
    socket.once('error', () => {});
  });
}

function spawnProductionRelay(environment) {
  const child = spawn(process.execPath, [PRODUCTION_ENTRY], {
    cwd: PROJECT_DIR,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return {
    child,
    get output() {
      return stdout + stderr;
    },
  };
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('child process did not exit'));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function assertPortReleased(port) {
  await assert.rejects(request(port, '/health'));
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

test('production config allows only loopback IPs and validates all required services', () => {
  const input = createProductionEnv();
  const snapshot = { ...input };
  assert.deepEqual(validateProductionRelayConfig(input), {
    host: '127.0.0.1',
    port: 3001,
  });
  assert.deepEqual(input, snapshot);
  assert.equal(isLoopbackAddress('127.25.4.9'), true);
  assert.equal(isLoopbackAddress('::1'), true);

  for (const host of ['0.0.0.0', '::', '192.0.2.10', 'localhost']) {
    assert.throws(
      () => validateProductionRelayConfig(createProductionEnv({
        REALTIME_RELAY_HOST: host,
      })),
      /REALTIME_RELAY_HOST/
    );
  }
  assert.equal(
    validateProductionRelayConfig(createProductionEnv({
      REALTIME_RELAY_HOST: '::1',
      REALTIME_RELAY_PORT: '8443',
    })).host,
    '::1'
  );
});

test('every production-required variable fails closed without value disclosure', () => {
  const requiredNames = [
    'NODE_ENV',
    'VOLCENGINE_API_KEY',
    'BUSINESS_BACKEND_INTERNAL_BASE_URL',
    'BUSINESS_INTERNAL_API_TOKEN',
    'DOUBAO_ENABLE_FORTUNE_ASR',
    'DOUBAO_ASR_API_KEY',
    'DOUBAO_ASR_RESOURCE_ID',
  ];
  for (const name of requiredNames) {
    const environment = createProductionEnv();
    delete environment[name];
    assert.throws(
      () => validateProductionRelayConfig(environment),
      (error) => error instanceof TypeError
        && error.message.includes(name)
        && SECRET_SENTINELS.every((secret) => !error.message.includes(secret))
    );
  }

  assert.throws(
    () => validateProductionRelayConfig(createProductionEnv({
      DOUBAO_ENABLE_GUANYIN: '1',
    })),
    /DOUBAO_GUANYIN_SPEAKER_ID/
  );
});

test('import has no listener side effect and development start remains credential-optional', async () => {
  const imported = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(SERVER_MODULE)}); process.stdout.write('imported');`,
  ], {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout, 'imported');

  const relay = startServer({
    env: {},
    host: '127.0.0.1',
    installSignalHandlers: false,
    lifecycleEnv: {},
    port: 0,
  });
  await relay.ready;
  assert.equal(relay.address.address, '127.0.0.1');
  const firstStop = relay.stop();
  assert.equal(relay.stop(), firstStop);
  await firstStop;
});

test('SIGINT and SIGTERM handlers perform the same idempotent graceful stop', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const signalProcess = new EventEmitter();
    signalProcess.exitCode = null;
    const env = createProductionEnv();
    const relay = startServer({
      env,
      host: '127.0.0.1',
      lifecycleEnv: env,
      port: 0,
      signalProcess,
    });
    await relay.ready;
    const port = relay.address.port;
    signalProcess.emit(signal);
    await relay.stop();
    assert.equal(signalProcess.exitCode, 0);
    await assertPortReleased(port);
  }
});

test('production child serves health and both upgrade paths without upstream traffic', async () => {
  const port = await getFreePort();
  const runtime = spawnProductionRelay(createChildEnv({
    REALTIME_RELAY_PORT: String(port),
  }));
  try {
    const health = await waitForHealth(port, runtime.child);
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), {
      status: 'ok',
      service: 'realtime-relay',
    });
    assert.equal((await request(port, '/missing')).statusCode, 404);
    await connectWebSocket(port, '/realtime?client=offline');
    await connectWebSocket(port, '/fortune-asr?client=offline');
    assert.equal(await rejectUnknownWebSocket(port), 404);
    for (const secret of SECRET_SENTINELS) {
      assert.equal(runtime.output.includes(secret), false);
    }

    runtime.child.kill('SIGTERM');
    const exit = await waitForExit(runtime.child);
    if (process.platform !== 'win32') {
      assert.equal(exit.code, 0);
      assert.equal(exit.signal, null);
    }
    await assertPortReleased(port);

    const restarted = spawnProductionRelay(createChildEnv({
      REALTIME_RELAY_PORT: String(port),
    }));
    await waitForHealth(port, restarted.child);
    restarted.child.kill('SIGTERM');
    await waitForExit(restarted.child);
    await assertPortReleased(port);
  } finally {
    if (runtime.child.exitCode === null) {
      runtime.child.kill();
      await waitForExit(runtime.child).catch(() => {});
    }
  }
});

test('production child rejects missing config and non-loopback host before listen', async () => {
  const scenarios = [
    {
      expectedName: 'BUSINESS_INTERNAL_API_TOKEN',
      overrides: { BUSINESS_INTERNAL_API_TOKEN: undefined },
    },
    {
      expectedName: 'REALTIME_RELAY_HOST',
      overrides: { REALTIME_RELAY_HOST: '0.0.0.0' },
    },
  ];

  for (const scenario of scenarios) {
    const port = await getFreePort();
    const environment = createChildEnv({
      REALTIME_RELAY_PORT: String(port),
    });
    for (const [name, value] of Object.entries(scenario.overrides)) {
      if (value === undefined) {
        delete environment[name];
      } else {
        environment[name] = value;
      }
    }
    const runtime = spawnProductionRelay(environment);
    const exit = await waitForExit(runtime.child);
    assert.notEqual(exit.code, 0);
    assert.match(runtime.output, new RegExp(scenario.expectedName));
    for (const secret of SECRET_SENTINELS) {
      assert.equal(runtime.output.includes(secret), false);
    }
    await assertPortReleased(port);
  }
});

test('.gitignore covers certificate and private-key extensions without probes', () => {
  for (const filename of [
    'probe.crt',
    'probe.cer',
    'probe.der',
    'probe.jks',
    'probe.key',
    'probe.pem',
    'probe.p12',
    'probe.pfx',
  ]) {
    const result = spawnSync(
      'git',
      ['check-ignore', '--no-index', '-q', filename],
      { cwd: PROJECT_DIR }
    );
    assert.equal(result.status, 0, `${filename} was not ignored`);
  }
});
