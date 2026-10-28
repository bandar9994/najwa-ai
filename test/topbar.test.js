// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The chat header on phones: the conversation title has priority over the
// model picker, and the layout uses logical properties so RTL works.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');

function block(selector, from = 0) {
  const i = css.indexOf(selector, from);
  assert.ok(i >= 0, `${selector} not found`);
  return css.slice(i, css.indexOf('}', i));
}

test('the title can shrink (min-width 0) and is start-aligned', () => {
  const b = block('#chatTitle {');
  assert.match(b, /min-width:\s*0/);
  assert.match(b, /flex:\s*1 1 auto/);
  assert.match(b, /text-align:\s*start/);
});

test('on phones the title may use two lines and the model select is capped', () => {
  const phones = css.indexOf('@media (max-width: 700px)');
  const t = block('#chatTitle {', phones);
  assert.match(t, /line-clamp:\s*2/);
  assert.match(block('#modelSelect {', phones), /max-width:\s*40vw/);
});

test('on narrow phones the model select wraps under the title', () => {
  const m = css.indexOf('@media (max-width: 480px)');
  assert.ok(m > 0);
  const tail = css.slice(m, css.indexOf('\n}\n', m));
  assert.match(tail, /#topbar \{[^}]*flex-wrap:\s*wrap/);
  assert.match(tail, /\.topbar-controls \{\s*display:\s*contents/);
  assert.match(tail, /#modelSelect \{[^}]*flex:\s*1 1 100%/);
});

test('the header and its menu use logical properties, not left/right', () => {
  const topbar = css.slice(css.indexOf('#topbar {'), css.indexOf('#assistantSelect { max-width'));
  assert.doesNotMatch(topbar, /\b(margin|padding)-(left|right)\b|\b(left|right):/);
  assert.match(block('.menu {'), /inset-inline-end:\s*0/);
  assert.doesNotMatch(css, /\.menu \{ right: 0; \}/);
});

test('the full model name stays reachable through the select title', () => {
  assert.match(app, /el\.modelSelect\.title = el\.modelSelect\.selectedOptions\[0\]/);
});
