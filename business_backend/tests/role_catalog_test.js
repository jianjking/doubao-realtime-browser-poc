'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { PUBLIC_ROLES } = require('../config/public_roles');
const { createRoleService } = require('../services/role_service');

const EXPECTED_ROLES = [
  {
    slug: 'yuhuang',
    displayName: '玉皇大帝',
    available: true,
    sortOrder: 1,
  },
  {
    slug: 'sunwukong',
    displayName: '孙悟空',
    available: true,
    sortOrder: 2,
  },
  {
    slug: 'guanyin',
    displayName: '观音菩萨',
    available: true,
    sortOrder: 3,
  },
  {
    slug: 'caishen',
    displayName: '财神爷',
    available: true,
    sortOrder: 4,
  },
  {
    slug: 'rulai',
    displayName: '如来佛祖',
    available: true,
    sortOrder: 5,
  },
  {
    slug: 'zhubajie',
    displayName: '猪八戒',
    available: true,
    sortOrder: 6,
  },
  {
    slug: 'shawujing',
    displayName: '沙悟净',
    available: true,
    sortOrder: 7,
  },
  {
    slug: 'tangseng',
    displayName: '唐僧',
    available: true,
    sortOrder: 8,
  },
];

function copyExpectedRoles() {
  return EXPECTED_ROLES.map((role) => ({ ...role }));
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

async function startApp() {
  const server = http.createServer(createApp());
  await listenOnTemporaryPort(server);
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return {
    port: address.port,
    server,
  };
}

function requestPath(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers,
    }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
        });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Role catalog response was not valid JSON', {
      cause: error,
    });
  }
}

function collectObjectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') {
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectKeys(item, keys);
    }
    return keys;
  }
  for (const [key, childValue] of Object.entries(value)) {
    keys.push(key);
    collectObjectKeys(childValue, keys);
  }
  return keys;
}

test('public role configuration is deeply frozen and exact', () => {
  assert.equal(Object.isFrozen(PUBLIC_ROLES), true);
  assert.equal(PUBLIC_ROLES.length, 8);
  assert.deepEqual(PUBLIC_ROLES, EXPECTED_ROLES);
  for (const role of PUBLIC_ROLES) {
    assert.equal(Object.isFrozen(role), true);
    assert.deepEqual(Object.keys(role), [
      'slug',
      'displayName',
      'available',
      'sortOrder',
    ]);
  }
});

test('role service returns isolated copies in fixed order', () => {
  const sourceRoles = copyExpectedRoles().reverse();
  const roleService = createRoleService({ roles: sourceRoles });
  sourceRoles[0].displayName = 'changed source';

  const firstRoles = roleService.listPublicRoles();
  assert.deepEqual(firstRoles, EXPECTED_ROLES);
  firstRoles.reverse();
  firstRoles[0].displayName = 'changed result';

  assert.deepEqual(roleService.listPublicRoles(), EXPECTED_ROLES);

  const firstYuhuang = roleService.findPublicRoleBySlug('yuhuang');
  assert.deepEqual(firstYuhuang, EXPECTED_ROLES[0]);
  firstYuhuang.displayName = 'changed lookup result';
  assert.deepEqual(
    roleService.findPublicRoleBySlug('yuhuang'),
    EXPECTED_ROLES[0]
  );
});

test('role service requires an exact slug match', () => {
  const roleService = createRoleService({
    roles: copyExpectedRoles(),
  });

  assert.deepEqual(
    roleService.findPublicRoleBySlug('yuhuang'),
    EXPECTED_ROLES[0]
  );
  assert.equal(roleService.findPublicRoleBySlug('YUHuang'), null);
  assert.equal(roleService.findPublicRoleBySlug('玉皇大帝'), null);
  assert.equal(roleService.findPublicRoleBySlug('unknown'), null);
  assert.equal(roleService.findPublicRoleBySlug(null), null);
});

test('role service rejects invalid role configurations', () => {
  assert.throws(() => {
    createRoleService({ roles: copyExpectedRoles().slice(0, 7) });
  }, /exactly 8/);

  const duplicateSlugRoles = copyExpectedRoles();
  duplicateSlugRoles[1].slug = duplicateSlugRoles[0].slug;
  assert.throws(() => {
    createRoleService({ roles: duplicateSlugRoles });
  }, /Duplicate role slug/);

  const duplicateSortOrderRoles = copyExpectedRoles();
  duplicateSortOrderRoles[1].sortOrder =
    duplicateSortOrderRoles[0].sortOrder;
  assert.throws(() => {
    createRoleService({ roles: duplicateSortOrderRoles });
  }, /Duplicate role sortOrder/);

  const invalidAvailabilityRoles = copyExpectedRoles();
  invalidAvailabilityRoles[0].available = 'true';
  assert.throws(() => {
    createRoleService({ roles: invalidAvailabilityRoles });
  }, /available must be a boolean/);

  const emptyDisplayNameRoles = copyExpectedRoles();
  emptyDisplayNameRoles[0].displayName = '';
  assert.throws(() => {
    createRoleService({ roles: emptyDisplayNameRoles });
  }, /displayName must be a non-empty string/);
});

test('GET /api/roles is public and returns the strict catalog', async () => {
  const { port, server } = await startApp();

  try {
    const response = await requestPath(port, '/api/roles');
    assert.equal(response.statusCode, 200);
    assert.match(
      response.headers['content-type'] || '',
      /application\/json/i
    );
    const responseBody = parseJson(response.body);
    assert.deepEqual(responseBody, {
      roles: EXPECTED_ROLES,
    });
    assert.equal(responseBody.roles.length, 8);
    assert.equal(
      new Set(responseBody.roles.map((role) => role.slug)).size,
      8
    );
    assert.deepEqual(
      responseBody.roles.map((role) => role.sortOrder),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert.equal(
      responseBody.roles.every((role) => role.available === true),
      true
    );

    const ignoredInputsResponse = await requestPath(
      port,
      '/api/roles?available=false',
      { Cookie: 'companion_session=forged' }
    );
    assert.equal(ignoredInputsResponse.statusCode, 200);
    assert.deepEqual(
      parseJson(ignoredInputsResponse.body),
      responseBody
    );
  } finally {
    await closeServer(server);
  }
});

test('GET /api/roles does not expose internal configuration', async () => {
  const { port, server } = await startApp();
  const forbiddenKeys = new Set([
    'speaker',
    'speakerId',
    'voice',
    'voiceId',
    'prompt',
    'systemPrompt',
    'system_prompt',
    'appId',
    'accessToken',
    'apiKey',
    'token',
    'secret',
    'authorization',
  ]);

  try {
    const response = await requestPath(port, '/api/roles');
    const responseBody = parseJson(response.body);
    const responseKeys = collectObjectKeys(responseBody);
    assert.equal(
      responseKeys.some((key) => forbiddenKeys.has(key)),
      false
    );
    const forbiddenResponseStrings = [
      ['Web', 'Socket'].join(''),
      ['dou', 'bao'].join(''),
    ];
    for (const value of forbiddenResponseStrings) {
      assert.equal(response.body.includes(value), false);
    }
  } finally {
    await closeServer(server);
  }
});

test('health and default 404 behavior remain unchanged', async () => {
  const { port, server } = await startApp();

  try {
    const healthResponse = await requestPath(port, '/api/health');
    assert.equal(healthResponse.statusCode, 200);
    assert.deepEqual(parseJson(healthResponse.body), {
      status: 'ok',
      service: 'business-backend',
    });

    const missingResponse = await requestPath(port, '/api/not-found');
    assert.equal(missingResponse.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});
