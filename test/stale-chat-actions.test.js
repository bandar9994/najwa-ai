// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A message's buttons must act on the chat the window shows now, not on the
// chat object that existed when the message was drawn (sync swaps in a fresh
// copy without redrawing messages that did not change), and a refused action
// must say why. The renderer has no DOM harness here, so this reads its source.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const fn = (name) => {
  const i = app.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} not found`);
  const end = app.indexOf('\n}\n', i);
  return app.slice(i, end);
};

test('Regenerate, Delete and Edit resolve the live chat first', () => {
  assert.match(app, /onclick: \(\) => regenerate\(liveChat\(chat\)\)/);
  assert.match(app, /deleteMessage\(now, liveMessage\(now, msg\)\)/);
  assert.match(app, /startEdit\(now, liveMessage\(now, msg\), node\)/);
  const live = fn('liveChat');
  assert.match(live, /S\.current && S\.current\.id === chat\.id/);
});

test('Regenerate never returns silently, and checks for a foreign reply before dropping the old one', () => {
  const body = fn('regenerate');
  assert.doesNotMatch(body, /isStreaming\(chat\)\) return;/);
  assert.ok(body.indexOf('replyElsewhere(chat)') > 0 && body.indexOf('replyElsewhere(chat)') < body.indexOf('chat.messages.pop()'));
});

test('a failed request from the window ends the reply with an error instead of leaving it running', () => {
  assert.match(app, /replyModel: model\n  \}\)\.catch\(\(err\) => \(\{ ok: false, error:/);
});
