// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A reply running on another device (or on a computer for this phone) shows
// the same busy state as a local one: the window reads it from the reply's
// lease. The renderer has no DOM harness here, so this reads its source.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const app = read('renderer', 'app.js');
const css = read('renderer', 'styles.css');
const html = read('renderer', 'index.html');
const fn = (name) => {
  const i = app.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} not found`);
  return app.slice(i, app.indexOf('\n}\n', i));
};

test('the composer is busy for any reply in the lease, and Stop is only offered where it can work', () => {
  const b = fn('updateSendButton');
  assert.match(b, /replyElsewhere\(S\.current\)/);
  assert.match(b, /el\.stopBtn\.hidden = !\(streaming \|\| canStop\)/);
  assert.match(b, /el\.busyDot\.hidden = !\(there && !canStop\)/);
  assert.match(app, /const canStopElsewhere = .*typeof api\.ai\.stopElsewhere === 'function'.*owner\.deviceId !== myDeviceId\(\)/);
  assert.match(html, /id="busyDot"/);
});

test('a reply this window does not run shows the readable "Replying on" line, also for this device\'s own phone copy', () => {
  assert.match(app, /Lease\.isReplyInProgress\(msg\) && !runsHere\(msg\)/);
  assert.doesNotMatch(app, /Lease\.foreignReply\(msg, myDeviceId\(\)\)\) container/);
  const rule = css.slice(css.indexOf('.replying-on {'), css.indexOf('}', css.indexOf('.replying-on {')));
  assert.match(rule, /color: var\(--text\)/);
  assert.match(rule, /margin-block-start/, 'logical properties, so Arabic (RTL) lays out the same');
  assert.doesNotMatch(rule, /margin-left|margin-right|text-align:\s*(left|right)/);
});

test('the busy state clears by itself: stale leases are interrupted for this device\'s own copy too, and the composer is redrawn', () => {
  const b = fn('expireLeases');
  assert.doesNotMatch(b, /deviceId === myDeviceId\(\)/);
  assert.match(b, /if \(changed\) updateComposer\(\)/);
});

test('a copy of this device\'s own reply refreshed since this window started is watched, not cut off', () => {
  assert.match(app, /return m\.owner\.deviceId !== myDeviceId\(\) \|\| m\.owner\.ts >= APP_STARTED/);
  assert.match(fn('readChat'), /!watchedReply\(m, now\)/);
});

test('Stop for a reply the computer holds goes through the computer, and says so when it cannot', () => {
  const b = fn('stopCurrent');
  assert.match(b, /api\.ai\.stopElsewhere\(chat\.id\)/);
  assert.match(b, /stopFailed/);
  assert.match(read('preload.js'), /stopElsewhere: invoke\('ai:stopElsewhere'\)/);
  assert.match(read('main.js'), /remote\.stopChat\(String\(chatId\)\)/);
});
