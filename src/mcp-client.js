// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Talking to connectors: servers that speak the Model Context Protocol
// (MCP, modelcontextprotocol.io), like GitHub's. Just what Najwa AI needs: a
// connector lists its tools, and the model calls them.
//
// Connectors on the internet use MCP's "Streamable HTTP": JSON-RPC messages
// POSTed to one address, answered with JSON or a short event stream. On a
// computer, a connector can also be a program it runs (src/mcp-stdio.js).

'use strict';

const { readSse, httpError } = require('./providers');

const PROTOCOL = '2025-06-18';

class McpError extends Error {}
class SessionExpired extends Error {}

/**
 * Streamable HTTP.
 * @param url      the connector's address
 * @param headers  e.g. { Authorization: 'Bearer …' }
 * @param doFetch  fetch, or the phone's own network code
 */
function httpTransport({ url, headers = {}, doFetch = (...args) => fetch(...args) }) {
  let session = null;
  let protocol = null;

  async function post(message, signal) {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}),
        ...(session ? { 'Mcp-Session-Id': session } : {}),
        ...headers
      },
      body: JSON.stringify(message),
      signal
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session = sid;
    if (res.status === 404 && session && message.method !== 'initialize') {
      session = null;
      throw new SessionExpired('The connector forgot this session.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new McpError('The connector didn\'t accept your token (it may be wrong, expired, or not allowed to do this).');
    }
    if (!res.ok) throw await httpError(res);
    if (message.id === undefined) return null; // a notification: nothing comes back
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/event-stream')) {
      for await (const { data } of readSse(res.body)) {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          continue;
        }
        if (msg.id === message.id && ('result' in msg || 'error' in msg)) return msg;
      }
      throw new McpError('The connector stopped before answering.');
    }
    const text = await res.text();
    const msg = JSON.parse(text);
    return Array.isArray(msg) ? msg.find((m) => m.id === message.id) : msg;
  }

  let nextId = 0;
  return {
    async request(method, params, signal) {
      const msg = await post({ jsonrpc: '2.0', id: ++nextId, method, params }, signal);
      if (!msg) throw new McpError('The connector sent no answer.');
      if (msg.error) throw new McpError(msg.error.message || 'The connector reported an error.');
      return msg.result;
    },
    notify: (method, params) => post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }),
    setProtocol(v) {
      protocol = v;
    },
    reset() {
      session = null;
    },
    close() {
      if (!session) return;
      const s = session;
      session = null;
      doFetch(url, { method: 'DELETE', headers: { 'Mcp-Session-Id': s, ...headers } }).catch(() => {});
    }
  };
}

/** A connector: its tools, and calling them. Connects on first use. */
function mcpClient(transport, { version = '1.0' } = {}) {
  let ready = null;
  let server = null;

  const start = (signal) => {
    if (!ready) {
      ready = (async () => {
        const r = await transport.request('initialize', {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: 'Najwa AI', version }
        }, signal);
        if (transport.setProtocol) transport.setProtocol(r.protocolVersion || PROTOCOL);
        server = r.serverInfo || null;
        await transport.notify('notifications/initialized');
      })().catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  };

  const call = async (method, params, signal) => {
    await start(signal);
    try {
      return await transport.request(method, params, signal);
    } catch (err) {
      if (!(err instanceof SessionExpired)) throw err;
      // The connector restarted: connect again once.
      ready = null;
      if (transport.reset) transport.reset();
      await start(signal);
      return transport.request(method, params, signal);
    }
  };

  return {
    server: () => server,
    async listTools(signal) {
      const tools = [];
      let cursor;
      do {
        const r = await call('tools/list', cursor ? { cursor } : {}, signal);
        tools.push(...(r.tools || []));
        cursor = r.nextCursor;
      } while (cursor && tools.length < 500);
      return tools;
    },
    callTool: (name, args, signal) => call('tools/call', { name, arguments: args || {} }, signal),
    close() {
      ready = null;
      transport.close();
    }
  };
}

module.exports = { httpTransport, mcpClient, McpError, PROTOCOL };
