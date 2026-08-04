'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PRODUCTION_ENTRY = path.join(
  PROJECT_ROOT,
  'business_backend',
  'production_server.js'
);
const DEFAULT_DATABASE_PATH = path.join(
  PROJECT_ROOT,
  'business_backend',
  'data',
  'business.sqlite3'
);
const APPLICATION_ENV_PREFIXES = [
  'ALIBABA_',
  'ALIPAY_',
  'BUSINESS_',
  'DOUBAO_',
  'FORTUNE_',
  'PAYMENT_',
  'SMS_',
  'VOLCENGINE_',
  'WECHAT_',
];

function createProductionEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (APPLICATION_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      delete env[name];
    }
  }
  Object.assign(env, {
    ALIPAY_ENABLED: '0',
    BUSINESS_BACKEND_HOST: '127.0.0.1',
    BUSINESS_BACKEND_PORT: '43210',
    BUSINESS_ENABLE_DEV_RECHARGE: '0',
    FORTUNE_DRAW_PRICE_CENTS: '200',
    NODE_ENV: 'development',
    PAYMENT_MOCK_CONFIRMATION_ENABLED: '0',
    PAYMENT_PROVIDER_MODE: 'disabled',
    SMS_MOCK_EXPOSE_CODE: '0',
    SMS_PROVIDER_MODE: 'disabled',
    WECHAT_PAY_ENABLED: '0',
  }, overrides);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[name];
    }
  }
  return env;
}

function snapshotFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      modifiedAtMs: stats.mtimeMs,
      size: stats.size,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

function runProductionEntry(envOverrides) {
  return childProcess.spawnSync(process.execPath, [PRODUCTION_ENTRY], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: createProductionEnvironment(envOverrides),
    timeout: 5000,
    windowsHide: true,
  });
}

function requestPath(port, requestPathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPathname,
      method,
      headers: method === 'POST'
        ? { 'Content-Length': '0' }
        : undefined,
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
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function waitForHealth(child, port) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`production server exited with ${child.exitCode}`);
    }
    try {
      const response = await requestPath(port, '/api/health');
      if (response.statusCode === 200) {
        return response;
      }
    } catch {
      // The listener may not be ready yet.
    }
    await delay(50);
  }
  throw new Error('production server health check timed out');
}

function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('production server did not stop after SIGTERM'));
    }, 5000);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitForPortClosed(port) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      await requestPath(port, '/api/health');
    } catch {
      return;
    }
    await delay(50);
  }
  throw new Error('production server port remained open');
}

function removeTestDatabase(filePath) {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${filePath}${suffix}`, { force: true });
  }
}

test('package exposes a dedicated secret-free production entry', () => {
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(PROJECT_ROOT, 'package.json'),
    'utf8'
  ));
  assert.equal(
    packageJson.scripts['start:business-backend:production'],
    'node business_backend/production_server.js'
  );
  const source = fs.readFileSync(PRODUCTION_ENTRY, 'utf8');
  assert.match(source, /process\.env\.NODE_ENV = 'production'/);
  assert.doesNotMatch(source, /PAYMENT_PROVIDER_MODE/);
  assert.doesNotMatch(source, /BUSINESS_ENABLE_DEV_RECHARGE/);
  assert.doesNotMatch(source, /SMS_MOCK_EXPOSE_CODE/);
  assert.doesNotMatch(source, /PRIVATE KEY|API[_ ]?KEY|SECRET/i);
});

test('production entry fails before listening without an external path', () => {
  const defaultDatabaseBefore = snapshotFile(DEFAULT_DATABASE_PATH);
  const missingPath = runProductionEntry({
    BUSINESS_DATABASE_PATH: undefined,
  });
  assert.equal(missingPath.status, 1);
  assert.match(
    missingPath.stderr,
    /BUSINESS_DATABASE_PATH must be an absolute path in production/
  );
  assert.doesNotMatch(missingPath.stdout, /listening on/);
  assert.deepEqual(snapshotFile(DEFAULT_DATABASE_PATH), defaultDatabaseBefore);

  for (const databasePath of [
    'business.sqlite3',
    './data/business.sqlite3',
  ]) {
    const relativePath = runProductionEntry({
      BUSINESS_DATABASE_PATH: databasePath,
    });
    assert.equal(relativePath.status, 1);
    assert.match(relativePath.stderr, /absolute path in production/);
    assert.doesNotMatch(relativePath.stdout, /listening on/);
  }
});

test('production entry rejects project paths without creating a database', () => {
  const databasePath = path.join(
    PROJECT_ROOT,
    'business_backend',
    'data',
    `production-server-test-${crypto.randomUUID()}.sqlite3`
  );
  const normalizedPath = [
    path.join(PROJECT_ROOT, 'temporary-path-segment'),
    '..',
    'business_backend',
    'data',
    path.basename(databasePath),
  ].join(path.sep);
  try {
    assert.equal(fs.existsSync(databasePath), false);
    for (const configuredPath of [databasePath, normalizedPath]) {
      const result = runProductionEntry({
        BUSINESS_DATABASE_PATH: configuredPath,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /outside the project directory/);
      assert.doesNotMatch(result.stdout, /listening on/);
      assert.equal(fs.existsSync(databasePath), false);
    }
  } finally {
    removeTestDatabase(databasePath);
  }
});

test('production entry starts with disabled payment and external SQLite', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'business-production-server-test-')
  );
  const databasePath = path.join(directory, 'nested', 'business.sqlite3');
  const defaultDatabaseBefore = snapshotFile(DEFAULT_DATABASE_PATH);
  const port = await findAvailablePort();
  const child = childProcess.spawn(process.execPath, [PRODUCTION_ENTRY], {
    cwd: PROJECT_ROOT,
    env: createProductionEnvironment({
      BUSINESS_BACKEND_PORT: String(port),
      BUSINESS_DATABASE_PATH: databasePath,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-65536);
  });

  try {
    const health = await waitForHealth(child, port);
    assert.deepEqual(JSON.parse(health.body), {
      service: 'business-backend',
      status: 'ok',
    });
    assert.equal(fs.existsSync(databasePath), true);
    assert.deepEqual(snapshotFile(DEFAULT_DATABASE_PATH), defaultDatabaseBefore);

    const devRecharge = await requestPath(
      port,
      '/api/dev/recharge',
      'POST'
    );
    assert.equal(devRecharge.statusCode, 404);

    child.kill('SIGTERM');
    const exitResult = await waitForExit(child);
    assert.ok(
      exitResult.code === 0
      || exitResult.signal === 'SIGTERM'
      || process.platform === 'win32'
    );
    await waitForPortClosed(port);
    assert.equal(stderr, '');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child).catch(() => {});
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(directory), false);
});
