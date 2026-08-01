'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../app');

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

function requestPath(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
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
    throw new Error('Health response was not valid JSON', {
      cause: error,
    });
  }
}

test('business backend exposes only the health route', async () => {
  const app = createApp();
  const server = http.createServer(app);

  try {
    await listenOnTemporaryPort(server);
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const healthResponse = await requestPath(address.port, '/api/health');
    assert.equal(healthResponse.statusCode, 200);
    assert.match(
      healthResponse.headers['content-type'] || '',
      /application\/json/i
    );
    assert.deepEqual(parseJson(healthResponse.body), {
      status: 'ok',
      service: 'business-backend',
    });

    const missingResponse = await requestPath(address.port, '/not-found');
    assert.equal(missingResponse.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test('configured business backend serves the authoritative mobile UI', async () => {
  const fortuneAudioWorkletFile = path.resolve(
    __dirname,
    '../../public/pcm_capture_processor.js'
  );
  const app = createApp({
    mobileUiDirectory: path.resolve(
      __dirname,
      '../../ui_prototypes/yuhuang_mobile_v1'
    ),
    fortuneAudioWorkletFile,
  });
  const server = http.createServer(app);

  try {
    await listenOnTemporaryPort(server);
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const rootResponse = await requestPath(address.port, '/');
    assert.equal(rootResponse.statusCode, 302);
    assert.equal(
      rootResponse.headers.location,
      '/ui_prototypes/yuhuang_mobile_v1/index.html'
    );

    for (const requestedFile of [
      'choice.html',
      'fortune.html',
      'fortune_browser_asr.js',
      'fortune.js',
      'entry.css',
      'index.html',
      'home.html',
      'ui.js',
    ]) {
      const response = await requestPath(
        address.port,
        `/ui_prototypes/yuhuang_mobile_v1/${requestedFile}`
      );
      assert.equal(response.statusCode, 200);
      assert.notEqual(response.body, '');
    }
    const homeResponse = await requestPath(
      address.port,
      '/ui_prototypes/yuhuang_mobile_v1/home.html'
    );
    assert.match(homeResponse.body, /data-current-credit>--</);

    const workletResponse = await requestPath(
      address.port,
      '/realtime-assets/pcm_capture_processor.js'
    );
    assert.equal(workletResponse.statusCode, 200);
    assert.match(
      workletResponse.headers['content-type'] || '',
      /(?:text|application)\/javascript/i
    );
    assert.match(workletResponse.body, /registerProcessor\s*\(/);
    assert.equal(
      workletResponse.body,
      fs.readFileSync(fortuneAudioWorkletFile, 'utf8')
    );

    const oldRootResponse = await requestPath(
      address.port,
      '/pcm_capture_processor.js'
    );
    assert.equal(oldRootResponse.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});
