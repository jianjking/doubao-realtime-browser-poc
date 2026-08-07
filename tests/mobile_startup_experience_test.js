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
const MOBILE_PAGES = [
  'index.html',
  'choice.html',
  'home.html',
  'fortune.html',
];
const MONKEY_ASSET_FILENAME = 'sunwukong-loader-runner-v1.webp';
const FULL_MONKEY_ASSET_FILENAME = 'sunwukong-home-hero-v2.webp';
const MONKEY_ASSET = path.join(
  UI_ROOT,
  'assets',
  'characters',
  'sunwukong',
  MONKEY_ASSET_FILENAME
);

function readUiFile(filename) {
  return fs.readFileSync(path.join(UI_ROOT, filename), 'utf8');
}

function readWebpDimensions(buffer) {
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WEBP');

  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunkType === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunkType === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  assert.fail(`Unsupported WebP chunk type: ${chunkType}`);
}

function getLoaderMonkeyTag(html) {
  const match = html.match(/<img\b(?=[^>]*\bdata-loader-monkey\b)[^>]*>/);
  assert.ok(match, 'loader monkey image should exist');
  return match[0];
}

test('key mobile pages expose an immediate accessible loading layer', () => {
  for (const filename of MOBILE_PAGES) {
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
    assert.match(html, />仙伴<\/p>/);
    assert.match(html, /正在连接仙境，请稍候……/);
    assert.match(html, /data-loader-stage>正在打开仙伴/);
    assert.match(html, /data-loader-estimate-text>预计还需 5～10 秒/);
    assert.match(
      html,
      /data-loader-comfort>首次打开可能稍慢，请您耐心等一会儿/
    );
    assert.match(html, /data-loader-reload-note[^>]*hidden/);
    assert.match(html, /如果长时间没有进入，可以尝试重新加载/);
    assert.match(html, /data-loader-monkey/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /decoding="async"/);
    assert.match(html, /onerror="this\.hidden=true"/);
    assert.match(html, /radial-gradient/);
    assert.match(html, /linear-gradient\(180deg, #742530/);
    assert.match(html, /src="\.\/startup-loader\.js"/);
    assert.ok(
      loaderMarkupPosition < html.indexOf('src="./startup-loader.js"')
    );
    assert.match(
      html,
      /src="\.\/startup-loader\.js"\s+onerror="[^"]*data-loader-status[^"]*data-loader-reload-note[^"]*data-loader-reload[^"]*"/
    );
  }
});

test('all mobile pages keep the same loader HTML and critical CSS', () => {
  const loaderStyles = [];
  const loaderMarkup = [];

  for (const filename of MOBILE_PAGES) {
    const html = readUiFile(filename);
    loaderStyles.push(html.match(/<style>([\s\S]*?)<\/style>/)[1]);
    loaderMarkup.push(
      html.slice(
        html.indexOf('<div class="xianban-startup-loader"'),
        Math.min(
          ...[
            html.indexOf('<main'),
            html.indexOf('<div class="app-shell"'),
          ].filter((position) => position >= 0)
        )
      ).trim()
    );
  }

  assert.equal(new Set(loaderStyles).size, 1);
  assert.equal(new Set(loaderMarkup).size, 1);
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
  assert.match(loaderJs, /资源加载时间较长，请您再耐心等一会儿/);
  assert.match(loaderJs, /window\.location\.reload\(\)/);
  assert.match(loaderJs, /reloadButton\.disabled = true/);
  assert.match(loaderJs, /window\.clearTimeout\(viewportUpdateTimer\)/);
  assert.match(loaderJs, /window\.removeEventListener\('resize'/);
  assert.match(loaderJs, /visualViewport\.removeEventListener\('resize'/);
  assert.match(loaderJs, /window\.addEventListener\('pagehide'/);
  assert.match(loaderJs, /if \(appReady \|\| hasFailed \|\| isFinishing\)/);
  assert.match(authJs, /typeof window\.XianBanStartup\.markAppReady/);
  assert.match(homeJs, /typeof window\.XianBanStartup\.markAppReady/);
  assert.match(authJs, /XianBanStartup\.markAppReady\(\)/);
  assert.match(homeJs, /startup\.markAppReady\(\)/);
});

test('home title prioritizes full role names over long account copy', () => {
  const homeCss = readUiFile('ui.css');
  const homeJs = readUiFile('ui.js');
  const roleNames = [
    '玉皇大帝',
    '孙悟空',
    '观音菩萨',
    '财神爷',
    '如来佛祖',
    '猪八戒',
    '沙悟净',
    '唐僧',
  ];

  assert.match(
    homeCss,
    /\.unified-top-controls\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:/
  );
  assert.match(
    homeCss,
    /\.unified-title-area\s*\{[\s\S]*?position:\s*static;[\s\S]*?width:\s*auto;/
  );
  assert.match(
    homeCss,
    /\.unified-title-area h1\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?text-overflow:\s*clip;[\s\S]*?white-space:\s*normal;/
  );
  assert.match(
    homeCss,
    /\.unified-account-area \.account-summary-copy strong\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/
  );
  for (const roleName of roleNames) {
    assert.ok(homeJs.includes(`name: '${roleName}'`));
  }
});

test('startup loader gates required tasks without a fixed minimum delay', () => {
  const loaderJs = readUiFile('startup-loader.js');

  assert.match(loaderJs, /const tasks = new Map\(\)/);
  assert.match(loaderJs, /startupApi\.registerTask = registerTask/);
  assert.match(loaderJs, /startupApi\.markTaskReady = markTaskReady/);
  assert.match(loaderJs, /startupApi\.markTaskFailed = markTaskFailed/);
  assert.match(loaderJs, /startupApi\.getState/);
  assert.match(loaderJs, /task\.status = 'degraded'/);
  assert.match(loaderJs, /task\.status = 'failed'/);
  assert.match(loaderJs, /hasPendingRequiredTasks\(\)/);
  assert.match(loaderJs, /Math\.min\(value, 95\)/);
  assert.match(loaderJs, /finishFrame = requestFrame[\s\S]*?stableFrame = requestFrame/);
  assert.match(loaderJs, /tasks\.clear\(\)/);
  assert.match(loaderJs, /xianban:startup-complete/);
  assert.doesNotMatch(loaderJs, /minimumVisibleUntil/);
  assert.doesNotMatch(loaderJs, /startedAt \+ 550/);
});

test('home startup registers image, account, UI, worklet and layout gates', () => {
  const homeHtml = readUiFile('home.html');
  const homeJs = readUiFile('ui.js');
  const startupBlock = homeJs.slice(
    homeJs.indexOf("startup.registerTask('ui-initialization'")
  );

  assert.match(homeHtml, /data-startup-critical-style/);
  assert.match(homeHtml, /data-startup-critical-image/);
  assert.match(homeJs, /waitForStartupImage\(/);
  assert.match(homeJs, /degradeHomeCharacterImage/);
  assert.match(homeJs, /is-character-image-unavailable/);
  assert.match(startupBlock, /'ui-initialization'/);
  assert.match(startupBlock, /'account-state'/);
  assert.match(startupBlock, /'home-current-character-image'/);
  assert.match(startupBlock, /'home-audioworklet'/);
  assert.match(startupBlock, /'home-css-layout'/);
  assert.match(startupBlock, /'home-role-catalog'/);
  assert.match(startupBlock, /\/realtime-call\/pcm_capture_processor\.js/);
  assert.match(homeJs, /response\.arrayBuffer\(\)/);
  assert.match(homeJs, /xianban:startup-complete/);
  assert.doesNotMatch(startupBlock, /getUserMedia\s*\(/);
  assert.doesNotMatch(startupBlock, /new WebSocket\s*\(/);
  assert.doesNotMatch(startupBlock, /fetch\(CALL_API_URL/);
});

test('fortune uses the shared loader and registers complete startup gates', () => {
  const fortuneHtml = readUiFile('fortune.html');
  const fortuneJs = readUiFile('fortune.js');
  const startupBlock = fortuneJs.slice(
    fortuneJs.indexOf('const paidStateReadyPromise')
  );

  assert.ok(fortuneHtml.indexOf('data-xianban-loader') > 0);
  assert.ok(
    fortuneHtml.indexOf('src="./startup-loader.js"')
      < fortuneHtml.indexOf('src="./fortune.js"')
  );
  assert.equal(
    (fortuneHtml.match(/data-startup-critical-style/g) || []).length,
    2
  );
  assert.match(fortuneJs, /fortuneSceneReadyPromise/);
  assert.match(startupBlock, /'fortune-scene-image'/);
  assert.match(startupBlock, /'fortune-acolyte-image'/);
  assert.match(startupBlock, /'fortune-paid-state'/);
  assert.match(startupBlock, /'fortune-asr-api'/);
  assert.match(startupBlock, /'fortune-asr-worklet'/);
  assert.match(startupBlock, /'fortune-css-layout'/);
  assert.match(startupBlock, /'fortune-ui-initialization'/);
  assert.match(startupBlock, /'fortune-button-bindings'/);
  assert.match(startupBlock, /\/realtime-assets\/pcm_capture_processor\.js/);
  assert.doesNotMatch(startupBlock, /getUserMedia\s*\(/);
  assert.doesNotMatch(startupBlock, /new WebSocket\s*\(/);
  assert.doesNotMatch(startupBlock, /createSession\s*\(/);
  assert.doesNotMatch(startupBlock, /fetch\(FORTUNE_SESSION_API_URL/);
});

test('loader stages, estimates, comfort rotation, and cleanup stay bounded', () => {
  const loaderJs = readUiFile('startup-loader.js');
  const expectedStageMessages = [
    '正在打开仙伴',
    '正在准备页面',
    '正在迎接神仙伙伴',
    '正在同步陪伴信息',
    '马上就准备好了',
    '仙伴已准备好',
  ];
  const expectedComfortMessages = [
    '首次打开可能稍慢，请您耐心等一会儿',
    '仙伴正在准备陪您说话',
    '神仙伙伴正在赶来的路上',
    '请别着急，马上就好',
    '网络较慢时，准备时间会多一点',
  ];

  for (const message of expectedStageMessages) {
    assert.ok(loaderJs.includes(`'${message}'`));
  }
  for (const message of expectedComfortMessages) {
    assert.ok(loaderJs.includes(`'${message}'`));
  }

  assert.match(loaderJs, /value >= 90[\s\S]*value >= 70[\s\S]*value >= 40[\s\S]*value >= 20/);
  assert.match(loaderJs, /if \(nextStageIndex < stageIndex\)/);
  assert.match(loaderJs, /elapsedSeconds < 4/);
  assert.match(loaderJs, /预计还需 5～10 秒/);
  assert.match(loaderJs, /elapsedSeconds < 8/);
  assert.match(loaderJs, /预计还需 5～15 秒/);
  assert.match(loaderJs, /elapsedSeconds < 15/);
  assert.match(loaderJs, /当前网络较慢，可能还需 10～20 秒/);
  assert.match(loaderJs, /elapsedSeconds < 24/);
  assert.match(loaderJs, /首次打开资源较多，请再耐心等一会儿/);
  assert.match(loaderJs, /加载时间较长，您可以继续等待或重新加载/);
  assert.match(loaderJs, /estimateText\.textContent = '即将进入'/);
  assert.match(loaderJs, /setInterval\(rotateComfortMessage, 4500\)/);
  assert.match(loaderJs, /clearInterval\(estimateTimer\)/);
  assert.match(loaderJs, /clearInterval\(comfortTimer\)/);
  assert.match(loaderJs, /window\.addEventListener\('pagehide', cleanupPage\)/);
  assert.match(loaderJs, /window\.cancelAnimationFrame\(progressFrame\)/);
  assert.equal((loaderJs.match(/setTargetProgress\(100\)/g) || []).length, 1);
});

test('monkey animation is optional, motion-safe, and uses a lightweight WebP', () => {
  const loaderJs = readUiFile('startup-loader.js');
  const monkeyBuffer = fs.readFileSync(MONKEY_ASSET);
  const dimensions = readWebpDimensions(monkeyBuffer);

  assert.ok(fs.existsSync(MONKEY_ASSET));
  assert.ok(monkeyBuffer.length > 0);
  assert.ok(monkeyBuffer.length <= 50 * 1024);
  assert.ok(dimensions.width >= 68 * 2);
  assert.ok(dimensions.height >= 80 * 2);
  assert.ok(Math.max(dimensions.width, dimensions.height) <= 360);
  assert.notDeepEqual(dimensions, { width: 941, height: 1672 });
  assert.match(loaderJs, /monkeyImage\.hidden = true/);
  assert.match(loaderJs, /monkeyImage\.naturalWidth === 0/);
  assert.doesNotMatch(loaderJs, /monkeyImage\.addEventListener\(['"]load/);
  assert.doesNotMatch(loaderJs, /monkeyImage\.decode\(/);
  assert.doesNotMatch(loaderJs, /sunwukong-loader-runner-v1\.webp/);

  for (const filename of MOBILE_PAGES) {
    const html = readUiFile(filename);
    const monkeyTag = getLoaderMonkeyTag(html);
    const preloadTags = html.match(/<link\b[^>]*>/g) || [];

    assert.match(monkeyTag, new RegExp(MONKEY_ASSET_FILENAME));
    assert.doesNotMatch(monkeyTag, new RegExp(FULL_MONKEY_ASSET_FILENAME));
    assert.match(monkeyTag, /width="272"/);
    assert.match(monkeyTag, /height="320"/);
    assert.match(monkeyTag, /alt=""/);
    assert.match(monkeyTag, /aria-hidden="true"/);
    assert.match(monkeyTag, /loading="lazy"/);
    assert.match(monkeyTag, /decoding="async"/);
    assert.match(monkeyTag, /fetchpriority="low"/);
    assert.match(monkeyTag, /onerror="this\.hidden=true"/);
    assert.doesNotMatch(monkeyTag, /data-(?:startup-)?critical-resource/);
    assert.doesNotMatch(monkeyTag, /data-startup-critical-image/);
    assert.equal(
      preloadTags.some((tag) => tag.includes(MONKEY_ASSET_FILENAME)),
      false
    );
    assert.match(html, /@keyframes xianban-monkey-run/);
    assert.match(html, /translate3d\(/);
    assert.match(html, /scaleX\(-1\)/);
    assert.match(html, /animation: xianban-monkey-run 6\.6s/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(html, /animation: xianban-monkey-breathe 3\.6s/);
    assert.doesNotMatch(html, /https?:\/\/[^"']+(?:\.gif|\.mp4|\.woff)/i);
  }
});

test('choice uses width-first mobile layout while home keeps dynamic viewport', () => {
  const choiceCss = readUiFile('choice-poster.css');
  const homeCss = readUiFile('ui.css');
  const loaderJs = readUiFile('startup-loader.js');
  const mobileChoiceCss = choiceCss.slice(
    choiceCss.indexOf('@media (max-width: 767px)')
  );

  assert.match(loaderJs, /window\.visualViewport\.height/);
  assert.match(loaderJs, /--app-height/);
  assert.match(choiceCss, /safe-area-inset-top/);
  assert.match(choiceCss, /safe-area-inset-bottom/);
  assert.match(choiceCss, /@media \(min-width: 768px\)/);
  assert.match(choiceCss, /max-width:\s*852px;/);
  assert.notEqual(mobileChoiceCss, '');
  assert.match(
    mobileChoiceCss,
    /html,\s*body\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;[\s\S]*?overflow-y:\s*auto;/
  );
  assert.match(
    mobileChoiceCss,
    /\.choice-page\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;[\s\S]*?height:\s*auto;/
  );
  assert.match(
    mobileChoiceCss,
    /\.choice-poster-stage\s*\{[\s\S]*?width:\s*100%;[\s\S]*?padding:\s*0 0 calc\(12px \+ var\(--safe-bottom\)\);/
  );
  assert.match(
    mobileChoiceCss,
    /\.choice-poster-frame\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;[\s\S]*?height:\s*auto;/
  );
  assert.match(
    mobileChoiceCss,
    /\.choice-poster-image\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*auto;[\s\S]*?object-fit:\s*initial;/
  );
  assert.doesNotMatch(mobileChoiceCss, /--choice-usable-height/);
  assert.doesNotMatch(mobileChoiceCss, /transform:\s*scale\(/);
  assert.match(homeCss, /--app-height: 100dvh/);
  assert.match(homeCss, /grid-template-rows:\s*minmax\(0, 1fr\)\s*clamp/);
  assert.doesNotMatch(homeCss, /min-height: 640px/);
});
