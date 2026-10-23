// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The real browser for models (see src/browser-tools.js), the same on every
// platform: it numbers a page's links, buttons and text boxes, clicks and
// types by those numbers, and reads what a visitor sees. Each platform
// supplies the hidden browser itself (an "engine"):
//
// - computers (Windows, Mac, Linux): a hidden Electron window (src/browser-desktop.js)
// - Android and iPhone: a hidden web view of the app's own (src/browser-native.js)
//
// An engine has:
//   load(url, signal)  opens a page; rejects with an Error that says why
//   run(js)            runs a script in the page; resolves with its result
//                      (the scripts here return JSON text)
//   screenshot()       resolves with a JPEG data URL, or null
//   pressEnter()       optional: a real Enter key press
//   close()

'use strict';

const { defsFor, describe, pageReport, searchReport, httpUrl } = require('./browser-tools');
const { searchWeb } = require('./link-reader');

const SETTLE_MS = 1200; // time for a page's scripts to fill it in

// Runs in the page: numbers its links, buttons and text boxes, and reads its text.
const SNAPSHOT_JS = `JSON.stringify((() => {
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  for (const el of document.querySelectorAll('[data-najwa-id]')) el.removeAttribute('data-najwa-id');
  const items = [];
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem]';
  for (const el of document.querySelectorAll(sel)) {
    if (items.length >= 120) break;
    if (!shown(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const kind = tag === 'a' || el.getAttribute('role') === 'link' ? 'link'
      : tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file'].includes(type)) ? 'text box'
      : tag === 'select' ? 'menu' : type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'option' : 'button';
    const img = el.querySelector('img');
    const label = (el.innerText || (kind === 'text box' ? '' : el.value) || el.getAttribute('aria-label') || el.getAttribute('placeholder')
      || el.getAttribute('title') || el.getAttribute('alt') || (img && img.alt) || el.name || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (!label && kind !== 'text box') continue;
    el.setAttribute('data-najwa-id', String(items.length + 1));
    items.push({ id: items.length + 1, kind, label: label || '(empty)', href: tag === 'a' ? el.href : undefined });
  }
  return { title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 60000) : '', items };
})())`;

const CLICK_JS = (n) => `JSON.stringify((() => {
  const el = document.querySelector('[data-najwa-id="${n}"]');
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
})())`;

const TYPE_JS = (n, text) => `JSON.stringify((() => {
  const el = document.querySelector('[data-najwa-id="${n}"]');
  if (!el) return 'missing';
  el.scrollIntoView({ block: 'center' });
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.form ? 'form' : 'ok';
})())`;

// Submits the box's form, or (without one) sends Enter key events to it.
const SUBMIT_JS = (n) => `JSON.stringify((() => {
  const el = document.querySelector('[data-najwa-id="${n}"]');
  if (!el) return false;
  const f = el.form;
  if (f) {
    if (f.requestSubmit) f.requestSubmit(); else f.submit();
    return true;
  }
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  return true;
})())`;

const STATE_JS = 'JSON.stringify({ url: location.href, ready: document.readyState })';

// Chromium's "ERR_NAME_NOT_RESOLVED (-105) loading '…'" in words.
function loadError(err) {
  const msg = String((err && err.message) || err);
  const code = (/ERR_[A-Z_]+/.exec(msg) || [])[0];
  const words = {
    ERR_NAME_NOT_RESOLVED: 'Couldn\'t find that website (check the address).',
    ERR_INTERNET_DISCONNECTED: 'This computer isn\'t connected to the internet.',
    ERR_CONNECTION_REFUSED: 'The website refused the connection.',
    ERR_CONNECTION_TIMED_OUT: 'The website didn\'t answer in time.',
    ERR_TIMED_OUT: 'The website didn\'t answer in time.',
    ERR_CERT_AUTHORITY_INVALID: 'The website\'s security certificate isn\'t trusted, so it wasn\'t opened.',
    ERR_CERT_DATE_INVALID: 'The website\'s security certificate has expired, so it wasn\'t opened.'
  };
  return words[code] || (code ? `Couldn't open it (${code}).` : msg);
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function scriptedBrowser(engine, { doFetch = (...args) => fetch(...args) } = {}) {
  let page = null;

  // A script may meet a page that's still changing: try again shortly.
  const run = async (js) => {
    for (let tries = 0; ; tries++) {
      try {
        return parse(await engine.run(js));
      } catch (err) {
        if (tries >= 3) throw err;
        await sleep(500);
      }
    }
  };

  const snapshot = async () => {
    page = await run(SNAPSHOT_JS);
    return page;
  };

  // After a click or Enter: wait for the page to change (or not), then read it.
  const settle = async (before, signal) => {
    const until = Date.now() + 6000;
    await sleep(600, signal);
    while (Date.now() < until && !(signal && signal.aborted)) {
      const st = await run(STATE_JS).catch(() => null);
      if (st && st.ready === 'complete' && (st.url !== before || Date.now() > until - 4500)) break;
      await sleep(400, signal);
    }
    await sleep(SETTLE_MS, signal);
    return snapshot();
  };

  const needPage = () => {
    if (!page) throw new Error('No page is open yet: use open_page first.');
  };

  const again = async (n) => ({ text: `There's no number ${n} on the page now. Here's the page again:\n\n${pageReport(await snapshot())}`, error: true });

  return {
    defs: defsFor(['web_search', 'open_page', 'click', 'type_text', 'screenshot']),
    describe: (call) => describe(call, page),

    async run(name, args, signal) {
      if (name === 'web_search') return { text: searchReport(args.query, await searchWeb(String(args.query || ''), doFetch)) };
      if (name === 'open_page') {
        await engine.load(httpUrl(args.url), signal);
        await sleep(SETTLE_MS, signal);
        return { text: pageReport(await snapshot()) };
      }
      if (name === 'click') {
        needPage();
        const n = Number(args.number);
        const before = page.url;
        if (!(await run(CLICK_JS(n)))) return again(n);
        return { text: pageReport(await settle(before, signal)) };
      }
      if (name === 'type_text') {
        needPage();
        const n = Number(args.number);
        const typed = await run(TYPE_JS(n, String(args.text || '')));
        if (typed === 'missing') return again(n);
        if (!args.submit) return { text: pageReport(await snapshot(), { note: `Typed into number ${n}.` }) };
        const before = page.url;
        if (typed === 'form' || !engine.pressEnter) await run(SUBMIT_JS(n));
        else await engine.pressEnter();
        return { text: pageReport(await settle(before, signal)) };
      }
      if (name === 'screenshot') {
        needPage();
        const image = await engine.screenshot();
        if (!image) return { text: 'The screenshot came out empty. Try again in a moment.', error: true };
        return { text: `Screenshot of ${page.url} (the top of the page, as a visitor first sees it).`, image };
      }
      return { text: `There's no tool called ${name}.`, error: true };
    },

    close() {
      page = null;
      engine.close();
    }
  };
}

module.exports = { scriptedBrowser, loadError, SNAPSHOT_JS };
