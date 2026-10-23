// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The phone's browser for models: a hidden web view of the app's own (the
// "Browse" plugin: BrowsePlugin.java on Android, BrowsePlugin.swift on
// iPhone), driven like the computer's (src/browser-scripted.js). It sits
// behind the app, where you don't see it; on iPhone it keeps nothing after
// it's closed.
//
// The plugin:
//   open()            makes the hidden web view
//   load({ url })     resolves when the page has loaded, or rejects saying why
//   stop()            stops loading
//   eval({ js })      resolves with { value }: the script's result (text)
//   snapshot()        resolves with { data }: a JPEG, base64
//   close()           removes it

'use strict';

const { scriptedBrowser, loadError } = require('./browser-scripted');

const LOAD_TIMEOUT_MS = 25000;

function nativeEngine(Browse) {
  let opened = false;
  return {
    viewport: '400×860 phone',
    async load(url, signal) {
      if (!opened) {
        await Browse.open();
        opened = true;
      }
      const stop = () => Browse.stop().catch(() => {});
      if (signal) signal.addEventListener('abort', stop, { once: true });
      let timer;
      try {
        await Promise.race([
          Browse.load({ url }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The page took too long to load.')), LOAD_TIMEOUT_MS); })
        ]);
      } catch (err) {
        stop();
        throw new Error(loadError(err));
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', stop);
      }
    },
    run: async (js) => (await Browse.eval({ js })).value,
    async screenshot() {
      const r = await Browse.snapshot();
      return r && r.data ? `data:image/jpeg;base64,${r.data}` : null;
    },
    close() {
      if (opened) Browse.close().catch(() => {});
      opened = false;
    }
  };
}

const nativeBrowser = (Browse, opts) => scriptedBrowser(nativeEngine(Browse), opts);

module.exports = { nativeBrowser };
