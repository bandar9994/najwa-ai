// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The computer's side of "use my computer's models" (see remote.js): a small
// HTTP server on the local network that only answers requests encrypted with
// the key both devices derive from the sync key.

'use strict';

const http = require('http');
const os = require('os');
const { PORT, PATH, MAX_SKEW_MS, lock, unlock } = require('./remote');

const MAX_BODY = 64 * 1024 * 1024;  // a chat with pictures (each about 350 KB here) can be big
// Everything except a chat (hello, models, cancel, approve) is tiny. A body
// bigger than this is only read for a few requests at a time, and a non-chat
// request that turns out this big is refused (the operation is inside the
// encrypted body, so it can only be told apart once that is opened).
const SMALL_BODY = 256 * 1024;
const MAX_BIG_READS = 2;  // bodies over SMALL_BODY being read at once, before they are authenticated
const BODY_IDLE_MS = 30 * 1000;  // a request body that stops arriving
const HEADERS_TIMEOUT_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;  // the whole request, 64 MB on a slow link included
const KEEP_ALIVE_MS = 5 * 1000;
// A reply written for a phone that also names its chat and message is kept in
// this computer's copy of the chat (see reply-hub.js): it is this computer's
// reply, and it carries on when the phone goes away (Android freezes or kills
// an app in the background after a minute or so). Only after this long with
// no phone at all is it given up, and then it is marked as interrupted.
const AWAY_MS = 60 * 60 * 1000;
const MAX_FAILURES = 10;  // refused requests per address within FAIL_WINDOW_MS, then 429
const FAIL_WINDOW_MS = 60 * 1000;

// The pages the phone app runs in: iOS (capacitor://localhost) and Android
// (https://localhost, or http:// with the older setting). Requests without an
// Origin (no web page involved) are fine too.
// Why a reply was stopped, as the abort signal's `reason` (handlers can tell
// the user pressing Stop from the computer giving up on a reply):
const STOPPED = 'stopped';  // the user pressed Stop
const LOST = 'lost';        // no one came back for it, or sharing was turned off
const GAVE_UP = 'This reply was cut off on the computer: the phone was away too long, or sharing was turned off.';

const ALLOWED_ORIGINS = new Set(['https://localhost', 'capacitor://localhost', 'http://localhost', 'ionic://localhost']);

// IPv4 addresses the phone might reach this computer on: Wi-Fi/Ethernet, and
// VPNs like Tailscale (100.64.0.0/10) that work away from home too.
function localAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal || a.address.startsWith('169.254.')) continue;
      out.push(a.address);
    }
  }
  const rank = (ip) => (/^(192\.168|10)\./.test(ip) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 2);
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

/**
 * @param getKey    async () => AES-GCM link key, or null when sharing is off
 * @param handlers  { op: async (msg, { emit, signal }) => result }
 * @param limits    overrides for the limits above, for tests
 */
function startRemoteServer({ getKey, handlers, port = PORT, host = '0.0.0.0', heartbeatMs = 15000, graceMs = 5 * 60 * 1000, awayMs = AWAY_MS, limits = {} }) {
  const maxBody = limits.maxBody ?? MAX_BODY;
  const smallBody = limits.smallBody ?? SMALL_BODY;
  const maxBigReads = limits.maxBigReads ?? MAX_BIG_READS;
  const bodyIdleMs = limits.bodyIdleMs ?? BODY_IDLE_MS;
  const maxFailures = limits.maxFailures ?? MAX_FAILURES;
  const failWindowMs = limits.failWindowMs ?? FAIL_WINDOW_MS;
  const seen = new Map();  // nonce -> time, to refuse replayed requests
  const jobs = new Map();  // job id -> reply that can be picked up again (see startJob)
  const failures = new Map();  // address -> { count, since }, refused requests (see tooManyFailures)
  let bigReads = 0;

  // Counts requests from an address that were refused as not coming from a
  // paired phone (bad key, replay, old clock). Past the limit, the address is
  // told to wait before anything of its request is read.
  const blocked = (ip) => {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.since > failWindowMs) {
      failures.delete(ip);
      return false;
    }
    return f.count >= maxFailures;
  };
  const failed = (ip) => {
    const now = Date.now();
    for (const [a, f] of failures) if (now - f.since > failWindowMs) failures.delete(a);
    const f = failures.get(ip);
    if (f) f.count++;
    else failures.set(ip, { count: 1, since: now });
  };

  const server = http.createServer((req, res) => {
    // A phone that drops the connection mid-request (or any other failure)
    // must never take the app down with an unhandled rejection.
    handle(req, res).catch(() => {
      try {
        if (!res.headersSent) res.writeHead(500);
      } catch {
        // the connection is already gone
      }
      res.destroy();
    });
  });

  // Reads the request body as text. Returns null (and answers) when it is too
  // big, too slow, or the address has been refused too often.
  const readBody = async (req, res) => {
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > maxBody) {
      res.writeHead(413, { Connection: 'close' }).end();
      return null;
    }
    const big = Number.isFinite(length) ? length > smallBody : true;  // unknown length: read it as a big one
    if (big) {
      if (bigReads >= maxBigReads) {
        res.writeHead(503, { 'Retry-After': '5', Connection: 'close' }).end();
        return null;
      }
      bigReads++;
    }
    // A body that stops arriving is dropped, instead of holding the
    // connection open (the timeout is lifted again for the reply).
    req.socket.setTimeout(bodyIdleMs, () => req.destroy());
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBody) {
          res.writeHead(413, { Connection: 'close' }).end();
          return null;
        }
        chunks.push(chunk);
      }
    } finally {
      if (big) bigReads--;
      req.socket.setTimeout(0);
    }
    return Buffer.concat(chunks).toString('utf8');
  };

  const handle = async (req, res) => {
    // Only the phone app's own pages may read the replies (and a web page
    // from anywhere else is refused outright). This isn't what keeps the
    // computer safe, that's the encryption; it just keeps other sites out.
    const origin = req.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      res.writeHead(403).end();
      return;
    }
    if (origin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== PATH) {
      res.writeHead(404).end();
      return;
    }
    const ip = req.socket.remoteAddress || '';
    if (blocked(ip)) {
      res.writeHead(429, { 'Retry-After': String(Math.ceil(failWindowMs / 1000)), Connection: 'close' }).end();
      return;
    }
    const body = await readBody(req, res);
    if (body === null) return;

    const key = await getKey();
    if (!key) {
      res.writeHead(503).end();
      return;
    }
    let msg;
    try {
      msg = await unlock(key, body.trim());
    } catch {
      failed(ip);
      res.writeHead(403).end();
      return;
    }
    const now = Date.now();
    for (const [n, t] of seen) if (now - t > 2 * MAX_SKEW_MS) seen.delete(n);
    if (typeof msg.nonce !== 'string' || seen.has(msg.nonce) || Math.abs(now - Number(msg.ts)) > MAX_SKEW_MS) {
      failed(ip);
      res.writeHead(403).end();
      return;
    }
    seen.set(msg.nonce, now);
    if (msg.op !== 'chat' && body.length > smallBody) {
      res.writeHead(413).end();
      return;
    }

    // Replies the phone can pick up again after a lost connection (see Job).
    if (msg.op === 'cancel') {
      const job = jobs.get(String(msg.job));
      if (job) job.controller.abort(STOPPED);
      const write = open(res, key, msg.nonce);
      await write({ t: 'done', result: null });
      res.end();
      return;
    }
    if (msg.job != null) {
      const id = String(msg.job);
      const from = Math.max(0, Number(msg.from) || 0);
      let job = jobs.get(id);
      if (!job) {
        if (from > 0 || !handlers[msg.op]) {
          // Picking up a reply this computer no longer has (it was restarted,
          // or no one came back for it in time).
          const write = open(res, key, msg.nonce);
          await write({ t: 'error', code: 'gone', message: 'The computer no longer has this reply (Najwa AI was restarted, or the connection was lost for too long).' });
          res.end();
          return;
        }
        job = startJob(id, handlers[msg.op], msg);
      }
      await follow(job, from, res, open(res, key, msg.nonce));
      return;
    }

    // One reply per connection (phones without resumable replies).
    const handler = handlers[msg.op];
    if (!handler) {
      res.writeHead(400).end();
      return;
    }
    const write = open(res, key, msg.nonce);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort(LOST);
    });
    const emit = batcher(write);
    // A heartbeat while the model is busy (loading, reading a long chat,
    // thinking): the phone can tell a slow model from a lost connection.
    const beat = setInterval(() => write({ t: 'ping' }), heartbeatMs);
    try {
      const result = await handler(msg, { emit, signal: controller.signal });
      emit.flush();
      await write({ t: 'done', result: result === undefined ? null : result });
    } catch (err) {
      emit.flush();
      await write({ t: 'error', message: err.message || String(err), ...(err.code === 'busy' ? { code: 'busy' } : {}) });
    } finally {
      clearInterval(beat);
    }
    res.end();
  };

  // Starts the reply stream: encrypted lines, each tagged with the request's
  // nonce. Returns write(evt), which resolves once that line is written.
  function open(res, key, nonce) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    let chain = Promise.resolve();
    return (evt) => {
      chain = chain.then(async () => {
        if (!res.destroyed) res.write(`${await lock(key, { ...evt, re: nonce })}\n`);
      }).catch(() => {});
      return chain;
    };
  }

  // Text pieces are sent in small batches, so a fast model doesn't mean
  // hundreds of tiny writes. emit.flush() sends what's waiting.
  function batcher(send) {
    let pending = '';
    let timer = null;
    const flush = () => {
      clearTimeout(timer);
      timer = null;
      if (pending) send({ t: 'delta', text: pending });
      pending = '';
    };
    const emit = (evt) => {
      if (evt.t === 'delta') {
        pending += evt.text;
        if (!timer) timer = setTimeout(flush, 40);
        return;
      }
      flush();
      send(evt);
    };
    emit.flush = flush;
    return emit;
  }

  // A reply the phone asked for with a job id. It keeps being written when
  // the connection drops (e.g. the phone's Wi-Fi changed), and everything it
  // says is kept, so the phone can come back and carry on from where its
  // text stopped. With no one following it for `graceMs`, it's stopped; a
  // finished one is kept as long, for a phone that comes back late.
  function startJob(id, handler, msg) {
    // This computer keeps the reply itself (and shows it in its own chat):
    // it waits much longer for a phone that went away.
    const kept = typeof msg.chatId === 'string' && !!msg.chatId && !!msg.reply && typeof msg.reply.id === 'string' && typeof msg.deviceId === 'string';
    const job = { id, events: [], listeners: new Set(), finished: false, controller: new AbortController(), timer: null, away: kept ? awayMs : graceMs };
    const push = (evt) => {
      if (job.finished) return;
      job.events.push(evt);
      if (evt.t === 'done' || evt.t === 'error') {
        job.finished = true;
        clearTimeout(job.timer);
        job.timer = setTimeout(() => jobs.delete(id), graceMs);
        if (job.timer.unref) job.timer.unref();
      }
      for (const l of [...job.listeners]) l(evt);
    };
    job.unfollowed = () => {
      if (job.finished || job.listeners.size) return;
      clearTimeout(job.timer);
      job.timer = setTimeout(() => job.controller.abort(LOST), job.away);
      if (job.timer.unref) job.timer.unref();
    };
    jobs.set(id, job);
    const emit = batcher(push);
    (async () => {
      try {
        const result = await handler(msg, { emit, signal: job.controller.signal });
        emit.flush();
        // Given up on (not stopped by the user) but the model returned what it
        // had: that is a cut-off reply, not a finished one.
        if (job.controller.signal.aborted && job.controller.signal.reason === LOST) throw new Error(GAVE_UP);
        push({ t: 'done', result: result === undefined ? null : result });
      } catch (err) {
        emit.flush();
        const gaveUp = job.controller.signal.aborted && job.controller.signal.reason === LOST;
        push({ t: 'error', message: gaveUp ? GAVE_UP : err.message || String(err), ...(err.code === 'busy' ? { code: 'busy' } : {}) });
      }
    })();
    return job;
  }

  // Sends a job's events from number `from` on, then the new ones as they come.
  async function follow(job, from, res, write) {
    await write({ t: 'job', events: job.events.length });
    for (const evt of job.events.slice(from)) write(evt);
    if (!job.finished) {
      await new Promise((resolve) => {
        const beat = setInterval(() => write({ t: 'ping' }), heartbeatMs);
        const listener = (evt) => {
          write(evt);
          if (evt.t === 'done' || evt.t === 'error') stop();
        };
        const stop = () => {
          clearInterval(beat);
          job.listeners.delete(listener);
          res.off('close', gone);
          resolve();
        };
        const gone = () => {
          stop();
          job.unfollowed();
        };
        clearTimeout(job.timer);
        job.listeners.add(listener);
        if (res.destroyed) gone();  // the phone is already gone
        else res.on('close', gone);
      });
    }
    await write({ t: 'ping' });  // waits for everything before it to be written
    res.end();
  }

  // Slow or stalled requests are cut off; replies can run for as long as the
  // model needs (they send heartbeats), so server.timeout is left alone.
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_MS;

  return new Promise((resolve, reject) => {
    const listen = (p) => {
      server.once('error', (err) => {
        // Someone else has the usual port: take any free one (it's published
        // through sync with the addresses, so the phone still finds it).
        if (err.code === 'EADDRINUSE' && p !== 0) listen(0);
        else reject(err);
      });
      server.listen(p, host, () => {
        server.removeAllListeners('error');
        // A later network error must not take the app down (an 'error' event
        // with no listener would).
        server.on('error', () => {});
        resolve({
          port: server.address().port,
          close: () => new Promise((r) => {
            // Sharing stops: so do the replies still being written.
            for (const job of jobs.values()) job.controller.abort(LOST);
            jobs.clear();
            server.close(() => r());
            server.closeAllConnections?.();
          })
        });
      });
    };
    listen(port);
  });
}

module.exports = { startRemoteServer, localAddresses, STOPPED, LOST };
