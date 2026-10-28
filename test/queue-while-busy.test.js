// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Messages sent while a reply runs: which ones steer the reply, which stop it
// and continue, and which wait in the queue, one at a time and in order. This
// runs the real functions from renderer/app.js against small fakes.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const Lease = require('../src/lease.js');
const take = (head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, head);
  const end = head === 'const queued = {' ? src.indexOf('\n};\n', start) + 4 : head.startsWith('const') ? src.indexOf('\n', start) + 1 : src.indexOf('\n}\n', start) + 3;
  return src.slice(start, end);
};
const parts = [
  'const isAgent = ',
  'const queuedByChat = ', 'const queued = {', 'const retryAt = ', 'const fromQueue = ',
  'function interruptFor(', 'function midReplyAction(', 'async function sendWhileReplying(',
  'function canSendQueued(', 'function sendQueued(', 'function flushQueued(', 'function flushAllQueued('
].map(take).join('\n');

function world({ model, steerTakes = false, elsewhere = null } = {}) {
  const chat = { id: 'c1', messages: [{ id: 'u0', role: 'user', content: 'first' }] };
  const log = { steered: [], aborted: [], runs: 0, putBack: [], toasts: [] };
  const S = { requests: new Map(), cache: new Map([['c1', chat]]), current: chat };
  const ctx = {
    S, Lease, log, elsewhere: () => ctx.__elsewhere,
    __elsewhere: elsewhere,
    isStreaming: (c) => [...S.requests.values()].some((r) => r.chat === c),
    replyElsewhere: () => ctx.__elsewhere,
    uid: (() => { let n = 0; return () => `id${++n}`; })(),
    scheduleMessageRender() {}, saveChatSoon() {}, drawQueued() {},
    putBack: (c, list) => log.putBack.push(list),
    toast: (t) => log.toasts.push(t),
    loadChat: async () => null,
    runCompletion: (c) => { log.runs++; ctx.S.requests.set(`r${log.runs}`, { chat: c, msg: { model: ctx.model } }); },
    api: { ai: { steer: async (id, text) => { log.steered.push(text); return steerTakes; }, abort: (id) => log.aborted.push(id) } },
    model, Date, WeakMap, Map
  };
  vm.createContext(ctx);
  vm.runInContext(`${parts}; this.fns = { midReplyAction, sendWhileReplying, sendQueued, flushQueued, flushAllQueued, queued, retryAt, fromQueue, interruptFor };`, ctx);
  const startReply = (m = model) => ctx.S.requests.set('live', { chat, msg: { model: m, tools: [] } });
  return { ctx, chat, log, S, fns: ctx.fns, startReply };
}

const provider = (p, model = 'x') => ({ provider: p, model });

test('who steers and who queues', () => {
  const { fns } = world();
  for (const m of [provider('ollama'), provider('lmstudio'), provider('onDevice'), provider('anthropic'), provider('openai')]) {
    assert.strictEqual(fns.midReplyAction(m), 'steer', m.provider);
  }
  assert.strictEqual(fns.midReplyAction(provider('hermes')), 'queue');
  assert.strictEqual(fns.midReplyAction(provider('computer', 'qwen (Mac, Hermes Agent)')), 'queue');
  assert.strictEqual(fns.midReplyAction(provider('computer', 'qwen')), 'queue', 'the phone cannot hand a message to a reply on the computer');
});

test('a reply working with tools reads the message after its step, nothing stops', async () => {
  const w = world({ model: provider('anthropic'), steerTakes: true });
  w.startReply();
  await w.fns.sendWhileReplying(w.chat, 'also check pricing', []);
  assert.deepStrictEqual(w.log.steered, ['also check pricing']);
  assert.deepStrictEqual(w.log.aborted, []);
  assert.strictEqual((w.fns.queued.get(w.chat) || []).length, 0);
  const step = w.S.requests.get('live').msg.tools[0];
  assert.strictEqual(step.status, 'sent');
});

test('plain streaming: the reply is stopped and kept, and the message goes next', async () => {
  const w = world({ model: provider('ollama'), steerTakes: false });
  w.startReply();
  await w.fns.sendWhileReplying(w.chat, 'actually, shorter please', []);
  assert.deepStrictEqual(w.log.aborted, ['live']);
  const r = w.S.requests.get('live');
  assert.strictEqual(r.interrupted, true);
  assert.strictEqual(r.stopped, true);
  assert.strictEqual(w.fns.queued.get(w.chat).length, 1);
  assert.strictEqual(r.msg.tools.length, 0, 'no leftover "sending" step');
  // The stopped reply ends like runCompletion does for an interrupted one: the message goes.
  w.S.requests.delete('live');
  w.fns.sendQueued(w.chat, { ok: true });
  assert.strictEqual(w.log.runs, 1);
  assert.strictEqual(w.chat.messages.at(-1).content, 'actually, shorter please');
});

test('a message with a picture cannot be read mid-way: it stops the reply and goes next', async () => {
  const w = world({ model: provider('anthropic'), steerTakes: true });
  w.startReply();
  await w.fns.sendWhileReplying(w.chat, 'look', ['data:image/jpeg;base64,xx']);
  assert.deepStrictEqual(w.log.steered, []);
  assert.deepStrictEqual(w.log.aborted, ['live']);
});

test('Hermes Agent and a computer\'s models: the message waits, the reply is not touched', async () => {
  for (const m of [provider('hermes'), provider('computer', 'qwen')]) {
    const w = world({ model: m, steerTakes: true });
    w.startReply();
    await w.fns.sendWhileReplying(w.chat, 'later', []);
    assert.deepStrictEqual(w.log.steered, []);
    assert.deepStrictEqual(w.log.aborted, []);
    assert.strictEqual(w.fns.queued.get(w.chat).length, 1);
  }
});

test('the queue sends one message at a time, in order, after each reply', () => {
  const w = world({ model: provider('hermes') });
  w.fns.queued.set(w.chat, [{ text: 'one', images: [] }, { text: 'two', images: [] }, { text: 'three', images: [] }]);
  w.fns.sendQueued(w.chat, { ok: true });
  assert.strictEqual(w.log.runs, 1);
  assert.strictEqual(w.chat.messages.at(-1).content, 'one');
  assert.strictEqual(w.fns.queued.get(w.chat).length, 2);
  w.fns.sendQueued(w.chat, { ok: true }); // reply 1 is still running: waits
  assert.strictEqual(w.log.runs, 1);
  w.S.requests.clear();
  w.fns.sendQueued(w.chat, { ok: true });
  assert.strictEqual(w.chat.messages.at(-1).content, 'two');
  w.S.requests.clear();
  w.fns.sendQueued(w.chat, { ok: true });
  assert.strictEqual(w.chat.messages.at(-1).content, 'three');
  assert.strictEqual(w.fns.queued.get(w.chat), undefined);
});

test('Stop keeps the queue going; a failed reply puts the messages back in the box', () => {
  const stopped = world({ model: provider('ollama') });
  stopped.fns.queued.set(stopped.chat, [{ text: 'next', images: [] }]);
  stopped.fns.sendQueued(stopped.chat, { ok: true, aborted: true });
  assert.strictEqual(stopped.log.runs, 1);
  const failed = world({ model: provider('ollama') });
  failed.fns.queued.set(failed.chat, [{ text: 'next', images: [] }]);
  failed.fns.sendQueued(failed.chat, { ok: false, error: 'boom' });
  assert.strictEqual(failed.log.runs, 0);
  assert.strictEqual(failed.log.putBack.length, 1);
});

test('while another device writes the reply nothing is sent, and it goes once the lease is gone', () => {
  const w = world({ model: provider('ollama'), elsewhere: { owner: { name: 'PC' } } });
  w.fns.queued.set(w.chat, [{ text: 'wait', images: [] }]);
  w.fns.flushQueued(w.chat);
  w.fns.sendQueued(w.chat, { ok: true });
  assert.strictEqual(w.log.runs, 0, 'no request that would come back busy');
  assert.strictEqual(w.fns.queued.get(w.chat).length, 1);
  w.ctx.__elsewhere = null; // the reply ended, or its lease ran out
  w.fns.flushQueued(w.chat);
  assert.strictEqual(w.log.runs, 1);
  assert.strictEqual(w.chat.messages.at(-1).content, 'wait');
});

test('a message the computer still refused stays queued and is not tried again at once', () => {
  const w = world({ model: provider('computer', 'qwen') });
  const entry = { text: 'again', images: [] };
  w.fns.retryAt.set('c1', Date.now() + 5000);
  w.fns.queued.set(w.chat, [entry]);
  w.fns.flushQueued(w.chat);
  assert.strictEqual(w.log.runs, 0);
  w.fns.retryAt.set('c1', Date.now() - 1);
  w.fns.flushQueued(w.chat);
  assert.strictEqual(w.log.runs, 1);
  assert.strictEqual(w.fns.fromQueue.get(w.chat.messages.at(-1)), entry);
});

test('the busy answer puts a queued message back at the front (source)', () => {
  assert.match(src, /const entry = fromQueue\.get\(asker\);[\s\S]*?queued\.set\(chat, \[entry, \.\.\.\(queued\.get\(chat\) \|\| \[\]\)\]\);[\s\S]*?retryAt\.set\(chat\.id, Date\.now\(\) \+ 5000\)/);
});

test('queue strings exist in English and Arabic, and the queued bubble is RTL-safe', () => {
  for (const lang of ['en', 'ar']) {
    assert.ok(Lease.text('queued', '', lang));
    assert.ok(Lease.text('removeQueued', '', lang));
  }
  const css = fs.readFileSync(path.join(__dirname, '../renderer/styles.css'), 'utf8');
  const rule = css.match(/\.queued-item \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /padding-(left|right)|margin-(left|right)/);
  assert.match(src, /class: 'queued-text', dir: 'auto'/);
});
