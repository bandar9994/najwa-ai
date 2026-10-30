// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The phone uses the computer's Hermes Agent, then goes away: the run goes on
// on the computer (Hermes is never told to stop) and the reply is finished in
// the computer's copy of the chat.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { linkKey, remoteComputers } = require('../src/remote');
const { startRemoteServer } = require('../src/remote-server');
const { createReplyHub } = require('../src/reply-hub');
const { hermesProvider } = require('../src/providers');
const { toBase64 } = require('../src/sync');
const { Storage } = require('../src/storage');
const { nodeFsBackend } = require('../src/backends/node-fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A Hermes that writes its answer slowly (a run on /v1/runs).
function fakeHermes(words, delay) {
  const seen = { stops: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (req.method === 'POST' && req.url === '/v1/runs') {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ run_id: 'run_1', status: 'started' }));
      }
      if (req.url === '/v1/runs/run_1/stop') {
        seen.stops++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      if (req.url === '/v1/runs/run_1/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let seq = 0;
        for (const w of words) {
          await sleep(delay);
          res.write(`id: ${seq}\ndata: ${JSON.stringify({ event: 'message.delta', run_id: 'run_1', seq: seq++, delta: w })}\n\n`);
        }
        res.write(`id: ${seq}\ndata: ${JSON.stringify({ event: 'run.completed', run_id: 'run_1', seq, output: words.join('') })}\n\n`);
        return res.end();
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

test('the phone uses the computer\'s Hermes and goes away: Hermes is not stopped and the computer finishes the reply', async () => {
  const words = ['Cleaning', ' caches', ' now.', ' Freed', ' 2 GB.'];
  const hermes = await fakeHermes(words, 60);
  const storage = await Storage.open(nodeFsBackend(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-hermes-away-'))));
  const hub = createReplyHub({ storage, name: () => 'Desk', flushMs: 10 });
  const provider = hermesProvider();
  const key = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  // Like main.js: the phone's request runs Hermes on this computer.
  const server = await startRemoteServer({
    port: 0, host: '127.0.0.1', getKey: async () => linkKey(key),
    handlers: {
      hello: async () => ({ app: 'balimda', name: 'Desk' }),
      models: async () => [{ provider: 'hermes', label: 'Hermes Agent', short: 'Hermes Agent', models: ['hermes-agent'] }],
      chat: async (msg, ctx) => hub.remoteChat(msg, ctx, (onDelta, work) => provider.streamChat({ baseUrl: hermes.url }, msg.req, onDelta, work || ctx.signal))
    }
  });
  try {
    const made = await storage.createChat({ title: 'Disk' });
    await storage.saveChat({ ...made, messages: [{ id: 'q', role: 'user', content: 'Clean my disk', createdAt: 1 }] });
    // The phone's network: once it goes away (app closed, Android froze it), the open reply is cut.
    let markGone;
    const gone = new Promise((r) => { markGone = r; });
    let away = false;
    const net = async (url, opts = {}) => {
      if (away) throw new TypeError('fetch failed');
      const res = await globalThis.fetch(url, opts);
      if (!res.body) return res;
      const reader = res.body.getReader();
      return new Response(new ReadableStream({
        async pull(ctrl) {
          const r = await Promise.race([reader.read(), gone.then(() => null)]);
          if (r === null) { reader.cancel().catch(() => {}); ctrl.error(new TypeError('The network connection was lost.')); }
          else if (r.done) ctrl.close();
          else ctrl.enqueue(r.value);
        }
      }), { status: res.status, headers: res.headers });
    };
    const phone = remoteComputers({ getKey: async () => key, getComputers: async () => ({ desk: { id: 'desk', name: 'Desk', addrs: ['127.0.0.1'], port: server.port, enabled: true } }), fetch: net, resumeMs: 300, probeMs: 100 });
    let got = '';
    const asking = phone.streamChat({}, {
      model: 'hermes-agent (Desk, Hermes Agent)', messages: [{ role: 'user', content: 'Clean my disk' }], chatId: made.id,
      device: { id: 'phone-1', name: 'Pixel' }, reply: { id: 'r1', at: Date.now(), model: { provider: 'computer', model: 'hermes-agent (Desk, Hermes Agent)' } }
    }, (d) => { got += d; }).catch((err) => err);
    for (let i = 0; i < 100 && !got; i++) await sleep(20);
    away = true;
    markGone();
    const ended = await asking;
    assert.strictEqual(ended.code, 'elsewhere', 'the phone leaves the reply to the computer');
    for (let i = 0; i < 100 && (await storage.getChat(made.id)).messages[1].pending; i++) await sleep(30);
    const m = (await storage.getChat(made.id)).messages[1];
    assert.strictEqual(m.content, words.join(''));
    assert.ok(!m.pending && !m.error && !m.interrupted);
    assert.strictEqual(hermes.seen.stops, 0, 'Hermes was never told to stop');
  } finally {
    await server.close();
    hermes.server.close();
  }
});
