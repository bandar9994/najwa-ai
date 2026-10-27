// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Runs every test/**/*.test.js with node's test runner. The files are listed
// here instead of with a glob or a folder name: shells differ in expanding
// globs (npm on Windows uses cmd), older Node versions don't expand them
// themselves, and `node --test test/` also runs helper files such as
// test/fixtures/mcp-stdio-server.js, which waits for input and never ends.
// Any extra arguments (e.g. --test-name-pattern) are passed on to node.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', 'test');

function testFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'fixtures' && entry.name !== 'node_modules') out.push(...testFiles(full));
    } else if (entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

const files = testFiles(root);
if (!files.length) {
  console.error('No test files found in', root);
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
