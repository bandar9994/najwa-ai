// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Report = require('../renderer/report');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const parse = (url) => {
  const m = /^mailto:([^?]*)\?subject=([^&]*)&body=(.*)$/s.exec(url);
  assert.ok(m, `not a mailto link: ${url.slice(0, 80)}`);
  return { to: decodeURIComponent(m[1]), subject: decodeURIComponent(m[2]), body: decodeURIComponent(m[3]) };
};
const base = { reason: 'Hateful', note: 'It insulted me', model: 'ollama / llama3', version: '1.0.317', platform: 'android', reply: 'Hello there' };

test('the report email goes to the support address with the fixed subject', () => {
  const { url, truncated } = Report.buildMailto(base);
  const m = parse(url);
  assert.equal(m.to, 'bandar.altariqi@gmail.com');
  assert.equal(m.subject, 'Najwa AI: reported reply');
  assert.equal(truncated, false);
  assert.ok(url.startsWith('mailto:bandar.altariqi@gmail.com?subject=Najwa%20AI%3A%20reported%20reply&body='));
});

test('the body has the reason, note, model, app version and platform and the reply', () => {
  const { body } = parse(Report.buildMailto(base).url);
  assert.match(body, /^Reason: Hateful$/m);
  assert.match(body, /^Note: It insulted me$/m);
  assert.match(body, /^Model: ollama \/ llama3$/m);
  assert.match(body, /^App: Najwa AI 1\.0\.317 on android$/m);
  assert.match(body, /Reply:\r\nHello there/);
  assert.doesNotMatch(body, /cut to the first/);
});

test('special characters are encoded so they cannot change the link', () => {
  const nasty = 'a&b=c?d#e%f +g\n"h" <i> \u{1F600}';
  const { url } = Report.buildMailto({ ...base, note: nasty, reply: nasty });
  // Only the two real separators are left in the query.
  assert.equal(url.slice(url.indexOf('?') + 1).split('&').length, 2);
  assert.doesNotMatch(url, /[\s"<>#]/);
  assert.equal(url.includes('\n'), false);
  const { body } = parse(url);
  assert.ok(body.includes('a&b=c?d#e%f +g'));
  assert.ok(body.includes('\u{1F600}'));
});

test('Arabic text in the note and the reply comes back unchanged', () => {
  const ar = 'مرحبًا، هذا رد غير مناسب.\nالسطر الثاني';
  const { url } = Report.buildMailto({ ...base, note: 'ملاحظة: مسيء', reply: ar });
  const { body } = parse(url);
  assert.ok(body.includes('Note: ملاحظة: مسيء'));
  assert.ok(body.includes('مرحبًا، هذا رد غير مناسب.\r\nالسطر الثاني'));
  assert.doesNotMatch(url, /[^\x20-\x7e]/, 'the link itself is plain ASCII');
});

test('a long reply is cut to 1500 characters and the body says so', () => {
  const reply = 'x'.repeat(5000);
  const { url, truncated, replyChars } = Report.buildMailto({ ...base, reply });
  assert.equal(truncated, true);
  assert.equal(replyChars, 1500);
  const { body } = parse(url);
  assert.match(body, /Reply \(cut to the first 1500 of 5000 characters\):/);
  assert.equal(body.split('x').length - 1, 1500);
  assert.ok(url.length <= Report.MAX_URL_CHARS);
});

test('a reply of exactly 1500 characters is not marked as cut', () => {
  const out = Report.buildMailto({ ...base, reply: 'y'.repeat(1500) });
  assert.equal(out.truncated, false);
  assert.equal(out.replyChars, 1500);
});

test('a long Arabic reply is cut more, so the link stays a safe length', () => {
  const reply = 'م'.repeat(3000);
  const out = Report.buildMailto({ ...base, reply, note: 'ن'.repeat(1000) });
  assert.ok(out.url.length <= Report.MAX_URL_CHARS, `link is ${out.url.length} characters`);
  assert.equal(out.truncated, true);
  assert.ok(out.replyChars > 100 && out.replyChars < 1500);
  const { body } = parse(out.url);
  assert.match(body, /cut to the first \d+ of 3000 characters/);
  assert.equal(Report.isAllowedExternal(out.url), true);
});

test('cutting never splits an emoji', () => {
  const reply = '\u{1F600}'.repeat(1000);
  const { url } = Report.buildMailto({ ...base, reply });
  assert.doesNotThrow(() => decodeURIComponent(url.slice(url.indexOf('body='))));
});

test('an unknown reason becomes Other and missing details do not break the email', () => {
  const { body } = parse(Report.buildMailto({ reason: 'bogus' }).url);
  assert.match(body, /^Reason: Other$/m);
  assert.match(body, /^Note: \(none\)$/m);
  assert.match(body, /^Model: \(unknown\)$/m);
  assert.doesNotThrow(() => Report.buildMailto());
});

test('only the report email may be opened as a mailto link (nothing broader)', () => {
  const ok = Report.buildMailto(base).url;
  assert.equal(Report.isAllowedExternal(ok), true);
  assert.equal(Report.isAllowedExternal('mailto:bandar.altariqi@gmail.com'), true);
  assert.equal(Report.isAllowedExternal('mailto:bandar.altariqi%40gmail.com?subject=x'), true);
  for (const bad of [
    'mailto:someone@example.com',
    'mailto:someone@example.com?subject=x',
    'mailto:bandar.altariqi@gmail.com,someone@example.com',
    'mailto:bandar.altariqi@gmail.com?cc=someone@example.com',
    'mailto:bandar.altariqi@gmail.com?subject=x&bcc=someone@example.com',
    'mailto:bandar.altariqi@gmail.com?to=someone@example.com',
    'mailto:?to=bandar.altariqi@gmail.com',
    'mailto:',
    'tel:+966500000000',
    'sms:+966500000000',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'intent://x#Intent;end',
    'ftp://example.com',
    '',
    null
  ]) assert.equal(Report.isAllowedExternal(bad), false, String(bad));
});

test('web links are still allowed, and so is the privacy policy', () => {
  assert.equal(Report.isAllowedExternal('https://example.com/a?b=c'), true);
  assert.equal(Report.isAllowedExternal('http://example.com'), true);
  assert.equal(Report.PRIVACY_URL, 'https://bandar9994.github.io/privacy.html');
  assert.equal(Report.isAllowedExternal(Report.PRIVACY_URL), true);
});

test('main.js uses the same check for new windows and for navigation', () => {
  const main = read('main.js');
  assert.match(main, /require\('\.\/renderer\/report'\)/);
  assert.equal((main.match(/isAllowedExternal\(url\)/g) || []).length, 2);
  assert.doesNotMatch(main, /\/\^https\?:\\\/\\\/\/\.test\(url\)\) shell\.openExternal/);
});

// ---- the reported marks (this device only) ----

test('reporting marks the reply, other replies stay unmarked', () => {
  const marks = Report.addReported({}, 'chat1', 'm1', 'Violent', 1000);
  assert.equal(Report.isReported(marks, 'chat1', 'm1'), true);
  assert.equal(Report.isReported(marks, 'chat1', 'm2'), false);
  assert.equal(Report.isReported(marks, 'chat2', 'm1'), false);
  assert.equal(Report.isReported(undefined, 'chat1', 'm1'), false);
  assert.deepEqual(marks['chat1:m1'], { reason: 'Violent', at: 1000 });
});

test('adding a mark does not change the marks it was given', () => {
  const before = Object.freeze({ 'a:b': { reason: 'Other', at: 1 } });
  const after = Report.addReported(before, 'c', 'd', 'Sexual', 2);
  assert.deepEqual(Object.keys(before), ['a:b']);
  assert.deepEqual(Object.keys(after).sort(), ['a:b', 'c:d']);
});

test('only the newest marks are kept', () => {
  let marks = {};
  for (let i = 0; i < Report.MAX_REPORTED + 25; i++) marks = Report.addReported(marks, 'c', `m${i}`, 'Other', i + 1);
  assert.equal(Object.keys(marks).length, Report.MAX_REPORTED);
  assert.equal(Report.isReported(marks, 'c', 'm0'), false);
  assert.equal(Report.isReported(marks, 'c', `m${Report.MAX_REPORTED + 24}`), true);
});

test('deleting a chat drops its marks only', () => {
  let marks = Report.addReported({}, 'c1', 'm1', 'Other', 1);
  marks = Report.addReported(marks, 'c1', 'm2', 'Other', 2);
  marks = Report.addReported(marks, 'c10', 'm1', 'Other', 3);
  marks = Report.dropReported(marks, 'c1');
  assert.deepEqual(Object.keys(marks), ['c10:m1']);
});

test('reading the saved state ignores anything malformed', () => {
  assert.deepEqual(Report.readReported(undefined), {});
  assert.deepEqual(Report.readReported([1, 2]), {});
  assert.deepEqual(Report.readReported('x'), {});
  const read = Report.readReported({ 'a:b': { reason: 'Hateful', at: 5 }, bad: { at: 1 }, 'c:d': 'x', 'e:f': { reason: 'zzz', at: 7 }, 'g:h': { at: 'no' } });
  assert.deepEqual(read, { 'a:b': { reason: 'Hateful', at: 5 }, 'e:f': { reason: 'Other', at: 7 } });
});

test('the marks live in the local state, not in the chat or the synced data', () => {
  const app = read('renderer/app.js');
  assert.match(app, /api\.state\.save\(\{ reported: S\.state\.reported \}\)/);
  // Nothing is written on the message or the chat object.
  assert.doesNotMatch(app, /(msg|m|chat)\.(reported|reportedAt)\s*=/);
  assert.doesNotMatch(read('src/sync.js'), /reported/);
  assert.doesNotMatch(read('src/storage.js'), /reported/);
});

// ---- strings ----

test('every string exists in English and Arabic, and Arabic is Arabic', () => {
  const en = Object.keys(Report.STRINGS.en).sort();
  assert.deepEqual(Object.keys(Report.STRINGS.ar).sort(), en);
  for (const key of en) {
    const arabic = key === 'reasonName' ? Report.text(key, 'Offensive', 'ar') : Report.text(key, undefined, 'ar');
    assert.match(arabic, /[\u0600-\u06FF]/, key);
  }
  for (const r of Report.REASONS) {
    assert.match(Report.text('reasonName', r, 'ar'), /[\u0600-\u06FF]/, r);
    assert.ok(Report.text('reasonName', r, 'en'));
  }
});

test('the about note says what was asked', () => {
  assert.equal(Report.text('useNote', undefined, 'en'), 'Don\'t use Najwa AI to create illegal or harmful content. Models you download from third parties aren\'t made or controlled by Najwa AI.');
});

test('the report script is loaded by the app and copied for the phone', () => {
  assert.match(read('renderer/index.html'), /<script src="report\.js"><\/script>\s*<script src="speech-text\.js">/);
  assert.match(read('scripts/build-web.mjs'), /renderer\/report\.js/);
});
