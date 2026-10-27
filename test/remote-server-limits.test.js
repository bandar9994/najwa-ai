// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The limits and CORS rules of the computer's remote server (src/remote-server.js).

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { linkKey, lock, PATH } = require('../src/remote');
const { startRemoteServer } = require('../src/remote-server');
const { toBase64 } = require('../src/sync');

const syncKey = () => toBase64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function server(key, limits) {
  const calls = [];
  const srv = await startRemoteServer({
    port: 0,
    host: '127.0.0.1',
    limits,
    getKey: async () => linkKey(key),
    handlers: {
      hello: async () => ({ app: 'balimda' }),
      chat: async (msg) => {
        calls.push(msg.op);
        return { text: 'ok' };
      }
    }
  });
  return { srv, calls, url: `http://127.0.0.1:${srv.port}${PATH}` };
}

let n = 0;
const request = async (key, fields = {}) => lock(await linkKey(key), { op: 'hello', ts: Date.now(), nonce: `n${++n}-${Math.random()}`, ...fields });

test('CORS: only the phone app\'s pages are let in, and each gets its own origin back', async () => {
  const key = syncKey();
  const { srv, url } = await server(key);
  try {
    for (const origin of ['https://localhost', 'capacitor://localhost']) {
      const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
      assert.strictEqual(pre.status, 204);
      assert.strictEqual(pre.headers.get('access-control-allow-origin'), origin);
      assert.strictEqual(pre.headers.get('access-control-allow-private-network'), 'true');
      const res = await fetch(url, { method: 'POST', headers: { Origin: origin }, body: await request(key) });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), origin);
      assert.match(res.headers.get('vary'), /Origin/);
    }
    // A web page from anywhere else is refused, preflight or not.
    for (const origin of ['https://evil.example', 'http://192.168.1.5:8080', 'null']) {
      const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin } });
      assert.strictEqual(pre.status, 403);
      assert.strictEqual(pre.headers.get('access-control-allow-origin'), null);
      const res = await fetch(url, { method: 'POST', headers: { Origin: origin }, body: await request(key) });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    }
  } finally {
    await srv.close();
  }
});

test('a request that says it is too big is refused before its body is read', async () => {
  const key = syncKey();
  const { srv, url } = await server(key, { maxBody: 1000, smallBody: 200 });
  try {
    const res = await fetch(url, { method: 'POST', body: 'x'.repeat(2000) });
    assert.strictEqual(res.status, 413);
    // Without a Content-Length (chunked) it is cut off while reading.
    const chunked = await new Promise((resolve) => {
      const sock = net.connect(srv.port, '127.0.0.1', () => {
        sock.write(`POST ${PATH} HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n${(2000).toString(16)}\r\n${'x'.repeat(2000)}\r\n0\r\n\r\n`);
      });
      let out = '';
      sock.on('data', (d) => { out += d; });
      sock.on('close', () => resolve(out));
      sock.on('error', () => resolve(out));
    });
    assert.match(chunked, /^HTTP\/1\.1 413/);
  } finally {
    await srv.close();
  }
});

test('chats can be big, other operations can not', async () => {
  const key = syncKey();
  const { srv, calls, url } = await server(key, { smallBody: 2000 });
  try {
    const pad = 'a'.repeat(5000);  // a chat with pictures
    assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key, { op: 'chat', pad }) })).status, 200);
    assert.deepStrictEqual(calls, ['chat']);
    assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key, { op: 'hello', pad }) })).status, 413);
    assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key) })).status, 200);
  } finally {
    await srv.close();
  }
});

test('only a few big bodies are read at a time', async () => {
  const key = syncKey();
  const { srv } = await server(key, { smallBody: 600, maxBigReads: 1 });
  const held = [];
  try {
    // One big request that never finishes sending.
    await new Promise((resolve) => {
      const sock = net.connect(srv.port, '127.0.0.1', () => {
        sock.write(`POST ${PATH} HTTP/1.1\r\nHost: x\r\nContent-Length: 5000\r\n\r\nstart`);
        held.push(sock);
        setTimeout(resolve, 50);
      });
    });
    const res = await fetch(`http://127.0.0.1:${srv.port}${PATH}`, { method: 'POST', body: 'x'.repeat(2000) });
    assert.strictEqual(res.status, 503);
    // A small request still goes through.
    assert.strictEqual((await fetch(`http://127.0.0.1:${srv.port}${PATH}`, { method: 'POST', body: await request(key) })).status, 200);
  } finally {
    for (const s of held) s.destroy();
    await srv.close();
  }
});

test('a body that stops arriving is dropped', async () => {
  const key = syncKey();
  const { srv } = await server(key, { bodyIdleMs: 100 });
  try {
    const closed = await new Promise((resolve) => {
      const sock = net.connect(srv.port, '127.0.0.1', () => {
        sock.write(`POST ${PATH} HTTP/1.1\r\nHost: x\r\nContent-Length: 5000\r\n\r\nstart`);
      });
      const t = setTimeout(() => resolve(false), 3000);
      sock.on('close', () => { clearTimeout(t); resolve(true); });
      sock.on('error', () => {});
    });
    assert.ok(closed, 'the connection should be closed by the computer');
  } finally {
    await srv.close();
  }
});

test('an address that keeps failing to authenticate is told to wait, and others are not', async () => {
  const key = syncKey();
  const { srv, url } = await server(key, { maxFailures: 3, failWindowMs: 400 });
  try {
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await fetch(url, { method: 'POST', body: 'not encrypted' })).status, 403);
    }
    // Now even a good request from this address waits...
    const blocked = await fetch(url, { method: 'POST', body: await request(key) });
    assert.strictEqual(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    // ...until the window is over.
    await sleep(450);
    assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key) })).status, 200);
  } finally {
    await srv.close();
  }
});

test('replays and old clocks count as failures, successful requests do not', async () => {
  const key = syncKey();
  const { srv, url } = await server(key, { maxFailures: 3, failWindowMs: 60000 });
  try {
    for (let i = 0; i < 10; i++) assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key) })).status, 200);
    const replay = await request(key);
    assert.strictEqual((await fetch(url, { method: 'POST', body: replay })).status, 200);
    assert.strictEqual((await fetch(url, { method: 'POST', body: replay })).status, 403);
    assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key, { ts: 1 }) })).status, 403);
    assert.strictEqual((await fetch(url, { method: 'POST', body: replay })).status, 403);
    assert.strictEqual((await fetch(url, { method: 'POST', body: await request(key) })).status, 429);
  } finally {
    await srv.close();
  }
});
