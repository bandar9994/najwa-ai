// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const { turnGuard } = require('../src/turn-guard');

// Streams `text` in pieces of `size` characters; returns what was shown and where it stopped.
function stream(text, size = 3) {
  let shown = '';
  const g = turnGuard((t) => { shown += t; });
  let stoppedAt = -1;
  for (let i = 0; i < text.length; i += size) {
    if (!g.push(text.slice(i, i + size))) {
      stoppedAt = i;
      break;
    }
  }
  g.end();
  return { shown, stopped: g.stopped, stoppedAt };
}

test('a reply that writes the next turn ends there (a Gemma model prompted in ChatML)', () => {
  // From a real chat: the model answered, then wrote the user's next message and its own reply.
  const reply = 'أنا برنامج حاسوبي ولا أستطيع البحث على الإنترنت بنفسي. لكن يمكنني مساعدتك في الحصول على المعلومات التي تريدها، فقط أخبرني بما تبحث عنه.<end_of_assistant>\n<|im_start|>user\nطيب، وش رأيك بـ ChatGPT؟<end_of_user>\n<|im_start|>assistant\nChatGPT هو مساعد ذكي';
  for (const size of [1, 2, 3, 5, 8, 50]) {
    const r = stream(reply, size);
    assert.strictEqual(r.shown, 'أنا برنامج حاسوبي ولا أستطيع البحث على الإنترنت بنفسي. لكن يمكنني مساعدتك في الحصول على المعلومات التي تريدها، فقط أخبرني بما تبحث عنه.', `pieces of ${size}`);
    assert.ok(r.stopped);
  }
});

test('the turn markers of common chat formats', () => {
  for (const marker of ['<|im_start|>', '<|im_end|>', '<|turn>', '<turn|>', '<start_of_turn>', '<end_of_turn>', '<|eot_id|>', '<|start_header_id|>', '<|endoftext|>', '<end_of_assistant>', '<|end_of_user|>', '<|user|>', '<|assistant|>']) {
    const r = stream(`Hello there. ${marker}user\nmore`);
    assert.strictEqual(r.shown, 'Hello there.', marker);
    assert.ok(r.stopped, marker);
  }
});

test('ordinary text with < and > goes through whole', () => {
  const text = 'Use <think> tags? In HTML, <b>bold</b> and a < b > c. Generics: List<String>. Also <|not a marker|> and 3 <';
  const r = stream(text, 2);
  assert.strictEqual(r.shown, text);
  assert.ok(!r.stopped);
  // A thinking model's thoughts are not markers.
  assert.strictEqual(stream('<think>plan</think>\n\nAnswer.', 1).shown, '<think>plan</think>\n\nAnswer.');
});

test('the phone engines use the guard and treat its stop as the reply ending', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['mobile/src/native-engine.js', 'mobile/src/on-device.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, /import \{ turnGuard \} from '\.\.\/\.\.\/src\/turn-guard\.js'/, f);
    assert.match(src, /guard\.stopped \? 'end_turn'|if \(guard\.stopped\) stopReason = 'end_turn'/, f);
  }
});
