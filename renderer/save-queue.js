// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Chats are saved a moment after they change (a streaming reply changes many
// times a second, and every save rewrites the whole chat). This keeps track of
// which chats are waiting for that moment, so they can all be saved at once
// when the app is about to go to the background or close.
// Loaded before app.js (window.SaveQueue) and by the tests (require).

(function (root) {
  'use strict';

  /**
   * @param save      async (chat) => void, writes the chat
   * @param onError   (err) => void, called when a save fails (default: ignore)
   * @param schedule  setTimeout, replaceable in tests
   * @param cancel    clearTimeout, replaceable in tests
   */
  function createSaveQueue({ save, onError = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    const waiting = new Map();  // chat id -> { chat, timer }

    const write = async (chat) => {
      try {
        await save(chat);
      } catch (err) {
        onError(err);
      }
    };

    // Saves the chat right away, and forgets a save that was waiting.
    async function now(chat) {
      const entry = waiting.get(chat.id);
      if (entry) {
        cancel(entry.timer);
        waiting.delete(chat.id);
      }
      await write(chat);
    }

    // Saves the chat in `ms`, unless a save is already waiting. Then the
    // waiting save keeps its time but writes this copy: the chat may have been
    // swapped for a fresh one (from sync) since, and the newest is what counts.
    function soon(chat, ms, after = () => {}) {
      const entry = waiting.get(chat.id);
      if (entry) {
        entry.chat = chat;
        return;
      }
      const fresh = { chat, timer: null };
      fresh.timer = schedule(() => {
        waiting.delete(chat.id);
        write(fresh.chat).then(() => after(fresh.chat));
      }, ms);
      waiting.set(chat.id, fresh);
    }

    // Saves every chat that is waiting, now. Resolves when all are written.
    async function flush() {
      const chats = [...waiting.values()].map((entry) => {
        cancel(entry.timer);
        return entry.chat;
      });
      waiting.clear();
      await Promise.all(chats.map(write));
      return chats.length;
    }

    // Forgets a waiting save (the chat was deleted).
    function drop(id) {
      const entry = waiting.get(id);
      if (entry) cancel(entry.timer);
      waiting.delete(id);
    }

    return { now, soon, flush, drop, pending: () => waiting.size };
  }

  const api = { createSaveQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaveQueue = api;
})(typeof window !== 'undefined' ? window : globalThis);
