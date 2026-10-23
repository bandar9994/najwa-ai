// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Reading the links in a message ("Read links" setting): the app opens each
// page itself and gives the model its text, so any model can talk about a
// website. Text only: the page's design, and anything a page builds with
// JavaScript after it loads, isn't seen.
//
// The desktop app reads pages in its main process (Node's fetch); the phone
// with its own network code (src/native-fetch.js), since its web view can't
// fetch other websites.

'use strict';

const MAX_LINKS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 20000;
const TIMEOUT_MS = 15000;

// The http(s) links in a message, without trailing punctuation, at most MAX_LINKS.
function findLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    let url = m[0];
    // "(see https://x.com)." -> https://x.com
    while (/[.,;:!?'"»)\]}]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1);
    try {
      url = new URL(url).href;
    } catch {
      continue;
    }
    if (!out.includes(url)) out.push(url);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return all;
      }
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
};

// A web page -> { title, description, text }: the words a visitor reads,
// with headings, list items and picture descriptions kept.
function pageText(html) {
  let h = String(html || '');
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || '').replace(/\s+/g, ' ').trim();
  let description = '';
  for (const tag of h.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    if ((name === 'description' || name === 'og:description') && !description) description = attr(tag, 'content');
  }
  h = h.replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<(script|style|noscript|svg|template|canvas|iframe|object|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  h = h.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attr(tag, 'alt');
    return alt ? ` [picture: ${alt}] ` : ' ';
  });
  h = h.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n\n${'#'.repeat(Number(n))} `);
  h = h.replace(/<li\b[^>]*>/gi, '\n- ');
  h = h.replace(/<(br|hr)\b[^>]*>/gi, '\n');
  h = h.replace(/<\/(p|div|section|article|header|footer|nav|main|aside|h[1-6]|li|ul|ol|tr|table|blockquote|pre|form|figure|figcaption|dd|dt)\s*>/gi, '\n');
  h = h.replace(/<(td|th)\b[^>]*>/gi, ' | ');
  h = h.replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(h).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (!l || l === '-' || /^#+$/.test(l)) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (l !== out[out.length - 1]) out.push(l);
  }
  return { title, description, text: out.join('\n').trim() };
}

// Reads at most `max` bytes of a response body.
async function readBody(res, max) {
  if (!res.body || !res.body.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf.slice(0, max), cut: buf.length > max };
  }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    if (size >= max) {
      cut = true;
      reader.cancel().catch(() => {});
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const p of parts) {
    const piece = p.subarray(0, Math.min(p.length, bytes.length - at));
    bytes.set(piece, at);
    at += piece.length;
    if (at >= bytes.length) break;
  }
  return { bytes, cut };
}

const siteOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// Opens a link and reads its text. Resolves with { url, title, description,
// text, cut } or rejects with an Error that says what went wrong.
async function readLink(url, doFetch = (...args) => fetch(...args), { timeoutMs = TIMEOUT_MS } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('That isn\'t a web address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http and https links can be read.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    let at = parsed.href;
    // Redirects are followed here too: Android's network code doesn't follow
    // one from http to https.
    for (let hops = 0; ; hops++) {
      try {
        res = await doFetch(at, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NajwaAI/1.0; +https://github.com/bandar9994/najwa-ai)',
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'Accept-Language': 'en,ar;q=0.8'
          },
          redirect: 'follow',
          signal: controller.signal
        });
      } catch (err) {
        if (controller.signal.aborted) throw new Error(`${siteOf(url)} didn't answer in time.`);
        throw new Error(`Couldn't reach ${siteOf(url)}${err && err.message && err.explained ? ` (${err.message})` : ''}.`);
      }
      const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
      if (!next) break;
      if (hops >= 5) throw new Error(`${siteOf(url)} redirects too many times.`);
      if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
      at = new URL(next, at).href;
      if (!/^https?:/.test(at)) throw new Error('That link leads somewhere that isn\'t a web page.');
    }
    if (!res.ok) throw new Error(`${siteOf(url)} answered with an error (HTTP ${res.status}).`);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const html = !type || /html|xml/.test(type);
    if (!html && !type.startsWith('text/')) throw new Error(`That link is a file (${type.split(';')[0]}), not a web page.`);
    const { bytes, cut } = await readBody(res, MAX_BYTES);
    const charset = (/charset=["']?([\w-]+)/.exec(type) || [])[1];
    let body;
    try {
      body = new TextDecoder(charset || 'utf-8').decode(bytes);
    } catch {
      body = new TextDecoder('utf-8').decode(bytes);
    }
    const page = html ? pageText(body) : { title: '', description: '', text: body.trim() };
    const long = page.text.length > MAX_CHARS;
    return { url: parsed.href, title: page.title, description: page.description, text: long ? page.text.slice(0, MAX_CHARS) : page.text, cut: cut || long };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { findLinks, pageText, readLink, siteOf, MAX_LINKS };
