// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { findLinks, pageText, readLink } = require('../src/link-reader');

const PAGE = `<!doctype html><html><head>
<title>Cloudpick &amp; Co | Cloud services</title>
<meta name="description" content="Cloud hosting for Saudi businesses">
<style>body { color: red }</style><script>window.secret = "not text";</script>
</head><body>
<nav><a href="/">Home</a> <a href="/pricing">Pricing</a></nav>
<h1>Your cloud, in Saudi Arabia</h1>
<p>Fast&nbsp;servers in Riyadh. <b>No</b> lock-in.</p>
<img src="hero.png" alt="Data centre">
<ul><li>Backups</li><li>24/7 support</li></ul>
<!-- a comment --><noscript>Turn on JavaScript</noscript>
<p>مرحبا بكم</p>
</body></html>`;

function server() {
  const srv = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (req.url === '/old') {
      res.writeHead(301, { Location: '/' });
      return res.end();
    }
    if (req.url === '/file.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end('%PDF-1.4');
    }
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 2000);
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('word '.repeat(10000));
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('findLinks: up to three links, without trailing punctuation', () => {
  assert.deepStrictEqual(findLinks('https://cloudpick.sa/\n\nTell me what you think'), ['https://cloudpick.sa/']);
  assert.deepStrictEqual(findLinks('See (https://a.com/x), https://b.com. And https://a.com/x again! https://c.com https://d.com'),
    ['https://a.com/x', 'https://b.com/', 'https://c.com/']);
  assert.deepStrictEqual(findLinks('https://en.wikipedia.org/wiki/Rust_(programming_language)'), ['https://en.wikipedia.org/wiki/Rust_(programming_language)']);
  assert.deepStrictEqual(findLinks('no links here, ftp://x.com'), []);
});

test('pageText: the words a visitor reads, with title and description', () => {
  const p = pageText(PAGE);
  assert.strictEqual(p.title, 'Cloudpick & Co | Cloud services');
  assert.strictEqual(p.description, 'Cloud hosting for Saudi businesses');
  assert.match(p.text, /^Home Pricing$/m);
  assert.match(p.text, /^# Your cloud, in Saudi Arabia$/m);
  assert.match(p.text, /^Fast servers in Riyadh\. No lock-in\.$/m);
  assert.match(p.text, /\[picture: Data centre\]/);
  assert.match(p.text, /^- Backups$/m);
  assert.match(p.text, /مرحبا بكم/);
  assert.doesNotMatch(p.text, /secret|color: red|comment|Turn on JavaScript/);
});

test('readLink: reads a page, follows redirects (also when the network code does not), and explains failures', async () => {
  const { srv, url } = await server();
  try {
    const page = await readLink(`${url}/`);
    assert.strictEqual(page.title, 'Cloudpick & Co | Cloud services');
    assert.match(page.text, /Fast servers in Riyadh/);
    // Like Android's network code, which leaves an http -> https redirect to the app.
    const noFollow = (u, init) => fetch(u, { ...init, redirect: 'manual' });
    assert.match((await readLink(`${url}/old`, noFollow)).text, /Fast servers in Riyadh/);
    await assert.rejects(readLink(`${url}/missing`), /answered with an error \(HTTP 404\)/);
    await assert.rejects(readLink(`${url}/file.pdf`), /is a file \(application\/pdf\), not a web page/);
    await assert.rejects(readLink(`${url}/slow`, undefined, { timeoutMs: 200 }), /didn't answer in time/);
    await assert.rejects(readLink('http://127.0.0.1:1/'), /Couldn't reach 127\.0\.0\.1/);
    await assert.rejects(readLink('file:///etc/passwd'), /Only http and https/);
    const big = await readLink(`${url}/big`);
    assert.strictEqual(big.text.length, 20000);
    assert.strictEqual(big.cut, true);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
