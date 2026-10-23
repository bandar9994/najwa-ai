// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { chatWithTools } = require('../src/tool-chat');
const { textBrowser } = require('../src/browser-tools');
const { searchResults } = require('../src/link-reader');

function server(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections(); srv.close(); } });
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(JSON.parse(data || '{}')));
  });
}

// A pretend browser: records what the model asked for.
function fakeTools() {
  const calls = [];
  return {
    calls,
    defs: [{ name: 'open_page', description: 'Open a page', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
      { name: 'screenshot', description: 'See the page', parameters: { type: 'object', properties: {} } }],
    describe: (c) => (c.name === 'open_page' ? `Opening ${c.args.url}` : 'Looking at the page'),
    async run(name, args) {
      calls.push({ name, args });
      if (name === 'screenshot') return { text: 'Screenshot of the page.', image: 'data:image/jpeg;base64,/9j/AAA=' };
      if (args.url === 'https://broken.example/') throw new Error('Couldn\'t find that website.');
      return { text: 'Page: Cloudpick\nText: Fast servers in Riyadh.' };
    }
  };
}

const sse = (res, events) => {
  res.setHeader('Content-Type', 'text/event-stream');
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

test('OpenAI-compatible: the model opens a page, sees a screenshot, then answers', async () => {
  const bodies = [];
  const s = await server(async (req, res) => {
    const body = await readBody(req);
    bodies.push(body);
    if (bodies.length === 1) {
      return sse(res, [
        chunk({ reasoning_content: 'I should look at it.' }),
        chunk({ content: 'Let me look. ' }),
        chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'open_page', arguments: '{"url":"https://cloud' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'pick.sa/"}' } }] }),
        chunk({ tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'screenshot', arguments: '{}' } }] }, 'tool_calls')
      ]);
    }
    sse(res, [chunk({ content: 'Clear headline, fast servers.' }), chunk({}, 'stop')]);
  });
  try {
    const tools = fakeTools();
    const infos = [];
    let text = '';
    const r = await chatWithTools({
      kind: 'openaiCompatible', cfg: { baseUrl: s.url }, tools,
      req: { model: 'deepseek-flash', system: 'Be brief.', messages: [{ role: 'user', content: 'What do you think of cloudpick.sa?' }] },
      onDelta: (d) => { text += d; }, onInfo: (i) => infos.push(i)
    });
    assert.strictEqual(r.text, text);
    assert.strictEqual(text, '<think>I should look at it.</think>\n\nLet me look. \n\nClear headline, fast servers.');
    assert.deepStrictEqual(tools.calls, [{ name: 'open_page', args: { url: 'https://cloudpick.sa/' } }, { name: 'screenshot', args: {} }]);
    assert.deepStrictEqual(infos.map((i) => `${i.kind}:${i.label}:${i.status || ''}`), [
      'tool:Opening https://cloudpick.sa/:running', 'tool:Opening https://cloudpick.sa/:completed',
      'tool:Looking at the page:running', 'tool:Looking at the page:completed', 'shot:Looking at the page:'
    ]);
    // The tools were offered, and the second request carried the calls, results and screenshot.
    assert.deepStrictEqual(bodies[0].tools.map((t) => t.function.name), ['open_page', 'screenshot']);
    const second = bodies[1].messages;
    assert.deepStrictEqual(second.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user']);
    assert.strictEqual(second[2].tool_calls[0].function.arguments, '{"url":"https://cloudpick.sa/"}');
    assert.strictEqual(second[2].reasoning_content, 'I should look at it.');
    assert.strictEqual(second[3].tool_call_id, 'c1');
    assert.match(second[3].content, /Fast servers in Riyadh/);
    assert.strictEqual(second[5].content[1].image_url.url, 'data:image/jpeg;base64,/9j/AAA=');
  } finally {
    s.close();
  }
});

test('Ollama: tool calls, an error passed back to the model, and a model without tools', async () => {
  const bodies = [];
  let caps = ['completion', 'tools'];
  const s = await server(async (req, res) => {
    const body = await readBody(req);
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: caps }));
    bodies.push(body);
    res.setHeader('Content-Type', 'application/x-ndjson');
    if (bodies.length === 1) {
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'open_page', arguments: { url: 'https://broken.example/' } } }] }, done: false })}\n`);
      return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' })}\n`);
    }
    res.write(`${JSON.stringify({ message: { role: 'assistant', content: 'That site didn\'t open.' }, done: false })}\n`);
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 5, eval_duration: 1e9 })}\n`);
  });
  try {
    const tools = fakeTools();
    const infos = [];
    const r = await chatWithTools({
      kind: 'ollama', cfg: { baseUrl: s.url }, tools,
      req: { model: 'qwen3.5:27b', messages: [{ role: 'user', content: 'Open broken.example' }] },
      onDelta: () => {}, onInfo: (i) => infos.push(i)
    });
    assert.strictEqual(r.text, 'That site didn\'t open.');
    assert.strictEqual(r.stats.tokens, 5);
    assert.strictEqual(bodies[0].tools[0].function.name, 'open_page');
    const back = bodies[1].messages;
    assert.deepStrictEqual(back.map((m) => m.role), ['user', 'assistant', 'tool']);
    assert.strictEqual(back[2].tool_name, 'open_page');
    assert.match(back[2].content, /That didn't work: Couldn't find that website/);
    assert.strictEqual(infos[1].label, 'Opening https://broken.example/ (didn\'t work)');
    assert.strictEqual(infos[1].relabel, true);

    // A model without tools: the ordinary reply is used instead.
    caps = ['completion'];
    const before = bodies.length;
    const fallback = await chatWithTools({
      kind: 'ollama', cfg: { baseUrl: s.url }, tools,
      req: { model: 'gemma3:1b', messages: [{ role: 'user', content: 'hi' }] }, onDelta: () => {}
    });
    assert.deepStrictEqual(fallback, { fallback: true });
    assert.strictEqual(bodies.length, before);
  } finally {
    s.close();
  }
});

test('OpenAI-compatible: a server that refuses tools falls back to the ordinary reply', async () => {
  const s = await server(async (req, res) => {
    await readBody(req);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'This model does not support tools' } }));
  });
  try {
    const r = await chatWithTools({
      kind: 'openaiCompatible', cfg: { baseUrl: s.url }, tools: fakeTools(),
      req: { model: 'tiny', messages: [{ role: 'user', content: 'hi' }] }, onDelta: () => {}
    });
    assert.deepStrictEqual(r, { fallback: true });
  } finally {
    s.close();
  }
});

const claudeSse = (res, events) => {
  res.setHeader('Content-Type', 'text/event-stream');
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const start = { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } };

test('Claude: tool use, with the screenshot in the tool result', async () => {
  const bodies = [];
  const s = await server(async (req, res) => {
    bodies.push(await readBody(req));
    if (bodies.length === 1) {
      return claudeSse(res, [start,
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'screenshot', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: 'message_stop' }]);
    }
    claudeSse(res, [start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The design is clean.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' }]);
  });
  try {
    const r = await chatWithTools({
      kind: 'anthropic', cfg: { apiKey: 'k', baseUrl: s.url }, tools: fakeTools(),
      req: { model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'How does it look?' }] }, onDelta: () => {}
    });
    assert.strictEqual(r.text, 'The design is clean.');
    assert.strictEqual(bodies[0].tools[1].name, 'screenshot');
    const result = bodies[1].messages[2].content[0];
    assert.strictEqual(bodies[1].messages[1].content[0].type, 'tool_use');
    assert.strictEqual(result.type, 'tool_result');
    assert.strictEqual(result.tool_use_id, 'tu_1');
    assert.deepStrictEqual(result.content[1], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAA=' } });
  } finally {
    s.close();
  }
});

test('Text browser (phone): search results and pages with links', async () => {
  const s = await server((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url.startsWith('/html/')) {
      return res.end(`<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcloudpick.sa%2F&amp;rut=x">Cloudpick &amp; Co</a>
        <a class="result__snippet" href="#">Cloud <b>hosting</b> in Riyadh</a></div>
        <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>`);
    }
    res.end('<title>Cloudpick</title><h1>Hello</h1><a href="/pricing">Pricing</a> <a href="https://x.com/c">X</a>');
  });
  try {
    // DuckDuckGo's page is fetched from duckduckgo.com: point it at the fake server.
    const doFetch = (url, init) => fetch(url.replace('https://html.duckduckgo.com', s.url).replace('https://cloudpick.sa', s.url), init);
    const b = textBrowser(doFetch);
    assert.deepStrictEqual(b.defs.map((d) => d.name), ['web_search', 'open_page']);
    const found = await b.run('web_search', { query: 'cloudpick' });
    assert.match(found.text, /1\. Cloudpick & Co\n {3}https:\/\/cloudpick\.sa\/\n {3}Cloud hosting in Riyadh/);
    assert.doesNotMatch(found.text, /Ad/);
    const page = await b.run('open_page', { url: 'https://cloudpick.sa/' });
    assert.match(page.text, /Page: Cloudpick/);
    assert.match(page.text, /Links \(open their addresses\):\n\[1\] link "Pricing" → https:\/\/cloudpick\.sa\/pricing/);
    assert.match((await b.run('click', { number: 1 })).text, /reads pages as text/);
    await assert.rejects(b.run('open_page', { url: 'file:///etc/passwd' }), /Only http and https/);
    assert.deepStrictEqual(searchResults('<p>nothing</p>'), []);
  } finally {
    s.close();
  }
});

test('Phone browser: drives the app\'s hidden web view through the Browse plugin', async () => {
  const { nativeBrowser } = require('../src/browser-native');
  const calls = [];
  const page = { title: 'Cloudpick', url: 'https://cloudpick.sa/', text: 'Your cloud, in Saudi Arabia', items: [{ id: 1, kind: 'link', label: 'Pricing', href: 'https://cloudpick.sa/pricing' }] };
  const Browse = {
    async open() { calls.push('open'); },
    async load({ url }) {
      calls.push(`load ${url}`);
      if (url.includes('nowhere')) throw new Error('net::ERR_NAME_NOT_RESOLVED');
    },
    async stop() { calls.push('stop'); },
    async eval({ js }) {
      if (js.includes('data-najwa-id') && js.includes('items')) return { value: JSON.stringify(page) };
      if (js.includes('el.click()')) { page.url = 'https://cloudpick.sa/pricing'; page.title = 'Pricing'; return { value: 'true' }; }
      if (js.includes('getAnimations')) return { value: JSON.stringify({ ready: 'complete', fonts: 'loaded', anims: 0, imgs: 0, sig: 1 }) };
      if (js.includes('readyState')) return { value: JSON.stringify({ url: page.url, ready: 'complete' }) };
      return { value: 'null' };
    },
    async snapshot() { return { data: '/9j/AAA=' }; },
    async close() { calls.push('close'); }
  };
  const b = nativeBrowser(Browse, { doFetch: () => { throw new Error('no network in this test'); } });
  assert.deepStrictEqual(b.defs.map((d) => d.name), ['web_search', 'open_page', 'click', 'type_text', 'screenshot']);
  const opened = await b.run('open_page', { url: 'https://cloudpick.sa/' });
  assert.match(opened.text, /Page: Cloudpick[\s\S]*\[1\] link "Pricing"/);
  assert.strictEqual(b.describe({ name: 'click', args: { number: 1 } }), 'Clicking "Pricing"');
  assert.match((await b.run('click', { number: 1 })).text, /Page: Pricing/);
  assert.strictEqual((await b.run('screenshot', {})).image, 'data:image/jpeg;base64,/9j/AAA=');
  await assert.rejects(b.run('open_page', { url: 'https://nowhere.example/' }), /Couldn't find that website/);
  b.close();
  assert.deepStrictEqual(calls, ['open', 'load https://cloudpick.sa/', 'load https://nowhere.example/', 'stop', 'close']);
});
