// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const { createSaveQueue } = require('../renderer/save-queue.js');

// A fake clock: timers only run when the test says so.
function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    schedule: (fn, ms) => {
      timers.set(next, { fn, ms });
      return next++;
    },
    cancel: (id) => timers.delete(id),
    pending: () => timers.size,
    runAll: () => {
      for (const [id, t] of [...timers]) {
        timers.delete(id);
        t.fn();
      }
    }
  };
}

function setup() {
  const saved = [];
  const clock = fakeTimers();
  const queue = createSaveQueue({ save: async (chat) => { saved.push(`${chat.id}:${chat.text}`); }, ...clock });
  return { saved, clock, queue };
}

const tick = () => new Promise((r) => setImmediate(r));

test('soon() saves on the timer, once per chat however often it is called', async () => {
  const { saved, clock, queue } = setup();
  const chat = { id: 'a', text: 'hi' };
  queue.soon(chat, 5000);
  queue.soon(chat, 5000);
  assert.strictEqual(clock.pending(), 1);
  assert.strictEqual(queue.pending(), 1);
  chat.text = 'hi there';  // the timer saves the chat as it is when it fires
  clock.runAll();
  await tick();
  assert.deepStrictEqual(saved, ['a:hi there']);
  assert.strictEqual(queue.pending(), 0);
});

test('flush() saves every waiting chat now and cancels their timers', async () => {
  const { saved, clock, queue } = setup();
  queue.soon({ id: 'a', text: '1' }, 5000);
  queue.soon({ id: 'b', text: '2' }, 5000);
  const count = await queue.flush();
  assert.strictEqual(count, 2);
  assert.deepStrictEqual(saved.sort(), ['a:1', 'b:2']);
  assert.strictEqual(clock.pending(), 0);
  assert.strictEqual(queue.pending(), 0);
  clock.runAll();
  await tick();
  assert.strictEqual(saved.length, 2, 'a cancelled timer must not save again');
});

test('flush() with nothing waiting does nothing', async () => {
  const { saved, queue } = setup();
  assert.strictEqual(await queue.flush(), 0);
  assert.deepStrictEqual(saved, []);
});

test('now() saves at once and drops the waiting save', async () => {
  const { saved, clock, queue } = setup();
  const chat = { id: 'a', text: 'x' };
  queue.soon(chat, 5000);
  await queue.now(chat);
  assert.deepStrictEqual(saved, ['a:x']);
  assert.strictEqual(clock.pending(), 0);
  assert.strictEqual(queue.pending(), 0);
});

test('drop() forgets a waiting save (the chat was deleted)', async () => {
  const { saved, clock, queue } = setup();
  queue.soon({ id: 'a', text: 'x' }, 5000);
  queue.drop('a');
  assert.strictEqual(clock.pending(), 0);
  assert.strictEqual(await queue.flush(), 0);
  assert.deepStrictEqual(saved, []);
});

test('a failing save is reported and does not stop the others', async () => {
  const errors = [];
  const saved = [];
  const queue = createSaveQueue({
    save: async (chat) => {
      if (chat.id === 'bad') throw new Error('disk full');
      saved.push(chat.id);
    },
    onError: (err) => errors.push(err.message),
    ...fakeTimers()
  });
  queue.soon({ id: 'bad' }, 1000);
  queue.soon({ id: 'ok' }, 1000);
  await queue.flush();
  assert.deepStrictEqual(saved, ['ok']);
  assert.deepStrictEqual(errors, ['disk full']);
});

test('a chat changed after a flush can be queued again', async () => {
  const { saved, queue } = setup();
  const chat = { id: 'a', text: '1' };
  queue.soon(chat, 5000);
  await queue.flush();
  chat.text = '2';
  queue.soon(chat, 5000);
  await queue.flush();
  assert.deepStrictEqual(saved, ['a:1', 'a:2']);
});
