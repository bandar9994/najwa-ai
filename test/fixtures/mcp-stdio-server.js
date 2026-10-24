// A tiny MCP server over stdio, for tests: one read-only tool and one that changes something.
const tools = [
  { name: 'get_file', description: 'Read a file.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'create_issue', description: 'Create an issue. Opens it on the tracker.', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }
];
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, nl));
    buf = buf.slice(nl + 1);
    if (msg.id === undefined) continue;
    const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
    if (msg.method === 'initialize') reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test-stdio', version: '1.2' } });
    else if (msg.method === 'tools/list') reply({ tools });
    else if (msg.method === 'tools/call') {
      if (msg.params.name === 'get_file') reply({ content: [{ type: 'text', text: `contents of ${msg.params.arguments.path}` }] });
      else reply({ content: [{ type: 'text', text: `created "${msg.params.arguments.title}"` }] });
    } else process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } })}\n`);
  }
});
