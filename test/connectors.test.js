// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { httpTransport, mcpClient } = require('../src/mcp-client');
const { stdioTransport } = require('../src/mcp-stdio');
const { connectorHub, connectorsNote } = require('../src/connectors');

const TOKEN = 'github_pat_test';

// Plays GitHub's MCP server: Streamable HTTP, a session id, answers as JSON
// or as an event stream, two pages of tools, and a token check.
function fakeGitHub() {
  const seen = { methods: [], sessions: [], protocol: [], restarts: 0 };
  let session = 'sess-1';
  const tools = [
    { name: 'get_file_contents', title: 'Get file contents', description: 'Get the contents of a file or directory from a GitHub repository.', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'list_issues', description: 'List issues in a GitHub repository.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'create_pull_request', title: 'Open new pull request', description: 'Create a new pull request in a GitHub repository. Use it after pushing a branch.', inputSchema: { type: 'object', properties: { title: { type: 'string' } } }, annotations: { readOnlyHint: false } }
  ];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401);
        return res.end('Bad credentials');
      }
      if (req.method === 'DELETE') return res.end();
      const msg = JSON.parse(body);
      seen.methods.push(msg.method);
      seen.sessions.push(req.headers['mcp-session-id'] || null);
      seen.protocol.push(req.headers['mcp-protocol-version'] || null);
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== session) {
        res.writeHead(404);
        return res.end();
      }
      if (msg.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      const reply = (result, sse) => {
        const out = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
        if (sse) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': session });
          res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
          return res.end(`event: message\ndata: ${out}\n\n`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': session });
        res.end(out);
      };
      if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'github-mcp-server', version: '0.9' } });
      if (msg.method === 'tools/list') {
        // Two pages, the second as an event stream.
        if (!msg.params.cursor) return reply({ tools: tools.slice(0, 2), nextCursor: 'p2' });
        return reply({ tools: tools.slice(2) }, true);
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        if (name === 'get_file_contents') return reply({ content: [{ type: 'text', text: `# ${args.repo}\nA private AI chat app.` }] }, true);
        if (name === 'create_pull_request') return reply({ content: [{ type: 'text', text: `Opened PR #39: ${args.title}` }] });
        return reply({ content: [{ type: 'text', text: 'boom' }], isError: true });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, url: `http://127.0.0.1:${server.address().port}/mcp/`,
    restart() { session = `sess-${++seen.restarts + 1}`; }
  })));
}

const transportFor = (c) => (c.kind === 'command'
  ? stdioTransport({ command: c.command, args: c.args })
  : httpTransport({ url: c.url, headers: c.token ? { Authorization: `Bearer ${c.token}` } : {} }));

test('MCP over HTTP: connects, lists every page of tools, calls them, and reconnects when the session is gone', async () => {
  const gh = await fakeGitHub();
  try {
    const client = mcpClient(httpTransport({ url: gh.url, headers: { Authorization: `Bearer ${TOKEN}` } }));
    const tools = await client.listTools();
    assert.deepStrictEqual(tools.map((t) => t.name), ['get_file_contents', 'list_issues', 'create_pull_request']);
    assert.deepStrictEqual(client.server(), { name: 'github-mcp-server', version: '0.9' });
    assert.deepStrictEqual(gh.seen.methods.slice(0, 2), ['initialize', 'notifications/initialized']);
    assert.strictEqual(gh.seen.sessions[1], 'sess-1');
    assert.strictEqual(gh.seen.protocol[2], '2025-06-18');
    const r = await client.callTool('get_file_contents', { owner: 'me', repo: 'najwa-ai', path: 'README.md' });
    assert.strictEqual(r.content[0].text, '# najwa-ai\nA private AI chat app.');
    // The server restarted: the client connects again by itself.
    gh.restart();
    const again = await client.callTool('get_file_contents', { owner: 'me', repo: 'x', path: 'a' });
    assert.match(again.content[0].text, /# x/);
    assert.strictEqual(gh.seen.methods.filter((m) => m === 'initialize').length, 2);
    // A wrong token.
    const bad = mcpClient(httpTransport({ url: gh.url, headers: { Authorization: 'Bearer nope' } }));
    await assert.rejects(bad.listTools(), /didn't accept your token/);
  } finally {
    gh.server.close();
  }
});

test('MCP over stdio: a program on this computer', async () => {
  const client = mcpClient(stdioTransport({ command: process.execPath, args: [path.join(__dirname, 'fixtures', 'mcp-stdio-server.js')] }));
  try {
    assert.deepStrictEqual((await client.listTools()).map((t) => t.name), ['get_file', 'create_issue']);
    assert.strictEqual(client.server().name, 'test-stdio');
    assert.strictEqual((await client.callTool('get_file', { path: 'notes.md' })).content[0].text, 'contents of notes.md');
  } finally {
    client.close();
  }
  const missing = mcpClient(stdioTransport({ command: 'no-such-program-najwa', args: [] }));
  await assert.rejects(missing.listTools(), /stopped|not found/);
});

test('Connectors: tools for the model, read-only ones run freely, others wait for the user', async () => {
  const gh = await fakeGitHub();
  const hub = connectorHub({ transportFor });
  try {
    const connectors = [
      { id: 'c1', name: 'GitHub', kind: 'url', url: gh.url, token: TOKEN, enabled: true },
      { id: 'c2', name: 'Local notes', kind: 'command', command: process.execPath, args: [path.join(__dirname, 'fixtures', 'mcp-stdio-server.js')], enabled: true },
      { id: 'c3', name: 'Off', kind: 'url', url: 'http://127.0.0.1:1/', enabled: false },
      { id: 'c4', name: 'Broken', kind: 'url', url: 'http://127.0.0.1:1/', enabled: true }
    ];
    const asked = [];
    let answer = 'deny';
    const allowed = new Set();
    const set = await hub.toolset(connectors, { approve: async (a) => { asked.push(a); return answer; }, allowed });
    assert.deepStrictEqual(set.defs.map((d) => d.name), [
      'github__get_file_contents', 'github__list_issues', 'github__create_pull_request', 'local_notes__get_file', 'local_notes__create_issue'
    ]);
    assert.match(set.defs[0].description, /^\[GitHub\] Get the contents/);
    assert.deepStrictEqual(set.connected, ['GitHub', 'Local notes']);
    assert.match(set.problems[0], /^Broken couldn't be reached/);
    assert.match(connectorsNote('Be brief.', set), /Be brief\.\n\nYou're connected to: GitHub, Local notes\.[\s\S]*Broken couldn't be reached/);

    // Reading: no question asked.
    const call = { name: 'github__get_file_contents', args: { owner: 'me', repo: 'najwa-ai', path: 'README.md' } };
    assert.strictEqual(set.describe(call), 'GitHub: Get file contents README.md');
    assert.strictEqual(set.emoji(call), '🔌');
    assert.match((await set.run(call.name, call.args)).text, /A private AI chat app/);
    assert.strictEqual(asked.length, 0);

    // Changing something: the user is asked; "Deny" stops it.
    const pr = { title: 'Fix typo' };
    const denied = await set.run('github__create_pull_request', pr);
    assert.strictEqual(denied.error, true);
    assert.match(denied.text, /said no/);
    assert.strictEqual(asked[0].title, 'GitHub: Open new pull request');
    assert.match(asked[0].command, /GitHub → create_pull_request\n\{\n {2}"title": "Fix typo"\n\}/);
    assert.strictEqual(asked[0].description, 'Create a new pull request in a GitHub repository.');
    // "Allow for this chat": asked once, then not again.
    answer = 'session';
    assert.strictEqual((await set.run('github__create_pull_request', pr)).text, 'Opened PR #39: Fix typo');
    assert.strictEqual((await set.run('github__create_pull_request', pr)).text, 'Opened PR #39: Fix typo');
    assert.strictEqual(asked.length, 2);
    assert.ok(allowed.has('c1/create_pull_request'));
    // A tool on the local program that isn't marked read-only asks too.
    answer = 'once';
    assert.strictEqual((await set.run('local_notes__create_issue', { title: 'Hi' })).text, 'created "Hi"');
    assert.strictEqual(asked.length, 3);

    // Testing a connector from Settings.
    assert.deepStrictEqual(await hub.test(connectors[0]), { ok: true, server: 'github-mcp-server 0.9', tools: ['get_file_contents', 'list_issues', 'create_pull_request'] });
    const wrong = await hub.test({ ...connectors[0], id: 'c5', token: 'nope' });
    assert.strictEqual(wrong.ok, false);
    assert.match(wrong.error, /didn't accept your token/);
  } finally {
    hub.close();
    gh.server.close();
  }
});

test('Connectors: "Always allow", and "Allow everything without asking" from the start', async () => {
  const gh = await fakeGitHub();
  const hub = connectorHub({ transportFor });
  try {
    const github = { id: 'c1', name: 'GitHub', kind: 'url', url: gh.url, token: TOKEN, enabled: true };
    const pr = { title: 'Fix typo' };

    // "Always allow" on one question: nothing else from that connector asks, in this reply.
    const asked = [];
    const allowed = new Set();
    let set = await hub.toolset([github], { approve: async (a) => { asked.push(a); return 'always'; }, allowed });
    assert.strictEqual((await set.run('github__create_pull_request', pr)).text, 'Opened PR #39: Fix typo');
    assert.strictEqual(asked[0].connectorId, 'c1');
    assert.strictEqual((await set.run('github__create_pull_request', pr)).text, 'Opened PR #39: Fix typo');
    assert.strictEqual(asked.length, 1);
    assert.ok(allowed.has('c1/*'));

    // Allowed from the start (the setting): never asks, and the model is told not to stop.
    const never = async () => assert.fail('asked although everything is allowed');
    set = await hub.toolset([{ ...github, autoApprove: true }], { approve: never, allowed: new Set() });
    assert.strictEqual((await set.run('github__create_pull_request', pr)).text, 'Opened PR #39: Fix typo');
    const note = connectorsNote('', set);
    assert.match(note, /allowed everything with GitHub without asking/);
    assert.doesNotMatch(note, /waits for the user's approval/);
  } finally {
    hub.close();
    gh.server.close();
  }
});

test('Local approvals: "Always allow" is offered and passed on', async () => {
  const { localApprovals } = require('../src/local-approvals');
  const approvals = localApprovals();
  const infos = [];
  const answer = approvals.asker((i) => infos.push(i))({ connectorId: 'c1', title: 'GitHub: Open new pull request', command: '', description: '' });
  assert.deepStrictEqual(infos[0].choices, ['once', 'session', 'always', 'deny']);
  assert.strictEqual(infos[0].connectorId, 'c1');
  assert.strictEqual(approvals.answer({ runId: infos[0].runId, choice: 'always' }), true);
  assert.strictEqual(await answer, 'always');
});

test('A question a computer\'s connector asked can be answered from the phone, over the computer link', async () => {
  const { localApprovals } = require('../src/local-approvals');
  const { linkKey, remoteComputers } = require('../src/remote');
  const { startRemoteServer } = require('../src/remote-server');
  const { toBase64 } = require('../src/sync');
  const syncKey = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  // The computer: a connector asks, as main.js wires it (approve handler first
  // tries the computer's own questions).
  const approvals = localApprovals();
  const infos = [];
  const origin = { id: 'desk', name: 'Desk', computer: true };
  const pc = await startRemoteServer({
    port: 0,
    host: '127.0.0.1',
    getKey: async () => linkKey(syncKey),
    handlers: {
      hello: async () => ({ app: 'balimda', name: 'Desk' }),
      approve: async (msg) => (approvals.owns(msg.payload) ? approvals.answer(msg.payload) : false)
    }
  });
  try {
    const asked = approvals.asker((i) => infos.push(i), undefined, origin)({ title: 'GitHub: Open new pull request', command: 'GitHub → create_pull_request', description: 'Create a PR.' });
    const q = infos[0];
    assert.deepStrictEqual(q.origin, origin);
    assert.match(q.runId, /^local:/);
    // The phone (with a chat synced from the computer) answers through the link.
    const phone = remoteComputers({ getKey: async () => syncKey, getComputers: async () => ({ desk: { id: 'desk', name: 'Desk', addrs: ['127.0.0.1'], port: pc.port, enabled: true } }) });
    assert.strictEqual(await phone.answerOn('desk', { runId: q.runId, choice: 'once' }), true);
    assert.strictEqual(await asked, 'once');
    // Too late: the question isn't waiting any more.
    assert.strictEqual(await phone.answerOn('desk', { runId: q.runId, choice: 'deny' }), false);
    // A computer that isn't sharing.
    const off = remoteComputers({ getKey: async () => syncKey, getComputers: async () => ({ desk: { id: 'desk', name: 'Desk', addrs: ['127.0.0.1'], port: pc.port, enabled: false } }) });
    await assert.rejects(off.answerOn('desk', { runId: q.runId, choice: 'once' }), /isn't sharing/);
  } finally {
    await pc.close();
  }
});
