// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A reply that starts writing the next turn ends there. A model prompted in a
// chat format it doesn't know (or a broken model file) can write its turn
// markers as plain text ("<|im_start|>user", "<end_of_turn>",
// "<end_of_assistant>"…) and carry on as the user and itself. The engine only
// stops at the model's own end-of-turn token, so the phone watches the text:
// the marker and everything after it are dropped, and the reply ends.
//
// Used for models on the phone (mobile/src/native-engine.js, on-device.js).

'use strict';

// Turn markers of the common chat formats, and the made-up kind models write
// when they copy a format ("<end_of_assistant>", "<|end_of_user|>").
const MARKER = /<\|?(?:im_start|im_end|turn|start_of_turn|end_of_turn|eot_id|start_header_id|end_header_id|endoftext|end_of_(?:assistant|user|model|system|turn))\|?>|<turn\|>|<\|(?:user|assistant|system)\|>/;
// The longest marker: text this long can hold the start of one.
const LONGEST = 24;

/**
 * @param emit (text) -> void   text that is safe to show
 * @returns { push(piece) -> boolean (false: stop the reply), end() }
 */
function turnGuard(emit) {
  let held = '';
  let stopped = false;
  return {
    push(piece) {
      if (stopped) return false;
      held += piece;
      const m = MARKER.exec(held);
      if (m) {
        const before = held.slice(0, m.index).replace(/\s+$/, '');
        if (before) emit(before);
        held = '';
        stopped = true;
        return false;
      }
      // Keep back what could be the start of a marker: from the last "<"
      // without a ">" after it, when it's short enough to be one.
      // Trailing spaces and line breaks wait for the next text too, so a reply
      // cut at a marker doesn't end with them.
      const lt = held.lastIndexOf('<');
      let keep = lt >= 0 && held.indexOf('>', lt) < 0 && held.length - lt < LONGEST ? held.length - lt : 0;
      const body = held.slice(0, held.length - keep);
      keep += body.length - body.replace(/\s+$/, '').length;
      const ready = held.slice(0, held.length - keep);
      held = held.slice(held.length - keep);
      if (ready) emit(ready);
      return true;
    },
    // The reply ended: what was kept back is shown after all.
    end() {
      if (!stopped && held) emit(held);
      held = '';
    },
    get stopped() {
      return stopped;
    }
  };
}

module.exports = { turnGuard, MARKER };
