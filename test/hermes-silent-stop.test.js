// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A Hermes reply that stops half way must never end up looking finished:
// no spinner, final actions, and no word about it (the reported bug).

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { PROVIDERS } = require('../src/providers');
const Lease = require('../src/lease');

const hermes = PROVIDERS.hermes.impl;
const NARRATION = 'The base is back but the shroud now covers only part of the map. Let me verify the transform mapping numerically instead of guessing.';

// A Hermes whose single run ends the way `end` says (an SSE event list), or
// whose chat-completions stream just closes.
function fake({ terminal, status = { status: 'running' }, chatStream = null }) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'POST' && req.url === '/v1/runs') return json(202, { run_id: 'run_1', status: 'started' });
      if (req.url === '/v1/runs/run_1') return json(200, { run_id: 'run_1', ...status });
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const f of chatStream) res.write(f);
        return res.end();
      }
      if (req.url !== '/v1/runs/run_1/events') return json(404, {});
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const events = [{ event: 'message.delta', delta: NARRATION }, terminal].filter(Boolean);
      events.forEach((e, seq) => res.write(`id: ${seq}\ndata: ${JSON.stringify({ ...e, run_id: 'run_1', seq })}\n\n`));
      res.end(': stream closed\n\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

const ask = (url) => {
  let text = '';
  const done = hermes.streamChat({ baseUrl: url, apiKey: 'k' }, { model: 'hermes-agent', messages: [{ role: 'user', content: 'Fix the shroud' }] }, (p) => { text += p; });
  return { done, text: () => text };
};

test('Hermes runs: a turn that ran out of steps is an error that says so, and keeps the text', async () => {
  const h = await fake({ terminal: { event: 'run.failed', completed: false, partial: false, interrupted: false, turn_exit_reason: 'max_iterations_reached(90/90)' } });
  try {
    const r = ask(h.url);
    await assert.rejects(r.done, (err) => /stopped before it finished/.test(err.message) && /90 steps/.test(err.message) && /continue/.test(err.message));
    assert.strictEqual(r.text(), NARRATION);
  } finally {
    h.server.close();
  }
});

test('Hermes runs: run.completed that says it did not finish is not a finished reply', async () => {
  const h = await fake({ terminal: { event: 'run.completed', completed: false, partial: true, output: '' } });
  try {
    await assert.rejects(ask(h.url).done, /stopped before it finished/);
  } finally {
    h.server.close();
  }
  // Old Hermes sends no such fields: a normal run.completed is still a finished reply.
  const ok = await fake({ terminal: { event: 'run.completed', output: NARRATION } });
  try {
    const r = ask(ok.url);
    assert.strictEqual((await r.done).text, NARRATION);
  } finally {
    ok.server.close();
  }
  const fin = await fake({ terminal: { event: 'run.completed', completed: true, partial: false, output: NARRATION } });
  try {
    assert.strictEqual((await ask(fin.url).done).text, NARRATION);
  } finally {
    fin.server.close();
  }
});

test('Hermes runs: the status of a run that failed while away carries the reason too', async () => {
  const h = await fake({ terminal: null, status: { status: 'failed', completed: false, turn_exit_reason: 'max_iterations_reached(60/60)' } });
  try {
    await assert.rejects(ask(h.url).done, /60 steps/);
  } finally {
    h.server.close();
  }
});

test('Hermes chat completions: a stream that just closes is an error, one that ends properly is not', async () => {
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  let h = await fake({ chatStream: [chunk({ content: NARRATION })] });
  // (no /v1/runs: this Hermes only has chat completions)
  h.server.removeAllListeners('request');
  h.server.on('request', (req, res) => {
    req.resume();
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(chunk({ content: NARRATION }));
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const r = ask(h.url);
    await assert.rejects(r.done, /stopped sending the reply before it was finished/);
    assert.strictEqual(r.text(), NARRATION);
  } finally {
    h.server.close();
  }

  h = await fake({ chatStream: [] });
  h.server.removeAllListeners('request');
  h.server.on('request', (req, res) => {
    req.resume();
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(chunk({ content: 'Done.' }));
      res.write(chunk({}, 'stop'));
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(404);
    res.end();
  });
  try {
    assert.strictEqual((await ask(h.url).done).text, 'Done.');
  } finally {
    h.server.close();
  }
});

test('a reply with text that nobody is writing any more says so, instead of looking finished', () => {
  const owned = Lease.interrupt({ id: 'r', role: 'assistant', pending: true, content: NARRATION, owner: { deviceId: 'pc', name: 'BandarPC', ts: 1 } });
  assert.strictEqual(owned.pending, false);
  assert.ok(/stopped before it was finished/.test(Lease.INTERRUPTED_NOTICE));
  assert.strictEqual(owned.notice, Lease.INTERRUPTED_NOTICE);
  assert.strictEqual(owned.interrupted, true);
  // One without an owner too (from before owners existed), and a notice already there stays.
  assert.strictEqual(Lease.interrupt({ pending: true, content: 'x' }).notice, Lease.INTERRUPTED_NOTICE);
  assert.strictEqual(Lease.interrupt({ pending: true, content: 'x', notice: 'Mine' }).notice, 'Mine');
  // Without text it is the error as before, no notice.
  const empty = Lease.interrupt({ pending: true, content: '' });
  assert.strictEqual(empty.error, 'This reply was interrupted.');
  assert.strictEqual(empty.notice, undefined);
});
