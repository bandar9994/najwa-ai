// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { support } = require('../renderer/store-flags.js');

const root = path.join(__dirname, '..');

test('every build shows the donation link, except the Google Play build', () => {
  const url = (info) => (support(info) ? support(info).url : null);
  assert.match(url({ store: '' }), /^https:\/\/ko-fi\.com\//);
  assert.match(url({}), /^https:\/\/ko-fi\.com\//, 'desktop reports no store');
  assert.match(url(undefined), /^https:\/\/ko-fi\.com\//);
  assert.match(url({ store: 'github' }), /^https:\/\/ko-fi\.com\//);
  assert.ok(support({}).label);
  assert.strictEqual(support({ store: 'play' }), null);
  assert.strictEqual(support({ store: ' Play ' }), null);
  assert.strictEqual(support({ store: 'PLAY' }), null);
  // An Android build that can't tell which store it is for plays safe.
  assert.strictEqual(support({ store: 'unknown' }), null);
});

// The code that ships in the app, not the README or the website.
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'build', '.gradle', 'fixtures'].includes(entry.name)) sources(full, out);
    } else if (/\.(js|mjs|html|css|java|kt|swift|xml|json|md|gradle|plist)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test('the donation URL is only in renderer/store-flags.js, where the Play build turns it off', () => {
  const dirs = ['renderer', 'mobile/src', 'src', 'android/app/src', 'native', 'ios/App/App'];
  const files = [...dirs.flatMap((d) => (fs.existsSync(path.join(root, d)) ? sources(path.join(root, d)) : [])),
    ...['main.js', 'preload.js', 'LICENSE', 'THIRD-PARTY-NOTICES.md'].map((f) => path.join(root, f))];
  const found = files.filter((f) => /ko-fi|kofi/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
  assert.deepStrictEqual(found.sort(), ['renderer/store-flags.js']);
});

test('the mobile build copies no README or website page (they link to the donation page)', () => {
  const build = fs.readFileSync(path.join(root, 'scripts/build-web.mjs'), 'utf8');
  assert.ok(!/README|site\/|FUNDING/.test(build));
  assert.ok(build.includes("renderer/store-flags.js"), 'the flag module is shipped');
  assert.ok(fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8').includes('store-flags.js'));
});

test('without NAJWA_STORE the Android build is not a Play build', () => {
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, /System\.getenv\("NAJWA_STORE"\)[^\n]*\?: ""/);
  assert.match(gradle, /buildConfigField "String", "NAJWA_STORE"/);
  // Only the Play workflow sets it.
  for (const wf of fs.readdirSync(path.join(root, '.github/workflows'))) {
    const text = fs.readFileSync(path.join(root, '.github/workflows', wf), 'utf8');
    assert.strictEqual(/NAJWA_STORE:\s*play/.test(text), wf === 'android-aab.yml', wf);
  }
});
