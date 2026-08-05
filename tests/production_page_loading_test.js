'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(
  PROJECT_ROOT,
  'ui_prototypes',
  'yuhuang_mobile_v1'
);
const { createApp } = require('../business_backend/app');

function requestPath(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.end();
  });
}

test('production pages expose compatible responsive image assets', () => {
  const choiceHtml = fs.readFileSync(
    path.join(UI_ROOT, 'choice.html'),
    'utf8'
  );
  const fortuneHtml = fs.readFileSync(
    path.join(UI_ROOT, 'fortune.html'),
    'utf8'
  );
  const homeJs = fs.readFileSync(path.join(UI_ROOT, 'ui.js'), 'utf8');
  const fortuneJs = fs.readFileSync(
    path.join(UI_ROOT, 'fortune.js'),
    'utf8'
  );

  assert.match(choiceHtml, /choice-poster-unified-v2\.webp/);
  assert.match(choiceHtml, /choice-poster-unified-v2\.png/);
  assert.match(fortuneHtml, /data-fortune-character-image-webp/);
  assert.match(fortuneHtml, /src=""/);
  assert.doesNotMatch(fortuneJs, /preloadIntegratedFortuneScenes/);
  assert.match(homeJs, /setTimeout\(\(\) => \{/);
  assert.match(homeJs, /requestIdleCallback\(warmup/);

  const imagePairs = [
    [
      'assets/choice/choice-poster-unified-v2.png',
      'assets/choice/choice-poster-unified-v2.webp',
    ],
    [
      'assets/fortune/daotong-guide-v1.png',
      'assets/fortune/daotong-guide-v1.webp',
    ],
    [
      'assets/fortune/scenes/fortune-scene-guanyin-v1.png',
      'assets/fortune/scenes/fortune-scene-guanyin-v1.webp',
    ],
    [
      'assets/fortune/scenes/fortune-scene-caishen-v1.png',
      'assets/fortune/scenes/fortune-scene-caishen-v1.webp',
    ],
    [
      'assets/fortune/scenes/fortune-scene-rulai-v1.png',
      'assets/fortune/scenes/fortune-scene-rulai-v1.webp',
    ],
  ];
  for (const [pngRelativePath, webpRelativePath] of imagePairs) {
    const pngPath = path.join(UI_ROOT, pngRelativePath);
    const webpPath = path.join(UI_ROOT, webpRelativePath);
    assert.equal(fs.existsSync(pngPath), true);
    assert.equal(fs.existsSync(webpPath), true);
    assert.ok(fs.statSync(webpPath).size < fs.statSync(pngPath).size);
  }
});

test('static cache headers separate documents, code, images, and API', async () => {
  const app = createApp({
    mobileUiDirectory: UI_ROOT,
    realtimeUiDirectory: path.join(PROJECT_ROOT, 'public'),
    nodeEnv: 'test',
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.equal(typeof address, 'object');
    const html = await requestPath(
      address.port,
      '/ui_prototypes/yuhuang_mobile_v1/home.html'
    );
    const code = await requestPath(
      address.port,
      '/ui_prototypes/yuhuang_mobile_v1/ui.js'
    );
    const image = await requestPath(
      address.port,
      '/ui_prototypes/yuhuang_mobile_v1/assets/characters/'
        + 'yuhuang/yuhuang-home-hero-v1.webp'
    );
    const api = await requestPath(address.port, '/api/health');

    assert.equal(html.statusCode, 200);
    assert.equal(html.headers['cache-control'], 'no-cache');
    assert.equal(code.statusCode, 200);
    assert.equal(
      code.headers['cache-control'],
      'public, max-age=0, must-revalidate'
    );
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['cache-control'], 'public, max-age=604800');
    assert.notEqual(api.headers['cache-control'], 'public, max-age=604800');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
