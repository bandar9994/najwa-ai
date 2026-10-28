// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The real remote server and the phone's real client, with the computer's reply
// hub in between: one reply per chat, the computer keeping the phone's reply,
// push-to-sync, and older apps on either side.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { linkKey, remoteComputers } = require('../src/remote');
const { startRemoteServer } = require('../src/remote-server');
const { createReplyHub } = require('../src/reply-hub');
const { toBase64, mergeChats } = require('../src/sync');
const { Storage } = require('../src/storage');
const { nodeFsBackend } = require('../src/backends/node-fs');

const syncKey = () => toBase64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A computer like the app's: handlers wired to a reply hub, a model that types
// `words` slowly (and waits while `gate.hold` is set).
async function computer(key, { newHandlers = true, words = ['Book', ' early', ' for', ' less.'], delay = 15 } = {}) {
  const storage = await Storage.open(nodeFsBackend(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-pc-'))));
  const log = { synced: 0, notified: [], started: 0 };
  const hub = createReplyHub({ storage, name: () => 'Desk', notify: (ids) => log.notified.push(...ids), syncNow: () => { log.synced++; }, flushMs: 10, retryMs: 20, orphanMs: 2000 });
  const run = (msg, { emit, signal }) => async (onDelta) => {
    log.started++;
    let text = '';
    for (const w of words) {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      await sleep(delay);
      text += w;
      onDelta(w);
    }
    return { text, stopReason: 'end_turn', stats: { engine: 'Ollama' } };
  };
  const handlers = {
    hello: async () => ({ app: 'balimda', name: 'Desk' }),
    models: async () => [{ provider: 'ollama', label: 'Ollama', short: 'Ollama', models: ['qwen'] }],
    chat: async (msg, ctx) => hub.remoteChat(msg, ctx, run(msg, ctx))
  };
  if (newHandlers) handlers.watch = (msg, ctx) => hub.watch(msg, ctx);
  const server = await startRemoteServer({ port: 0, host: '127.0.0.1', getKey: async () => linkKey(key), handlers });
  return { server, storage, hub, log, addr: { id: 'desk', name: 'Desk', addrs: ['127.0.0.1'], port: server.port, enabled: true } };
}
const phone = (key, pc) => remoteComputers({ getKey: async () => key, getComputers: async () => ({ desk: pc.addr }) });
const ask = (p, chatId, id, extra = {}) => p.streamChat({}, {
  model: 'qwen (Desk)', messages: [{ role: 'user', content: 'hi' }], chatId, device: { id: extra.device || 'phone-1', name: extra.name || 'Pixel' }, reply: { id, at: Date.now(), model: { provider: 'ollama', model: 'qwen' } }
}, () => {}, extra.signal);

async function chatOn(pc, messages) {
  const made = await pc.storage.createChat({ title: 'Trip' });
  await pc.storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Cheapest ticket?', createdAt: 1 }, ...messages] });
  return made.id;
}

test('two phones and the computer itself: one reply at a time in a chat, with a clear message for the others', async () => {
  const key = syncKey();
  const pc = await computer(key);
  try {
    const id = await chatOn(pc, []);
    const one = phone(key, pc);
    const two = phone(key, pc);
    const first = ask(one, id, 'r1');
    await sleep(40);
    await assert.rejects(ask(two, id, 'r2', { device: 'phone-2', name: 'Tablet' }), (err) => err.code === 'busy' && /already being written in this chat \(on Pixel\)/.test(err.message));
    // The computer's own window is refused as well while the phone's reply runs...
    assert.throws(() => pc.hub.claim(id, { source: 'local', name: 'Desk' }), (err) => err.code === 'busy');
    // ...and another chat is not held up.
    const other = await chatOn(pc, []);
    assert.strictEqual((await ask(two, other, 'r3', { device: 'phone-2', name: 'Tablet' })).text, 'Book early for less.');
    assert.strictEqual((await first).text, 'Book early for less.');
    assert.strictEqual(pc.log.started, 2, 'the refused one never reached the model');
    // Free again afterwards.
    assert.strictEqual((await ask(two, id, 'r4', { device: 'phone-2', name: 'Tablet' })).text, 'Book early for less.');
    // And in the other direction: the computer's own reply refuses a phone.
    const release = pc.hub.claim(id, { source: 'local', name: 'Desk' });
    await assert.rejects(ask(one, id, 'r5'), (err) => err.code === 'busy' && /\(on Desk\)/.test(err.message));
    release();
  } finally {
    await pc.server.close();
  }
});

test('a phone that goes away mid-reply loses nothing: the computer finishes the reply in its own copy, and the phone\'s later sync merges with no duplicate', async () => {
  const key = syncKey();
  const pc = await computer(key, { words: ['Book', ' early', ' for', ' less.'], delay: 40 });
  try {
    const id = await chatOn(pc, []);
    const p = phone(key, pc);
    const url = await p.locate(pc.addr);
    // The phone is closed after the first words: a plain dropped connection (no "stop").
    const controller = new AbortController();
    let got = '';
    await p.call(url, 'chat', {
      provider: 'ollama', req: { model: 'qwen', messages: [{ role: 'user', content: 'hi' }] }, job: 'job-1', from: 0,
      chatId: id, deviceId: 'phone-1', deviceName: 'Pixel', reply: { id: 'r1', at: 1000 }
    }, { signal: controller.signal, onEvent: (e) => { if (e.t === 'delta') { got += e.text; if (got.length > 5) controller.abort(); } } }).catch(() => {});
    assert.ok(got.length > 0 && got !== 'Book early for less.');
    // The computer's copy is being written for the phone...
    const mid = (await pc.storage.getChat(id)).messages[1];
    assert.strictEqual(mid.id, 'r1');
    assert.strictEqual(mid.owner.deviceId, 'phone-1');
    // ...and finished, with nobody listening.
    for (let i = 0; i < 100 && (await pc.storage.getChat(id)).messages[1].pending; i++) await sleep(30);
    const record = await pc.storage.getChat(id);
    assert.strictEqual(record.messages.length, 2);
    assert.strictEqual(record.messages[1].content, 'Book early for less.');
    assert.strictEqual(record.messages[1].pending, false);
    assert.ok(!record.messages[1].interrupted && !record.messages[1].error);

    // The phone, once reopened, marked its own copy as cut off (it had not heard from the computer yet).
    const phoneCopy = { ...record, modifiedAt: record.modifiedAt + 1000, messages: [record.messages[0], { id: 'r1', role: 'assistant', content: 'Book ea', createdAt: 1000, interrupted: true }] };
    for (const merged of [mergeChats(phoneCopy, record), mergeChats(record, phoneCopy)]) {
      assert.strictEqual(merged.messages.length, 2);
      assert.strictEqual(merged.messages[1].content, 'Book early for less.');
      assert.strictEqual(merged.messages[1].error, undefined);
    }
  } finally {
    await pc.server.close();
  }
});

test('the computer tells a watching phone when it has pushed, and the phone leaves a computer that cannot do that alone', async () => {
  const key = syncKey();
  const pc = await computer(key);
  const old = await computer(key, { newHandlers: false });
  try {
    const p = phone(key, pc);
    const changes = [];
    const controller = new AbortController();
    const watching = p.watch({ onChanged: (c) => changes.push(c), signal: controller.signal, deviceId: 'phone-1' });
    for (let i = 0; i < 100 && pc.hub.watching() === 0; i++) await sleep(20);
    assert.strictEqual(pc.hub.watching(), 1);
    pc.hub.announce({ chats: ['a', 'b'], deleted: ['c'], settings: false });
    for (let i = 0; i < 100 && !changes.length; i++) await sleep(20);
    assert.deepStrictEqual(changes, [{ chats: ['a', 'b'], deleted: ['c'], settings: false, computer: 'desk' }]);
    controller.abort();
    await watching;
    for (let i = 0; i < 100 && pc.hub.watching() !== 0; i++) await sleep(20);
    assert.strictEqual(pc.hub.watching(), 0);

    // An older computer answers "watch" with an error: the phone gives up quietly and polls instead.
    const q = phone(key, old);
    await Promise.race([q.watch({ onChanged: () => assert.fail('no push from an old computer'), signal: new AbortController().signal, deviceId: 'phone-1' }), sleep(3000).then(() => assert.fail('watch kept retrying'))]);
  } finally {
    await pc.server.close();
    await old.server.close();
  }
});

test('an older phone (no chat, device or message ids) and an older computer (ignores them) still work together', async () => {
  const key = syncKey();
  const pc = await computer(key);
  try {
    const id = await chatOn(pc, []);
    const p = phone(key, pc);
    // Old phone: just the model and the messages.
    const result = await p.streamChat({}, { model: 'qwen (Desk)', messages: [{ role: 'user', content: 'hi' }] }, () => {});
    assert.strictEqual(result.text, 'Book early for less.');
    assert.strictEqual((await pc.storage.getChat(id)).messages.length, 1, 'nothing written to the computer\'s chats');
    // An op the computer has never heard of is a plain 400, not a crash.
    await assert.rejects(p.call(await p.locate(pc.addr), 'from-the-future', {}), /error 400/);
    // Extra fields in a chat request are ignored by a computer without a hub (what an older computer does).
    const bare = await startRemoteServer({ port: 0, host: '127.0.0.1', getKey: async () => linkKey(key), handlers: { hello: async () => ({}), models: async () => [{ provider: 'ollama', label: 'O', short: 'O', models: ['qwen'] }], chat: async (msg, { emit }) => { emit({ t: 'delta', text: 'ok' }); return { text: 'ok' }; } } });
    try {
      const q = remoteComputers({ getKey: async () => key, getComputers: async () => ({ desk: { id: 'desk', name: 'Desk', addrs: ['127.0.0.1'], port: bare.port, enabled: true } }) });
      assert.strictEqual((await ask(q, id, 'r1')).text, 'ok');
    } finally {
      await bare.close();
    }
  } finally {
    await pc.server.close();
  }
});
