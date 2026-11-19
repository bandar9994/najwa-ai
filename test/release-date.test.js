// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The rolling releases get each new build's date, which Obtainium and Orion
// Store show as the update's date (uploading new files alone keeps the date
// the release was first published).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const SCRIPT = path.join(root, 'scripts', 'refresh-release.sh');

test('each rolling release is refreshed after its files are uploaded', () => {
  for (const [file, tag] of [['android.yml', 'android-latest'], ['ios.yml', 'ios-latest'], ['build.yml', 'desktop-latest']]) {
    const src = fs.readFileSync(path.join(root, '.github', 'workflows', file), 'utf8');
    const upload = src.indexOf(`gh release upload ${tag}`);
    const edit = src.indexOf(`gh release edit ${tag}`);
    const refresh = src.indexOf(`bash scripts/refresh-release.sh ${tag}`);
    assert.ok(upload > 0 && edit > upload && refresh > edit, file);
  }
  // The desktop publish job has no checkout of its own otherwise.
  const build = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
  const publish = build.slice(build.indexOf('\n  publish:'));
  assert.match(publish, /uses: actions\/checkout@v\d+\n\s+with:\n\s+sparse-checkout: scripts/);
});

test('the refresh moves the tag, then republishes, and never leaves a draft quietly', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.strictEqual(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  const tagMove = src.indexOf('git/refs/tags/$tag');
  const draft = src.indexOf('-F draft=true');
  const publish = src.indexOf('-F draft=false');
  assert.ok(tagMove > 0 && draft > tagMove && publish > draft);
  assert.match(src, /::error::The \$tag release is still a draft/);
  assert.match(src, /exit 1\s*$/);
});
