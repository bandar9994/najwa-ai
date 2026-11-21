// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// "What's new" in each release's notes (scripts/whats-new.mjs).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../scripts/whats-new.mjs');
const c = (message, files = ['renderer/app.js'], parents = [{}]) => ({ message, files, parents });

test('newest change first, one line each, from the commit\'s first line', async () => {
  const { whatsNew } = await load();
  const out = whatsNew([c('Older change.\n\nDetails nobody reads.'), c('Newer change')]);
  assert.strictEqual(out, '- Newer change\n- Older change');
  assert.strictEqual(whatsNew([]), '');
});

test('what people don\'t see, and other platforms\' apps, are left out', async () => {
  const { whatsNew, area } = await load();
  const commits = [
    c('Releases: each build gives its release a new date', ['scripts/refresh-release.sh', '.github/workflows/android.yml', 'test/release-date.test.js']),
    c('Website: new screenshots', ['site/index.html', 'README.md']),
    c('Phone models: Gemma stops at the end of its turn', ['native/llama/engine/balimda_engine.cpp']),
    c('Desktop: Whisper starts faster', ['main.js']),
    c('iPhone: the keyboard no longer covers the box', ['ios/App/App/Info.plist']),
    c('Android: downloads keep going in the background', ['android/app/src/main/AndroidManifest.xml']),
    c('Search finds words in Arabic', ['renderer/app.js', 'test/x.test.js'])
  ];
  assert.strictEqual(whatsNew(commits, { platform: 'android' }), '- Search finds words in Arabic\n- Android: downloads keep going in the background\n- Phone models: Gemma stops at the end of its turn');
  assert.strictEqual(whatsNew(commits, { platform: 'ios' }), '- Search finds words in Arabic\n- iPhone: the keyboard no longer covers the box\n- Phone models: Gemma stops at the end of its turn');
  assert.strictEqual(whatsNew(commits, { platform: 'desktop' }), '- Search finds words in Arabic\n- Desktop: Whisper starts faster');
  // Only behind-the-scenes changes: said so, rather than an empty list.
  assert.match(whatsNew(commits.slice(0, 2)), /nothing you will notice/);
  assert.strictEqual(area('src/turn-guard.js'), 'mobile');
  assert.strictEqual(area('src/voice-desktop.js'), 'desktop');
  assert.strictEqual(area('src/sync.js'), 'shared');
});

test('a commit can word its own line, or leave itself out; merges are left out', async () => {
  const { whatsNew } = await load();
  const out = whatsNew([
    c('Engine: has_special_token fallback\n\nWhat\'s new: Gemma answers and stops, even from a file with no chat template'),
    c('Refactor the sidebar\n\nWhat\'s new: none'),
    c('Merge branch \'bandar/x\' into main', ['renderer/app.js'], [{}, {}]),
    c('Two things\n\nWhat\'s new: Faster search\nWhat\'s new: Dark mode follows the phone')
  ]);
  assert.strictEqual(out, '- Faster search\n- Dark mode follows the phone\n- Gemma answers and stops, even from a file with no chat template');
});

test('long lists are cut to fit (Google Play allows 500 characters)', async () => {
  const { whatsNew } = await load();
  const many = Array.from({ length: 30 }, (_, i) => c(`Change number ${i + 1} with a fairly long description of what it does`));
  const out = whatsNew(many, { maxChars: 500 });
  assert.ok(out.length <= 500, out.length);
  assert.match(out, /^- Change number 30 /);
  assert.match(out, /- …and \d+ more$/);
  assert.match(whatsNew(many), /- …and 18 more$/);   // 12 lines at most
});

test('the commits come from GitHub\'s compare, with each one\'s files', async () => {
  const { commitsBetween } = await load();
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push([url, opts.headers.Authorization]);
    const body = url.includes('/compare/')
      ? { commits: [{ sha: 'a1', commit: { message: 'One' }, parents: [{}] }, { sha: 'b2', commit: { message: 'Two' }, parents: [{}] }] }
      : { files: [{ filename: url.endsWith('a1') ? 'renderer/app.js' : 'test/t.js' }] };
    return { ok: true, json: async () => body };
  };
  const commits = await commitsBetween({ repo: 'o/r', since: 'old', head: 'new', token: 't', fetch });
  assert.deepStrictEqual(commits, [
    { message: 'One', parents: [{}], files: ['renderer/app.js'] },
    { message: 'Two', parents: [{}], files: ['test/t.js'] }
  ]);
  assert.strictEqual(seen[0][0], 'https://api.github.com/repos/o/r/compare/old...new?per_page=250');
  assert.strictEqual(seen[0][1], 'Bearer t');
});

test('each release, and the Google Play upload, gets "What\'s new"', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
  for (const [file, tag, platform] of [['android.yml', 'android-latest', 'android'], ['ios.yml', 'ios-latest', 'ios'], ['build.yml', 'desktop-latest', 'desktop']]) {
    const src = read(file);
    // From the release before: its tag is read before refresh-release.sh moves it.
    const prev = src.indexOf(`git/ref/tags/${tag}`);
    const notes = src.indexOf(`node scripts/whats-new.mjs --platform ${platform} --since "$PREV"`);
    const refresh = src.indexOf(`bash scripts/refresh-release.sh ${tag}`);
    assert.ok(prev > 0 && notes > prev && refresh > notes, file);
    assert.match(src, /What's new:\n\s+\$\{NEW\}/, file);
  }
  const aab = read('android-aab.yml');
  assert.match(aab, /if \[ -z "\$NOTES" \]; then[\s\S]*whats-new\.mjs --platform android --since "\$PREV" --max-chars 500[\s\S]*play-upload\.mjs[^\n]*--notes "\$NOTES"/);
  assert.match(aab, /actions: read/);
});
