// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Who is writing a reply. A reply still being written carries
//
//   owner: { deviceId, name, ts }
//
// where `ts` is refreshed while the reply streams. Another device that finds
// the chat (through sync) while the lease is live must not treat the reply as
// cut off: it shows "Replying on <name>…" and leaves it alone. Once the lease
// has gone stale the reply counts as interrupted, as it always did for chats
// without an owner. The owner is dropped when the reply ends.
//
// Used by the sync merge (src/sync.js), the desktop app's reply bookkeeping
// (src/reply-hub.js) and the UI (renderer/app.js, loaded as window.Lease).

(function (root) {
  'use strict';

  // How long a lease counts as live without a refresh. The owner refreshes it
  // every HEARTBEAT_MS, but another device only sees the refresh after it has
  // synced (a push is at most every ~20 s, and the other device looks every
  // ~20 s), so this has to be well above the ~40 s that adds up to.
  const LEASE_MS = 90 * 1000;
  const HEARTBEAT_MS = 10 * 1000;
  // A lease dated further ahead than this (the owner's clock is wrong by more
  // than the sync protocol itself tolerates) is not trusted either.
  const SKEW_MS = 5 * 60 * 1000;

  const leaseLive = (owner, now = Date.now()) => !!owner && typeof owner === 'object'
    && Number.isFinite(owner.ts) && now - owner.ts <= LEASE_MS && owner.ts - now <= SKEW_MS;

  // The reply is still being written by a device whose lease is live.
  const liveReply = (msg, now = Date.now()) => !!msg && !!msg.pending && leaseLive(msg.owner, now);

  // The reply is being written by some other device than `deviceId`.
  const foreignReply = (msg, deviceId, now = Date.now()) => liveReply(msg, now)
    && !!msg.owner.deviceId && msg.owner.deviceId !== deviceId;

  const newOwner = (deviceId, name, now = Date.now()) => ({ deviceId: String(deviceId), name: String(name || 'another device').slice(0, 60), ts: now });

  // Refresh the lease of a reply this device is writing.
  function touch(msg, now = Date.now()) {
    if (msg && msg.owner) msg.owner.ts = now;
    return msg;
  }

  // A reply that is still marked as being written but isn't (any more): ends
  // it the way a reply cut off by closing the app always ended, and flags it
  // when it had an owner, so a copy that finished elsewhere replaces it.
  function interrupt(msg) {
    msg.pending = false;
    if (!msg.content) msg.error = 'This reply was interrupted.';
    if (msg.owner) {
      msg.interrupted = true;
      delete msg.owner;
    }
    return msg;
  }

  // The first chat in a list with a reply being written on another device.
  const foreignInChat = (chat, deviceId, now = Date.now()) => (chat && chat.messages || []).find((m) => foreignReply(m, deviceId, now)) || null;

  // What the app says about it, in English and Arabic (the app's own text is
  // English; these two are shown in Arabic when the device is set to Arabic).
  const STRINGS = {
    en: {
      replyingOn: (name) => `Replying on ${name}…`,
      busyElsewhere: (name) => `A reply is already being written in this chat (on ${name}). Wait for it to finish, or stop it there first.`,
      busy: () => 'A reply is already being written in this chat. Wait for it to finish, or stop it first. Your message is kept.'
    },
    ar: {
      replyingOn: (name) => `جارٍ الرد على ${name}…`,
      busyElsewhere: (name) => `يُكتب ردٌّ في هذه المحادثة الآن (على ${name}). انتظر حتى ينتهي، أو أوقفه هناك أولاً.`,
      busy: () => 'يُكتب ردٌّ في هذه المحادثة الآن. انتظر حتى ينتهي، أو أوقفه أولاً. رسالتك محفوظة.'
    }
  };
  const language = () => (typeof navigator !== 'undefined' && /^ar/i.test(navigator.language || '') ? 'ar' : 'en');
  const text = (key, name, lang = language()) => (STRINGS[lang] || STRINGS.en)[key](name || 'another device');

  const api = { text, STRINGS, LEASE_MS, HEARTBEAT_MS, SKEW_MS, leaseLive, liveReply, foreignReply, foreignInChat, newOwner, touch, interrupt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lease = api;
})(typeof window !== 'undefined' ? window : globalThis);
