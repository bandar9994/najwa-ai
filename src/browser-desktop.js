// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The computer's browser for models (see src/browser-tools.js): a real
// browser (Electron's own Chromium), hidden, that the model drives with
// tools. Pages run their JavaScript like in any browser.
//
// It's kept apart from you: its own private session (nothing saved to disk,
// none of your logins), no downloads, no pop-up windows, no camera,
// microphone, location or notifications, and the sound off. Each reply gets a
// fresh window that's closed when the reply is done.

'use strict';

const { BrowserWindow, session } = require('electron');
const { defsFor, describe, pageReport, searchReport, httpUrl } = require('./browser-tools');
const { searchWeb } = require('./link-reader');

const PARTITION = 'najwa-model-browser'; // no "persist:", so it stays in memory
const LOAD_TIMEOUT_MS = 25000;
const SETTLE_MS = 1200; // time for a page's scripts to fill it in

let sessionReady = false;
function browserSession() {
  const ses = session.fromPartition(PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    // Look like an ordinary Chrome: some sites turn away "Electron".
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|najwa-ai|Najwa AI|balimda)\/\S+/gi, ''));
  }
  return ses;
}

// Runs in the page: numbers its links, buttons and text boxes, and reads its text.
const SNAPSHOT_JS = `(() => {
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
    const label = (el.innerText || (kind === 'text box' ? '' : el.value) || el.getAttribute('aria-label') || el.getAttribute('placeholder')
      || el.getAttribute('title') || el.getAttribute('alt') || (el.querySelector('img') && el.querySelector('img').alt) || el.name || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (!label && kind !== 'text box') continue;
    el.setAttribute('data-najwa-id', String(items.length + 1));
    items.push({ id: items.length + 1, kind, label: label || '(empty)', href: tag === 'a' ? el.href : undefined });
  }
  return { title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 60000) : '', items };
})()`;

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

function desktopBrowser({ doFetch = (...args) => fetch(...args) } = {}) {
  let win = null;
  let page = null;

  const open = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        session: browserSession(),
        offscreen: true, // drawn even though it's never shown, for screenshots
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    });
    win.webContents.setAudioMuted(true);
    // A link that opens a new window opens here instead.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) setImmediate(() => win && !win.isDestroyed() && win.loadURL(url).catch(() => {}));
      return { action: 'deny' };
    });
    // Only web pages: no file://, no app links.
    win.webContents.on('will-navigate', (e, url) => {
      if (!/^https?:/.test(url)) e.preventDefault();
    });
    return win;
  };

  const snapshot = async () => {
    page = await open().webContents.executeJavaScript(SNAPSHOT_JS, true);
    return page;
  };

  const loadAndRead = async (url, signal) => {
    const w = open();
    const stop = () => { if (!w.isDestroyed()) w.webContents.stop(); };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    try {
      await Promise.race([
        w.loadURL(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('The page took too long to load.')), LOAD_TIMEOUT_MS))
      ]).catch((err) => {
        // A page that loaded but whose extras failed still counts.
        if (/ERR_ABORTED/.test(String(err && err.message)) && w.webContents.getURL()) return;
        throw new Error(loadError(err));
      });
      await sleep(SETTLE_MS, signal);
      return snapshot();
    } finally {
      if (signal) signal.removeEventListener('abort', stop);
    }
  };

  // After a click or Enter: wait for the page to change (or not).
  const afterAction = async (signal) => {
    const w = open();
    await Promise.race([
      new Promise((resolve) => w.webContents.once('did-finish-load', resolve)),
      sleep(2000, signal)
    ]);
    await sleep(SETTLE_MS, signal);
    return snapshot();
  };

  const needPage = () => {
    if (!page) throw new Error('No page is open yet: use open_page first.');
  };

  return {
    defs: defsFor(['web_search', 'open_page', 'click', 'type_text', 'screenshot']),
    describe: (call) => describe(call, page),

    async run(name, args, signal) {
      if (name === 'web_search') return { text: searchReport(args.query, await searchWeb(String(args.query || ''), doFetch)) };
      if (name === 'open_page') return { text: pageReport(await loadAndRead(httpUrl(args.url), signal)) };
      if (name === 'click') {
        needPage();
        const n = Number(args.number);
        const ok = await open().webContents.executeJavaScript(`(() => {
          const el = document.querySelector('[data-najwa-id="${n}"]');
          if (!el) return false;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        })()`, true);
        if (!ok) return { text: `There's no number ${n} on the page now. Here's the page again:\n\n${pageReport(await snapshot())}`, error: true };
        return { text: pageReport(await afterAction(signal)) };
      }
      if (name === 'type_text') {
        needPage();
        const n = Number(args.number);
        const ok = await open().webContents.executeJavaScript(`(() => {
          const el = document.querySelector('[data-najwa-id="${n}"]');
          if (!el) return 'missing';
          el.scrollIntoView({ block: 'center' });
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const set = Object.getOwnPropertyDescriptor(proto, 'value');
          if (set && set.set) set.set.call(el, ${JSON.stringify(String(args.text || ''))}); else el.value = ${JSON.stringify(String(args.text || ''))};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.form ? 'form' : 'ok';
        })()`, true);
        if (ok === 'missing') return { text: `There's no number ${n} on the page now. Here's the page again:\n\n${pageReport(await snapshot())}`, error: true };
        if (args.submit) {
          const wc = open().webContents;
          if (ok === 'form') {
            await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-najwa-id="${n}"]'); const f = el && el.form; if (f) { if (f.requestSubmit) f.requestSubmit(); else f.submit(); } })()`, true);
          } else {
            for (const type of ['keyDown', 'char', 'keyUp']) wc.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' });
          }
          return { text: pageReport(await afterAction(signal)) };
        }
        return { text: pageReport(await snapshot(), { note: `Typed into number ${n}.` }) };
      }
      if (name === 'screenshot') {
        needPage();
        const img = await open().webContents.capturePage();
        if (img.isEmpty()) return { text: 'The screenshot came out empty. Try again in a moment.', error: true };
        const small = img.getSize().width > 1024 ? img.resize({ width: 1024 }) : img;
        return { text: `Screenshot of ${page.url} (the top of the page, as a visitor first sees it).`, image: `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}` };
      }
      return { text: `There's no tool called ${name}.`, error: true };
    },

    close() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      page = null;
    }
  };
}

module.exports = { desktopBrowser };
