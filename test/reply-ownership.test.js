// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Who is writing a reply: the lease (src/lease.js), how sync merges copies of
// a reply (src/sync.js), what the app does with a half-written reply it loads
// (renderer/app.js, readChat) and the computer's own copy of a phone's reply
// (src/reply-hub.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Lease = require('../src/lease');
const { mergeChats } = require('../src/sync');
const { createReplyHub } = require('../src/reply-hub');
const { Storage } = require('../src/storage');
const { nodeFsBackend } = require('../src/backends/node-fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = 1_800_000_000_000;
const owner = (deviceId, ts, name = 'Pixel') => ({ deviceId, name, ts });
const q = { id: 'q', role: 'user', content: 'Cheapest ticket?', createdAt: 1 };
const reply = (extra) => ({ id: 'r', role: 'assistant', content: '', createdAt: 2, ...extra });
const chat = (modifiedAt, ...messages) => ({ id: 'c', modifiedAt, updatedAt: modifiedAt, messages });

// ---- the lease ------------------------------------------------------------

test('a lease is live until it has been quiet for the lease time, and not when it is dated far ahead', () => {
  assert.ok(Lease.leaseLive(owner('p', NOW - 10_000), NOW));
  assert.ok(Lease.leaseLive(owner('p', NOW - Lease.LEASE_MS), NOW));
  assert.ok(!Lease.leaseLive(owner('p', NOW - Lease.LEASE_MS - 1), NOW));
  // A little ahead (the other clock is fast) is fine; hours ahead is not.
  assert.ok(Lease.leaseLive(owner('p', NOW + 60_000), NOW));
  assert.ok(!Lease.leaseLive(owner('p', NOW + 60 * 60_000), NOW));
  assert.ok(!Lease.leaseLive(null, NOW));
  assert.ok(!Lease.leaseLive({ deviceId: 'p' }, NOW));
});

test('foreignReply is a live reply of another device, never one of this device or one without an owner', () => {
  const live = reply({ pending: true, owner: owner('phone', NOW - 1000) });
  assert.ok(Lease.foreignReply(live, 'pc', NOW));
  assert.ok(!Lease.foreignReply(live, 'phone', NOW));
  assert.ok(!Lease.foreignReply(reply({ pending: true, owner: owner('phone', NOW - 5 * 60_000) }), 'pc', NOW));
  assert.ok(!Lease.foreignReply(reply({ pending: true }), 'pc', NOW));
  assert.ok(!Lease.foreignReply(reply({ owner: owner('phone', NOW) }), 'pc', NOW));
  assert.strictEqual(Lease.foreignInChat(chat(1, q, live), 'pc', NOW), live);
  assert.strictEqual(Lease.foreignInChat(chat(1, q), 'pc', NOW), null);
});

test('interrupt ends a reply the way it always ended, and flags one that had an owner', () => {
  const old = Lease.interrupt(reply({ pending: true }));
  assert.deepStrictEqual(old, reply({ pending: false, error: 'This reply was interrupted.' }));  // exactly as before owners existed
  const owned = Lease.interrupt(reply({ pending: true, content: 'Book ear', owner: owner('phone', NOW) }));
  assert.strictEqual(owned.pending, false);
  assert.strictEqual(owned.interrupted, true);
  assert.strictEqual(owned.owner, undefined);
  assert.strictEqual(owned.error, undefined, 'a reply with text keeps its text and shows no error');
});

test('the app\'s "Replying on" text exists in English and Arabic', () => {
  assert.strictEqual(Lease.text('replyingOn', 'Pixel', 'en'), 'Replying on Pixel…');
  assert.match(Lease.text('replyingOn', 'Pixel', 'ar'), /Pixel/);
  assert.match(Lease.text('replyingOn', 'Pixel', 'ar'), /[\u0600-\u06FF]/);
  for (const key of Object.keys(Lease.STRINGS.en)) assert.ok(Lease.STRINGS.ar[key], `Arabic text for ${key}`);
});

// ---- merge ----------------------------------------------------------------

test('merge: a live reply of its owner is not beaten by another device\'s cut-off copy of it', () => {
  const live = chat(10, q, reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 5000) }));
  // The computer loaded the chat while the lease was live... and an old app marked the reply interrupted.
  const cut = chat(20, q, reply({ content: 'Boo', interrupted: true }));
  assert.strictEqual(mergeChats(live, cut, { now: NOW }).messages[1].pending, true);
  assert.strictEqual(mergeChats(cut, live, { now: NOW }).messages[1].content, 'Book');
  // Cut off by an app that doesn't know owners at all: the owner is left on a reply that isn't pending.
  const oldApp = chat(20, q, reply({ content: 'Boo', owner: owner('phone', NOW - 5000) }));
  assert.strictEqual(mergeChats(live, oldApp, { now: NOW }).messages[1].pending, true);
  // Without an owner (all chats before this change) the newer, finished-looking copy won, and still does.
  const plain = chat(20, q, reply({ content: 'Boo' }));
  assert.strictEqual(mergeChats(live, plain, { now: NOW }).messages[1].pending, undefined);
});

test('merge: the owner\'s finished reply beats a live, a stale and an interrupted copy', () => {
  const done = chat(10, q, reply({ content: 'Book early.', stats: { engine: 'GPU' } }));
  for (const other of [
    reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 1000) }),
    reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 10 * 60_000) }),
    reply({ pending: true }),
    reply({ content: 'Boo', interrupted: true }),
    reply({ error: 'This reply was interrupted.' })
  ]) {
    const newer = chat(50, q, other);
    assert.strictEqual(mergeChats(newer, done, { now: NOW }).messages[1].content, 'Book early.');
    assert.strictEqual(mergeChats(done, newer, { now: NOW }).messages[1].content, 'Book early.');
  }
});

test('merge: a stale lease counts as interrupted, as a reply without an owner always did', () => {
  const stale = chat(20, q, reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 10 * 60_000) }));
  const interrupted = chat(10, q, reply({ error: 'This reply was interrupted.' }));
  // pending (stale or ownerless) is the lowest; an interrupted message is above it.
  assert.strictEqual(mergeChats(stale, interrupted, { now: NOW }).messages[1].error, 'This reply was interrupted.');
  const plain = chat(20, q, reply({ pending: true }));
  assert.strictEqual(mergeChats(plain, interrupted, { now: NOW }).messages[1].error, 'This reply was interrupted.');
});

test('merge: of two live copies, the owner\'s later one wins, whichever device is newer', () => {
  const early = reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 9000) });
  const late = reply({ pending: true, content: 'Book early', owner: owner('phone', NOW - 1000) });
  assert.strictEqual(mergeChats(chat(99, q, early), chat(1, q, late), { now: NOW }).messages[1].content, 'Book early');
  assert.strictEqual(mergeChats(chat(1, q, early), chat(99, q, late), { now: NOW }).messages[1].content, 'Book early');
});

test('merge: the phone\'s own finished reply replaces the computer\'s record of it, with no duplicate', () => {
  const record = chat(50, q, reply({ content: 'Book early.', mirrored: true, stats: { engine: 'Ollama on Desk' } }));
  const own = chat(40, q, reply({ content: 'Book early.', stats: { engine: 'Ollama on Desk' }, tools: [{ id: 't' }] }));
  for (const merged of [mergeChats(record, own), mergeChats(own, record)]) {
    assert.strictEqual(merged.messages.length, 2);
    assert.strictEqual(merged.messages[1].mirrored, undefined);
    assert.deepStrictEqual(merged.messages[1].tools, [{ id: 't' }]);
  }
  // The record alone (phone closed mid-reply) is the finished reply.
  const pending = chat(30, q, reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 1000) }));
  assert.strictEqual(mergeChats(pending, record, { now: NOW }).messages[1].content, 'Book early.');
});

test('merge: chats and messages without owners merge as before, and old apps ignore what is added', () => {
  const a = { modifiedAt: 2, updatedAt: 2, messages: [{ id: '1', createdAt: 1 }, { id: '3', createdAt: 3 }] };
  const b = { modifiedAt: 1, updatedAt: 1, messages: [{ id: '1', createdAt: 1 }, { id: '2', createdAt: 2 }] };
  assert.deepStrictEqual(mergeChats(a, b).messages.map((m) => m.id), ['1', '2', '3']);
  // The extra fields are plain JSON on the message: nothing else about the chat changes.
  const m = reply({ pending: true, owner: owner('phone', NOW) });
  assert.deepStrictEqual(Object.keys(mergeChats(chat(2, q, m), chat(1, q), { now: NOW })), ['id', 'modifiedAt', 'updatedAt', 'messages']);
});

// ---- what the app does with a chat it loads ------------------------------------

// Runs the real readChat() from renderer/app.js, with a fake storage.
function readChatWith(stored, deviceId, startedAt = 0) {
  const src = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const take = (head) => {
    const start = src.indexOf(head);
    assert.ok(start >= 0, head);
    return src.slice(start, src.indexOf('\n}\n', start) + 3);
  };
  const body = `${take('function watchedReply(')}${take('async function readChat(id) {')}`;
  const context = vm.createContext({ Lease, api: { chats: { get: async () => structuredClone(stored) } }, myDeviceId: () => deviceId, APP_STARTED: startedAt, Date });
  return vm.runInContext(`${body}; readChat`, context);
}

test('loading a chat leaves a reply another device is still writing, and ends every other half-written one', async () => {
  const stored = chat(1, q,
    reply({ id: 'live', pending: true, content: 'Book', owner: owner('phone', Date.now() - 2000) }),
    reply({ id: 'stale', pending: true, content: 'Boo', owner: owner('phone', Date.now() - 10 * 60_000) }),
    reply({ id: 'mine', pending: true, content: 'Bo', owner: owner('pc', Date.now() - 2000) }),
    reply({ id: 'plain', pending: true }),
    reply({ id: 'done', content: 'Done.' }));
  const read = await readChatWith(stored, 'pc', Date.now())('c');
  const by = Object.fromEntries(read.messages.filter((m) => m.role === 'assistant').map((m) => [m.id, m]));
  assert.strictEqual(by.live.pending, true, 'live lease of another device stays pending');
  assert.strictEqual(by.live.owner.name, 'Pixel');
  assert.strictEqual(by.stale.pending, false);
  assert.strictEqual(by.stale.interrupted, true);
  assert.strictEqual(by.stale.content, 'Boo');
  assert.strictEqual(by.mine.pending, false, 'this device is not writing it any more (the app was closed)');
  assert.deepStrictEqual(by.plain, reply({ id: 'plain', pending: false, error: 'This reply was interrupted.' }), 'as before');
  assert.strictEqual(by.done.content, 'Done.');
});

test('loading a chat on the phone: the computer\'s live copy of this phone\'s own reply is watched, a leftover from before the app started is cut off', async () => {
  const started = Date.now() - 60_000;
  const stored = chat(1, q,
    reply({ id: 'pcCopy', pending: true, content: 'Book early', owner: owner('phone', Date.now() - 3000) }),
    reply({ id: 'leftover', pending: true, content: 'Bo', owner: owner('phone', started - 5000) }),
    reply({ id: 'deadCopy', pending: true, content: 'Boo', owner: owner('phone', Date.now() - 10 * 60_000) }));
  const read = await readChatWith(stored, 'phone', started)('c');
  const by = Object.fromEntries(read.messages.filter((m) => m.role === 'assistant').map((m) => [m.id, m]));
  assert.strictEqual(by.pcCopy.pending, true, 'shows as in progress through its lease');
  assert.ok(Lease.isReplyInProgress(by.pcCopy));
  assert.strictEqual(by.leftover.pending, false);
  assert.strictEqual(by.leftover.interrupted, true);
  assert.strictEqual(by.deadCopy.pending, false);
});

// ---- the computer's copy of a phone's reply ------------------------------------------

async function pcStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-hub-'));
  return Storage.open(nodeFsBackend(dir));
}
const phoneRequest = (chatId, extra = {}) => ({
  chatId,
  deviceId: 'phone-1',
  deviceName: 'Pixel',
  reply: { id: 'r1', at: 1000, model: { provider: 'ollama', model: 'qwen' } },
  req: { model: 'qwen' },
  ...extra
});
const lastMessage = async (storage, id) => {
  const c = await storage.getChat(id);
  return c.messages[c.messages.length - 1];
};

function hub(storage, extra = {}) {
  const log = { notified: [], syncs: 0 };
  const h = createReplyHub({
    storage,
    name: () => 'Desk',
    notify: (ids) => log.notified.push(...ids),
    syncNow: () => { log.syncs++; },
    flushMs: 10,
    retryMs: 15,
    orphanMs: 2000,
    ...extra
  });
  return { h, log };
}

test('only one reply at a time in a chat, from any device, and the next one is told clearly', async () => {
  const storage = await pcStorage();
  const { h } = hub(storage);
  const release = h.claim('c1', { source: 'phone', name: 'Pixel', deviceId: 'p' });
  assert.throws(() => h.claim('c1', { source: 'local', name: 'Desk' }), (err) => err.code === 'busy' && /already being written in this chat \(on Pixel\)/.test(err.message));
  const free = h.claim('c2', { source: 'local', name: 'Desk' });   // another chat is fine
  assert.throws(() => h.claim('c2', { source: 'local', name: 'Desk' }), (err) => err.code === 'busy' && /\(on Desk\)/.test(err.message));
  release();
  h.claim('c1', { source: 'local', name: 'Desk' })();
  free();
  h.claim(undefined, { source: 'local' })();   // no chat id: nothing to guard
  h.claim(undefined, { source: 'local' })();
});

test('a phone\'s reply is written into the computer\'s chat as it streams, then finished with the phone\'s message id', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Trip' });
  await storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Cheapest ticket?', createdAt: 1 }] });
  const { h, log } = hub(storage);
  const seen = [];
  const result = await h.remoteChat(phoneRequest(made.id), { emit: (e) => seen.push(e) }, async (onDelta) => {
    onDelta('Book');
    onDelta(' early');
    await sleep(60);
    // Mid-reply: the reply is in the chat, pending, and owned by the phone.
    const mid = await lastMessage(storage, made.id);
    assert.strictEqual(mid.id, 'r1');
    assert.strictEqual(mid.pending, true);
    assert.strictEqual(mid.content, 'Book early');
    assert.strictEqual(mid.owner.deviceId, 'phone-1');
    assert.strictEqual(mid.owner.name, 'Pixel');
    assert.ok(Math.abs(mid.owner.ts - Date.now()) < 2000);
    onDelta('.');
    return { text: 'Book early.', stopReason: 'end_turn', stats: { engine: 'Ollama', tokens: 3 } };
  });
  assert.strictEqual(result.text, 'Book early.');
  assert.deepStrictEqual(seen.map((e) => e.text).join(''), 'Book early.');
  const chatNow = await storage.getChat(made.id);
  assert.strictEqual(chatNow.messages.length, 2, 'no duplicate');
  const done = chatNow.messages[1];
  assert.strictEqual(done.id, 'r1');
  assert.strictEqual(done.pending, false);
  assert.strictEqual(done.owner, undefined);
  assert.strictEqual(done.mirrored, true);
  assert.strictEqual(done.content, 'Book early.');
  assert.strictEqual(done.stats.engine, 'Ollama on Desk');
  assert.deepStrictEqual(done.model, { provider: 'ollama', model: 'qwen' });
  assert.ok(log.notified.includes(made.id), 'the window is told');
  assert.ok(log.syncs > 0, 'and it is synced');
  // The reply is no longer claimed.
  h.claim(made.id, { source: 'local' })();
});

test('a second reply in a chat the phone is writing in is refused, and the first one is not disturbed', async () => {
  const storage = await pcStorage();
  const { h } = hub(storage);
  let finish;
  const first = h.remoteChat(phoneRequest('c1'), { emit() {} }, () => new Promise((resolve) => { finish = () => resolve({ text: 'one' }); }));
  await sleep(5);
  let ran = false;
  await assert.rejects(
    h.remoteChat(phoneRequest('c1', { deviceId: 'phone-2', deviceName: 'Tablet', reply: { id: 'r2' } }), { emit() {} }, async () => { ran = true; }),
    (err) => err.code === 'busy' && /\(on Pixel\)/.test(err.message));
  assert.strictEqual(ran, false, 'the second model never started');
  finish();
  assert.strictEqual((await first).text, 'one');
  // And once it is done, the next one goes.
  assert.strictEqual((await h.remoteChat(phoneRequest('c1', { reply: { id: 'r3' } }), { emit() {} }, async () => ({ text: 'two' }))).text, 'two');
});

test('a phone that says nothing about the chat (older app) gets its reply and nothing else happens', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Trip' });
  const { h, log } = hub(storage);
  const seen = [];
  const result = await h.remoteChat({ req: { model: 'qwen' } }, { emit: (e) => seen.push(e) }, async (onDelta) => {
    onDelta('Hi');
    return { text: 'Hi' };
  });
  assert.strictEqual(result.text, 'Hi');
  assert.deepStrictEqual(seen, [{ t: 'delta', text: 'Hi' }]);
  assert.strictEqual((await storage.getChat(made.id)).messages.length, 0);
  assert.deepStrictEqual(log, { notified: [], syncs: 0 });
  // An older phone puts the chat id inside `req`: that still counts as one reply per chat.
  const release = h.claim('c9', { source: 'local' });
  await assert.rejects(h.remoteChat({ req: { chatId: 'c9' } }, { emit() {} }, async () => ({})), (err) => err.code === 'busy');
  release();
});

test('a failed reply is finished in the chat with its error, and a stopped one keeps what was written', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Trip' });
  await storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Hi', createdAt: 1 }] });
  const { h } = hub(storage);
  await assert.rejects(h.remoteChat(phoneRequest(made.id), { emit() {} }, async (onDelta) => {
    onDelta('Par');
    throw new Error('model "x" not found');
  }), /not found/);
  let m = await lastMessage(storage, made.id);
  assert.strictEqual(m.pending, false);
  assert.strictEqual(m.content, 'Par');
  assert.strictEqual(m.error, 'Error: model "x" not found');

  await assert.rejects(h.remoteChat(phoneRequest(made.id, { reply: { id: 'r2', at: 2000 } }), { emit() {} }, async (onDelta) => {
    onDelta('Half');
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }));
  m = await lastMessage(storage, made.id);
  assert.strictEqual(m.id, 'r2');
  assert.strictEqual(m.pending, false);
  assert.strictEqual(m.content, 'Half');
  assert.strictEqual(m.error, undefined);
});

test('when the chat has not reached the computer yet, the reply waits for it and is finished once it has', async () => {
  const storage = await pcStorage();
  const { h } = hub(storage, {});
  const id = 'newchat';
  // The sync that "brings the chat" happens a little later.
  const arrives = sleep(80).then(() => storage.putSyncedChat({ id, title: 'Trip', createdAt: 1, updatedAt: 1, modifiedAt: 5, rev: 'm5', messages: [{ id: 'q', role: 'user', content: 'Hi', createdAt: 1 }, { id: 'r1', role: 'assistant', content: '', createdAt: 2, pending: true, owner: { deviceId: 'phone-1', name: 'Pixel', ts: Date.now() } }] }));
  await h.remoteChat(phoneRequest(id), { emit() {} }, async (onDelta) => {
    onDelta('Hello');
    return { text: 'Hello' };
  });
  await arrives;
  for (let i = 0; i < 100; i++) {
    const m = await lastMessage(storage, id);
    if (!m.pending) break;
    await sleep(20);
  }
  const chatNow = await storage.getChat(id);
  assert.strictEqual(chatNow.messages.length, 2, 'the phone\'s message is completed, not added again');
  assert.strictEqual(chatNow.messages[1].content, 'Hello');
  assert.strictEqual(chatNow.messages[1].pending, false);
});

test('the computer leaves a reply alone once the phone has its own finished copy, and picks up one the phone cut off', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Trip' });
  await storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Hi', createdAt: 1 }] });
  const { h } = hub(storage);
  await h.remoteChat(phoneRequest(made.id), { emit() {} }, async (onDelta) => {
    onDelta('Part');
    await sleep(50);
    // The phone synced its own finished copy meanwhile.
    const c = await storage.getChat(made.id);
    c.messages[1] = { id: 'r1', role: 'assistant', content: 'Phone version.', createdAt: 1000, stats: { engine: 'x' } };
    await storage.putSyncedChat(c);
    onDelta(' more');
    return { text: 'Part more' };
  });
  assert.strictEqual((await lastMessage(storage, made.id)).content, 'Phone version.');

  // The phone closed and its copy came back marked as cut off: the reply goes on.
  const made2 = await storage.createChat({ title: 'Second' });
  await storage.saveChat({ ...made2, messages: [{ id: 'q', role: 'user', content: 'Hi', createdAt: 1 }, { id: 'r1', role: 'assistant', content: 'Pa', createdAt: 2, interrupted: true }] });
  await h.remoteChat(phoneRequest(made2.id), { emit() {} }, async (onDelta) => {
    onDelta('Part');
    return { text: 'Part two' };
  });
  const m = await lastMessage(storage, made2.id);
  assert.strictEqual(m.content, 'Part two');
  assert.strictEqual(m.pending, false);
  assert.strictEqual(m.interrupted, undefined);
});

test('phones that watch are told what the computer pushed, until they go', async () => {
  const storage = await pcStorage();
  const { h } = hub(storage);
  const events = [];
  const controller = new AbortController();
  const watching = h.watch({}, { emit: (e) => events.push(e), signal: controller.signal });
  assert.strictEqual(h.watching(), 1);
  h.announce({ chats: ['a'], deleted: [], settings: true });
  assert.deepStrictEqual(events, [{ t: 'watching' }, { t: 'changed', chats: ['a'], deleted: [], settings: true }]);
  controller.abort();
  assert.strictEqual(await watching, null);
  assert.strictEqual(h.watching(), 0);
  h.announce({ chats: ['b'] });
  assert.strictEqual(events.length, 2);
});

// ---- text already shown is never dropped ------------------------------------

test('merge: a finished copy that is shorter takes the longer text of the same reply, whichever device is newer', () => {
  const phone = reply({ content: 'Book early. Then', stats: { engine: 'GPU' }, tools: [{ name: 'search' }] });
  const pc = reply({ content: 'Book early. Then compare fares on two sites.', mirrored: true });
  for (const [x, y] of [[chat(50, q, phone), chat(10, q, pc)], [chat(10, q, phone), chat(50, q, pc)]]) {
    const m = mergeChats(x, y, { now: NOW }).messages[1];
    assert.strictEqual(m.content, 'Book early. Then compare fares on two sites.');
    assert.deepStrictEqual(m.stats, { engine: 'GPU' }, 'the phone\'s steps and stats stay');
    assert.deepStrictEqual(m.tools, [{ name: 'search' }]);
  }
});

test('merge: a cut-off copy with more text is not replaced by a finished-looking shorter one', () => {
  const phone = reply({ content: 'Book early.' });
  const pc = reply({ content: 'Book early. Then compare fares.', interrupted: true, notice: 'Cut off.', mirrored: true });
  for (const [x, y] of [[chat(50, q, phone), chat(10, q, pc)], [chat(10, q, phone), chat(50, q, pc)]]) {
    const m = mergeChats(x, y, { now: NOW }).messages[1];
    assert.strictEqual(m.content, 'Book early. Then compare fares.');
    assert.strictEqual(m.interrupted, true, 'the reply was cut off, so it says so');
    assert.strictEqual(m.notice, 'Cut off.');
  }
});

test('merge: two finished copies that disagree keep the longer text, never the shorter one by default', () => {
  const phone = reply({ content: 'Book early.' });
  const pc = reply({ content: 'Fly on Tuesday: it is cheaper.', mirrored: true });
  for (const [x, y] of [[chat(50, q, phone), chat(10, q, pc)], [chat(10, q, phone), chat(50, q, pc)]]) {
    assert.strictEqual(mergeChats(x, y, { now: NOW }).messages[1].content, 'Fly on Tuesday: it is cheaper.');
  }
});

test('merge: a live owner\'s text and a user\'s edited message are left to their usual rules', () => {
  const live = reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 1000) });
  const longerCut = reply({ content: 'Book early. Then', interrupted: true });
  assert.strictEqual(mergeChats(chat(50, q, live), chat(10, q, longerCut), { now: NOW }).messages[1].pending, true);
  assert.strictEqual(mergeChats(chat(50, q, live), chat(10, q, longerCut), { now: NOW }).messages[1].content, 'Book');
  const edited = { ...q, content: 'Cheap ticket?' };
  const longerOld = { ...q, content: 'Cheapest ticket to Dubai?' };
  assert.strictEqual(mergeChats(chat(50, edited), chat(10, longerOld), { now: NOW }).messages[0].content, 'Cheap ticket?');
});

// ---- what shows as in progress ----------------------------------------------

test('a reply is in progress while it is pending and its owner refreshed it within the lease, on any device', () => {
  const live = reply({ pending: true, content: 'Book', owner: owner('phone', NOW - 5000) });
  assert.ok(Lease.isReplyInProgress(live, NOW));
  // Whoever looks: the owner's own device (watching what a computer writes for it) too.
  assert.strictEqual(Lease.replyInProgress(chat(1, q, live), NOW), live);
  // Done, interrupted, stale, ownerless or dated far ahead: not in progress.
  assert.ok(!Lease.isReplyInProgress(reply({ content: 'Book', owner: owner('phone', NOW) }), NOW));
  assert.ok(!Lease.isReplyInProgress(Lease.interrupt({ ...live, owner: { ...live.owner } }), NOW));
  assert.ok(!Lease.isReplyInProgress(reply({ pending: true, owner: owner('phone', NOW - Lease.LEASE_MS - 1) }), NOW));
  assert.ok(!Lease.isReplyInProgress(reply({ pending: true }), NOW));
  assert.ok(!Lease.isReplyInProgress(reply({ pending: true, owner: owner('phone', NOW + 60 * 60_000) }), NOW));
  assert.strictEqual(Lease.replyInProgress(chat(1, q, reply({ content: 'x' })), NOW), null);
  assert.strictEqual(Lease.replyInProgress(null, NOW), null);
});

test('the in-progress state ends the moment the lease runs out, with no event needed', () => {
  const m = reply({ pending: true, owner: owner('phone', NOW) });
  assert.ok(Lease.isReplyInProgress(m, NOW + Lease.LEASE_MS));
  assert.ok(!Lease.isReplyInProgress(m, NOW + Lease.LEASE_MS + 1));
  // A heartbeat (every HEARTBEAT_MS) keeps it going.
  assert.ok(Lease.HEARTBEAT_MS * 3 < Lease.LEASE_MS);
});

test('the texts for watching a reply exist in English and Arabic', () => {
  for (const lang of ['en', 'ar']) {
    for (const k of ['replyingOn', 'stopThere', 'stopFailed']) assert.match(Lease.text(k, 'Pixel', lang), /Pixel/);
  }
});

test('when the phone\'s copy has ended already, the computer stops its run and frees the chat', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Trip' });
  // The phone gave up on its reply (an error, not "cut off"): its copy has ended.
  await storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Cheapest ticket?', createdAt: 1 },
    { id: 'r1', role: 'assistant', content: 'Book', createdAt: 1000, error: 'Error: Couldn\'t reconnect' }] });
  const { h } = hub(storage);
  let stopped = false;
  await assert.rejects(h.remoteChat(phoneRequest(made.id), { emit() {} }, (onDelta, signal) => new Promise((resolve, reject) => {
    onDelta('Book early');
    signal.addEventListener('abort', () => {
      stopped = true;
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    });
    setTimeout(() => resolve({ text: 'never' }), 3000);
  })), { name: 'AbortError' });
  assert.ok(stopped, 'the run was stopped');
  // The chat is free again at once (not held for an hour).
  h.claim(made.id, { source: 'local', name: 'Desk' })();
  // And the phone's ended copy is left as it was.
  const m = await lastMessage(storage, made.id);
  assert.strictEqual(m.content, 'Book');
  assert.strictEqual(m.error, 'Error: Couldn\'t reconnect');
});

test('a save from the window keeps the newer stored copy of a reply written for a phone', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Trip' });
  const q = { id: 'q', role: 'user', content: 'Cheapest ticket?', createdAt: 1 };
  // What the computer wrote for the phone (finished), and the window's older copy (still writing).
  await storage.saveChat({ ...made, messages: [q, { id: 'r1', role: 'assistant', content: 'Book early.', createdAt: 1000, mirrored: true }] });
  const windowCopy = { ...made, title: 'Trip to Jeddah', messages: [q, { id: 'r1', role: 'assistant', content: 'Bo', createdAt: 1000, pending: true, owner: { deviceId: 'phone-1', name: 'Pixel', ts: 1 } },
    { id: 'm2', role: 'assistant', content: 'mine', createdAt: 2000 }] };
  await storage.saveChatOver(windowCopy, (stored, incoming) => Lease.keepNewerReplies(stored, incoming, 'desk'));
  const saved = await storage.getChat(made.id);
  assert.strictEqual(saved.title, 'Trip to Jeddah', 'the window\'s own changes are saved');
  assert.strictEqual(saved.messages[1].content, 'Book early.');
  assert.ok(!saved.messages[1].pending);
  assert.strictEqual(saved.messages[2].content, 'mine');
  // This computer's own reply: the window's copy always wins.
  const own = { id: 'r3', role: 'assistant', content: 'long stored text', createdAt: 3000, pending: true, owner: { deviceId: 'desk', name: 'Desk', ts: 1 } };
  const stored = { messages: [own] };
  const incoming = { messages: [{ ...own, content: 'short' }] };
  assert.strictEqual(Lease.keepNewerReplies(stored, incoming, 'desk').messages[0].content, 'short');
});

test('an agent\'s steps and questions in a phone\'s reply are kept in the computer\'s copy, and an answer from either device sticks', async () => {
  const storage = await pcStorage();
  const made = await storage.createChat({ title: 'Disk' });
  await storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Clean my disk', createdAt: 1 }] });
  const asked = [];
  const { h } = hub(storage, { onAsk: (chatId, a) => asked.push({ chatId, a }) });
  let answer;
  const waiting = new Promise((r) => { answer = r; });
  const run = h.remoteChat({ ...phoneRequest(made.id), provider: 'hermes' }, { emit() {} }, async (onDelta, signal, onInfo) => {
    onInfo({ kind: 'tool', id: 't1', label: 'du -sh ~/Library/Caches', status: 'running' });
    onInfo({ kind: 'approval', runId: 'run_9', approvalId: 'a1', command: 'rm -rf ~/Library/Caches/old', description: 'delete old caches', choices: ['once', 'session', 'always', 'deny'] });
    onDelta('Waiting for you…');
    await waiting;
    onInfo({ kind: 'tool', id: 't1', status: 'completed' });
    onDelta(' Freed 2 GB.');
    return { text: 'Waiting for you… Freed 2 GB.' };
  });
  for (let i = 0; i < 100 && !((await lastMessage(storage, made.id)).approvals || []).length; i++) await sleep(20);
  const mid = await lastMessage(storage, made.id);
  // The question is in the computer's chat, answerable here with this computer's Hermes.
  assert.deepStrictEqual(mid.approvals.map((a) => [a.runId, a.approvalId, a.state, a.provider]), [['run_9', 'a1', 'pending', 'hermes']]);
  assert.strictEqual(mid.tools[0].label, 'du -sh ~/Library/Caches');
  assert.strictEqual(asked.length, 1);
  assert.strictEqual(asked[0].chatId, made.id);
  // Answered (here, or from the phone through this computer).
  assert.strictEqual(h.answered({ runId: 'run_9', approvalId: 'a1', choice: 'once' }), true);
  assert.strictEqual(h.answered({ runId: 'other', choice: 'once' }), false);
  answer();
  await run;
  const done = await lastMessage(storage, made.id);
  assert.strictEqual(done.content, 'Waiting for you… Freed 2 GB.');
  assert.strictEqual(done.approvals[0].state, 'once');
  assert.strictEqual(done.tools[0].status, 'completed');
  assert.strictEqual(done.agentStatus, undefined);
});

test('a window save that is behind keeps the computer\'s newer reply, with the answer given in the window', () => {
  const ask = { runId: 'run_9', approvalId: 'a1', command: 'rm', state: 'pending' };
  const stored = { messages: [{ id: 'r1', role: 'assistant', content: 'Waiting for you… still working', pending: true, owner: { deviceId: 'phone-1', ts: 1 }, approvals: [ask] }] };
  const incoming = { messages: [{ id: 'r1', role: 'assistant', content: 'Waiting', pending: true, owner: { deviceId: 'phone-1', ts: 1 }, approvals: [{ ...ask, state: 'once' }] }] };
  const out = Lease.keepNewerReplies(stored, incoming, 'desk').messages[0];
  assert.strictEqual(out.content, 'Waiting for you… still working');
  assert.strictEqual(out.approvals[0].state, 'once');
});
