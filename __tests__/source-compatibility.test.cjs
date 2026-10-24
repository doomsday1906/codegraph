const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dist = process.env.CODEGRAPH_TEST_DIST || path.resolve(__dirname, '../dist');

test('maintained builds identify the exact commit when connecting to a daemon', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(dist, '../package.json'), 'utf8'));
  const version = require(path.join(dist, 'mcp/version.js'));
  assert.equal(version.CodeGraphPackageVersion, metadata.version);
  assert.equal(version.CodeGraphRuntimeIdentity, metadata.agentworkspace
    ? metadata.version + '+aw.' + metadata.agentworkspace.revision : metadata.version);
});

test('source-built native parsing remains available in the installed release', () => {
  const kernel = require(path.join(dist, 'extraction/kernel/loader.js')).getKernel();
  assert(kernel, 'native kernel must be built and included');
  assert(kernel.contractInfo().languages.includes('python'));
});

// Existing worktrees already contain source indexed under this fork default.
test('maintained builds retain the 2 MiB default for existing worktrees', () => {
  assert.equal(require(path.join(dist, 'file-limits.js')).MAX_SOURCE_FILE_SIZE_BYTES, 2097152);
});

test('an MCP proxy loads neither the engine nor the daemon it pipes to', () => {
  const loaded = require('node:child_process').execFileSync(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(dist, 'mcp/index.js'))});
    process.stdout.write(Object.keys(require.cache).filter((f) => /mcp[\\/](engine|daemon)\\.js$/.test(f)).join(','));
  `], { encoding: 'utf8' });
  assert.equal(loaded, '');
});
