// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A connector that's a program on this computer (MCP over stdio): Najwa AI
// starts it, and they talk in lines of JSON over its input and output. Only
// in the desktop app; see src/mcp-client.js.

'use strict';

const { spawn } = require('child_process');
const { McpError } = require('./mcp-client');

const TIMEOUT_MS = 120000;

/**
 * @param command  e.g. "npx"
 * @param args     e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/notes"]
 * @param env      extra environment variables (e.g. a token)
 */
function stdioTransport({ command, args = [], env = {} }) {
  let child = null;
  let buffer = '';
  let errors = '';
  let nextId = 0;
  const pending = new Map(); // id -> { resolve, reject, timer }

  const fail = (err) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  };

  const write = (msg) => {
    if (!child) throw new McpError('The connector isn\'t running.');
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const onLine = (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // a program printing something else
    }
    if (msg.method && msg.id !== undefined) {
      // The connector asking us something (roots, sampling…): not supported.
      write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported by Najwa AI' } });
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new McpError(msg.error.message || 'The connector reported an error.'));
    else p.resolve(msg.result);
  };

  const ensure = () => {
    if (child) return;
    try {
      child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
    } catch (err) {
      throw new McpError(`Couldn't start ${command}: ${err.message}`);
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-2000);
    });
    const ended = (why) => {
      child = null;
      buffer = '';
      fail(new McpError(`${command} stopped${why}.${errors.trim() ? ` It said: ${errors.trim().split('\n').slice(-3).join(' ')}` : ''}`));
    };
    child.on('error', (err) => ended(` (${err.code === 'ENOENT' ? 'not found: is it installed?' : err.message})`));
    child.on('exit', (code) => ended(code ? ` (exit code ${code})` : ''));
  };

  return {
    request(method, params, signal) {
      ensure();
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new McpError('The connector didn\'t answer in time.'));
        }, TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        if (signal) {
          signal.addEventListener('abort', () => {
            if (!pending.has(id)) return;
            pending.delete(id);
            clearTimeout(timer);
            write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } });
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        }
        write({ jsonrpc: '2.0', id, method, params });
      });
    },
    async notify(method, params) {
      ensure();
      write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
    },
    close() {
      if (child) child.kill();
      child = null;
    }
  };
}

module.exports = { stdioTransport };
