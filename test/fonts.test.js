// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The bundled Almarai font: the files exist, the CSS loads them from the app
// itself (no network), only for Arabic, and the licence is shipped.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('renderer', 'styles.css');

test('the Almarai Regular and Bold files are real WOFF2 fonts', () => {
  for (const name of ['Almarai-Regular.woff2', 'Almarai-Bold.woff2']) {
    const buf = fs.readFileSync(path.join(root, 'renderer', 'fonts', name));
    assert.strictEqual(buf.subarray(0, 4).toString('latin1'), 'wOF2', name);
    assert.ok(buf.length > 20000 && buf.length < 120000, `${name} is ${buf.length} bytes`);
  }
});

test('@font-face for Almarai 400 and 700: swap, relative urls, Arabic only', () => {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.strictEqual(faces.length, 2);
  const weights = faces.map((f) => /font-weight:\s*(\d+)/.exec(f)[1]).sort();
  assert.deepStrictEqual(weights, ['400', '700']);
  for (const f of faces) {
    assert.match(f, /font-family:\s*"Almarai"/);
    assert.match(f, /font-display:\s*swap/);
    assert.match(f, /src:\s*url\("fonts\/Almarai-(Regular|Bold)\.woff2"\)\s*format\("woff2"\)/);
    assert.ok(!/https?:|\/\//.test(f.replace(/\/\*[\s\S]*?\*\//g, '')), 'no absolute urls');
    const range = /unicode-range:\s*([^;]+);/.exec(f)[1];
    for (const r of ['U+0600-06FF', 'U+0750-077F', 'U+08A0-08FF', 'U+FB50-FDFF', 'U+FE70-FEFF']) assert.ok(range.includes(r), r);
    for (const token of range.split(',')) assert.ok(parseInt(token.trim().slice(2), 16) >= 0x0600, `${token} is not Latin`);
  }
  for (const w of ['Regular', 'Bold']) assert.ok(fs.existsSync(path.join(root, 'renderer', 'fonts', `Almarai-${w}.woff2`)));
});

test('Almarai is first in the text font stack and code fonts are untouched', () => {
  assert.match(css, /font:\s*14px\/1\.55 "Almarai", system-ui,/);
  const mono = css.match(/font-family:\s*ui-monospace[^;]*;/g) || [];
  assert.ok(mono.length >= 4);
  assert.ok(mono.every((m) => !m.includes('Almarai')));
});

test('the font ships in the desktop and mobile builds, with its licence', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('renderer/**/*'));
  const build = read('scripts', 'build-web.mjs');
  for (const f of ['Almarai-Regular.woff2', 'Almarai-Bold.woff2', 'OFL.txt']) assert.ok(build.includes(`renderer/fonts/${f}`), f);
  assert.match(read('renderer', 'fonts', 'OFL.txt'), /Copyright 2019 The Almarai Project Authors/);
  assert.match(read('THIRD-PARTY-NOTICES.md'), /Almarai.*SIL Open Font License 1\.1.*The Almarai Project Authors/);
});

test('the content security policies allow fonts from the app only', () => {
  const html = read('renderer', 'index.html');
  assert.match(html, /default-src 'self'/);
  assert.ok(!/font-src/.test(html) || /font-src 'self'/.test(html));
  const build = read('scripts', 'build-web.mjs');
  assert.match(build, /"default-src 'self'"/);
  assert.ok(!/font-src/.test(build) || /font-src 'self'/.test(build));
});
