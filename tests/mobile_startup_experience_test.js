'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(
  PROJECT_ROOT,
  'ui_prototypes',
  'yuhuang_mobile_v1'
);

function readUiFile(filename) {
  return fs.readFileSync(path.join(UI_ROOT, filename), 'utf8');
}

test('key mobile pages expose an immediate accessible loading layer', () => {
  for (const filename of ['index.html', 'choice.html', 'home.html']) {
    const html = readUiFile(filename);
    const loaderStylePosition = html.indexOf('.xianban-startup-loader');
    const pageStylesheetPosition = html.indexOf('rel="stylesheet"');
    const loaderMarkupPosition = html.indexOf('data-xianban-loader');
    const pageContentPosition = Math.max(
      html.indexOf('<main'),
      html.indexOf('<div class="app-shell"')
    );

    assert.match(html, /viewport-fit=cover/);
    assert.ok(loaderStylePosition > 0);
    assert.ok(loaderStylePosition < pageStylesheetPosition);
    assert.ok(loaderMarkupPosition > 0);
    assert.ok(loaderMarkupPosition < pageContentPosition);
    assert.match(html, /role="progressbar"/);
    assert.match(html, /data-loader-progress-text>12%/);
    assert.match(html, /data-loader-reload[^>]*hidden/);
    assert.match(html, /src="\.\/startup-loader\.js"/);
    assert.ok(
      loaderMarkupPosition < html.indexOf('src="./startup-loader.js"')
    );
    assert.match(
      html,
      /src="\.\/startup-loader\.js"\s+onerror="[^"]*data-loader-status[^"]*data-loader-reload[^"]*"/
    );
  }
});

test('startup loader waits for real milestones and supports slow networks', () => {
  const loaderJs = readUiFile('startup-loader.js');
  const choiceHtml = readUiFile('choice.html');
  const homeHtml = readUiFile('home.html');
  const authJs = readUiFile('auth.js');
  const homeJs = readUiFile('ui.js');

  assert.match(choiceHtml, /data-startup-critical-image/);
  assert.match(homeHtml, /data-startup-critical-image/);
  assert.match(loaderJs, /criticalImage\.complete/);
  assert.match(loaderJs, /Math\.min\(value, 95\)/);
  assert.match(loaderJs, /!imageReady\s*\|\|\s*!appReady\s*\|\|\s*!windowReady/);
  assert.match(loaderJs, /8000/);
  assert.match(loaderJs, /24000/);
  assert.match(loaderJs, /当前网络较慢，仙伴仍在努力加载/);
  assert.match(loaderJs, /资源加载时间较长，请继续等待/);
  assert.match(loaderJs, /window\.location\.reload\(\)/);
  assert.match(loaderJs, /window\.clearTimeout\(viewportUpdateTimer\)/);
  assert.match(loaderJs, /window\.removeEventListener\('resize'/);
  assert.match(loaderJs, /visualViewport\.removeEventListener\('resize'/);
  assert.match(loaderJs, /window\.addEventListener\('pagehide'/);
  assert.match(loaderJs, /if \(appReady \|\| hasFailed \|\| isFinishing\)/);
  assert.match(authJs, /typeof window\.XianBanStartup\.markAppReady/);
  assert.match(homeJs, /typeof window\.XianBanStartup\.markAppReady/);
  assert.match(authJs, /XianBanStartup\.markAppReady\(\)/);
  assert.match(homeJs, /XianBanStartup\.markAppReady\(\)/);
});

test('choice and home layouts use dynamic viewport and safe-area bounds', () => {
  const choiceCss = readUiFile('choice-poster.css');
  const homeCss = readUiFile('ui.css');
  const loaderJs = readUiFile('startup-loader.js');

  assert.match(loaderJs, /window\.visualViewport\.height/);
  assert.match(loaderJs, /--app-height/);
  assert.match(choiceCss, /--choice-usable-height/);
  assert.match(choiceCss, /safe-area-inset-top/);
  assert.match(choiceCss, /safe-area-inset-bottom/);
  assert.match(choiceCss, /height: var\(--app-height, 100vh\)/);
  assert.match(homeCss, /--app-height: 100dvh/);
  assert.match(homeCss, /grid-template-rows:\s*minmax\(0, 1fr\)\s*clamp/);
  assert.doesNotMatch(homeCss, /min-height: 640px/);
});
