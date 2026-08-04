'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_DIR = path.resolve(__dirname, '..');
const resolver = require('../public/realtime_websocket_url');
const { resolveRealtimeWebSocketUrl } = resolver;

function locationValue(href) {
  const url = new URL(href);
  return {
    host: url.host,
    hostname: url.hostname,
    protocol: url.protocol,
  };
}

test('HTTPS production pages use same-origin WSS for both relay paths', () => {
  const location = locationValue('https://xianban.samoyeai.cn/page');
  assert.equal(
    resolveRealtimeWebSocketUrl('/realtime', location),
    'wss://xianban.samoyeai.cn/realtime'
  );
  assert.equal(
    resolveRealtimeWebSocketUrl('/fortune-asr', location),
    'wss://xianban.samoyeai.cn/fortune-asr'
  );
});

test('same-origin resolution preserves non-default HTTPS and HTTP ports', () => {
  assert.equal(
    resolveRealtimeWebSocketUrl(
      '/realtime',
      locationValue('https://example.test:8443/nested/page')
    ),
    'wss://example.test:8443/realtime'
  );
  assert.equal(
    resolveRealtimeWebSocketUrl(
      '/fortune-asr',
      locationValue('http://example.test:8080/nested/page')
    ),
    'ws://example.test:8080/fortune-asr'
  );
});

test('HTTP loopback pages keep the existing local Relay topology', () => {
  for (const host of [
    'localhost:8765',
    '127.0.0.1:8765',
    '127.25.40.9:18765',
    '[::1]:8765',
  ]) {
    const location = locationValue(`http://${host}/page`);
    assert.equal(
      resolveRealtimeWebSocketUrl('/realtime', location),
      'ws://127.0.0.1:3001/realtime'
    );
    assert.equal(
      resolveRealtimeWebSocketUrl('/fortune-asr', location),
      'ws://127.0.0.1:3001/fortune-asr'
    );
  }
});

test('HTTPS loopback pages never downgrade to insecure local WS', () => {
  assert.equal(
    resolveRealtimeWebSocketUrl(
      '/realtime',
      locationValue('https://localhost:8443/page')
    ),
    'wss://localhost:8443/realtime'
  );
  assert.equal(
    resolveRealtimeWebSocketUrl(
      '/fortune-asr',
      locationValue('https://[::1]:8443/page')
    ),
    'wss://[::1]:8443/fortune-asr'
  );
});

test('invalid paths and page locations fail closed', () => {
  const location = locationValue('https://example.test/page');
  for (const pathname of [
    '',
    'realtime',
    '/realtime/',
    '/unknown',
    'wss://attacker.example/realtime',
  ]) {
    assert.throws(
      () => resolveRealtimeWebSocketUrl(pathname, location),
      /Unsupported realtime WebSocket path/
    );
  }
  assert.throws(
    () => resolveRealtimeWebSocketUrl('/realtime', {
      host: 'example.test',
      protocol: 'file:',
    }),
    /Unsupported page protocol/
  );
  assert.throws(
    () => resolveRealtimeWebSocketUrl('/realtime', {
      host: '',
      protocol: 'https:',
    }),
    /Current page host is invalid/
  );
});

test('browser consumers share the resolver and expose no endpoint override', () => {
  const callHtml = fs.readFileSync(
    path.join(PROJECT_DIR, 'public/index.html'),
    'utf8'
  );
  const callJs = fs.readFileSync(
    path.join(PROJECT_DIR, 'public/doubao_mic_single_turn.js'),
    'utf8'
  );
  const fortuneHtml = fs.readFileSync(
    path.join(PROJECT_DIR, 'ui_prototypes/yuhuang_mobile_v1/fortune.html'),
    'utf8'
  );
  const fortuneAsrJs = fs.readFileSync(
    path.join(
      PROJECT_DIR,
      'ui_prototypes/yuhuang_mobile_v1/fortune_browser_asr.js'
    ),
    'utf8'
  );

  assert.ok(
    callHtml.indexOf('/realtime-call/realtime_websocket_url.js')
      < callHtml.indexOf('/realtime-call/doubao_mic_single_turn.js')
  );
  assert.ok(
    fortuneHtml.indexOf('/realtime-call/realtime_websocket_url.js')
      < fortuneHtml.indexOf('./fortune_browser_asr.js')
  );
  assert.match(callJs, /resolveRealtimeWebSocketUrl\([\s\S]*RELAY_WEBSOCKET_PATH/);
  assert.match(fortuneAsrJs, /resolveRealtimeWebSocketUrl\([\s\S]*'\/fortune-asr'/);
  assert.doesNotMatch(callJs, /ws:\/\/(?:127\.0\.0\.1|localhost):3001/);
  assert.doesNotMatch(fortuneAsrJs, /ws:\/\/(?:127\.0\.0\.1|localhost):3001/);
  assert.doesNotMatch(
    `${callJs}\n${fortuneAsrJs}`,
    /searchParams[\s\S]{0,120}(?:socket|websocket|relay|wsUrl)/i
  );
});
