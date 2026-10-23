const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const dist = process.env.CODEGRAPH_TEST_DIST || path.resolve(__dirname, '../dist');
const limits = require(path.join(dist, 'file-limits.js'));
const CG = require(path.join(dist, 'index.js')).default;

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

test('large source and old size markers recover with incoming calls and bounded reads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-source-limit-'));
  let cg;
  try {
    const source = path.join(root, 'source.py');
    fs.writeFileSync(source, '#'.repeat(1048676) + '\ndef included(): return 42\n');
    fs.writeFileSync(path.join(root, 'caller.py'), 'from source import included\ndef caller(): return included()\n');
    const oversized = path.join(root, 'oversized.py');
    fs.closeSync(fs.openSync(oversized, 'w'));
    fs.truncateSync(oversized, 2097153);
    const before = fs.statSync(source);
    assert.equal(limits.MAX_SOURCE_FILE_SIZE_BYTES, 2097152);
    assert((await limits.readBoundedSource(source)).bytes);
    assert(limits.readBoundedSourceSync(source).bytes);
    assert.equal((await limits.readBoundedSource(oversized)).bytes, null);
    assert.equal(limits.readBoundedSourceSync(oversized).bytes, null);
    limits.MAX_SOURCE_FILE_SIZE_BYTES = 1048576;
    cg = await CG.init(root);
    assert.equal((await cg.indexAll()).success, true);
    assert.equal(cg.queries.getFileByPath('source.py').nodeCount, 0);
    limits.MAX_SOURCE_FILE_SIZE_BYTES = 2097152;
    await cg.sync();
    assert(cg.queries.getFileByPath('source.py').nodeCount > 0);
    assert.equal(cg.queries.getFileByPath('oversized.py').nodeCount, 0);
    const calls = cg.db.getDb().prepare(`SELECT count(*) AS count FROM edges e
      JOIN nodes s ON s.id=e.source JOIN nodes t ON t.id=e.target
      WHERE e.kind='calls' AND s.name='caller' AND t.name='included'`).get();
    assert(calls.count > 0);
    assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
    assert.equal(fs.statSync(source).size, before.size);
  } finally {
    limits.MAX_SOURCE_FILE_SIZE_BYTES = 2097152;
    if (cg) cg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bulk indexing finishes while an independent reader retains its snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-retained-reader-'));
  const state = new Int32Array(new SharedArrayBuffer(4));
  let cg, worker;
  try {
    for (let n = 0; n < 4; n++) fs.writeFileSync(path.join(root, `source${n}.py`),
      Array.from({ length: 50 }, (_, i) => `def function_${n}_${i}(): return ${i}\n`).join(''));
    cg = await CG.init(root);
    const result = await cg.indexAll({ onProgress: progress => {
      if (worker || progress.phase !== 'scanning') return;
      worker = new Worker(`
        const {workerData} = require('node:worker_threads');
        const {DatabaseSync} = require('node:sqlite');
        const state = new Int32Array(workerData.state);
        const db = new DatabaseSync(workerData.path, {readOnly:true});
        db.exec('BEGIN');
        db.prepare('SELECT count(*) FROM nodes').get();
        Atomics.store(state,0,1); Atomics.notify(state,0);
        Atomics.wait(state,0,1,60000);
        db.exec('ROLLBACK'); db.close(); Atomics.store(state,0,3);
      `, { eval: true, workerData: { path: path.join(root, '.codegraph/codegraph.db'), state: state.buffer } });
      Atomics.wait(state, 0, 0, 10000);
      assert.equal(Atomics.load(state, 0), 1);
      assert.equal(cg.db.getJournalMode(), 'wal');
    }});
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.filesIndexed, 4);
    assert.equal(Atomics.load(state, 0), 1);
  } finally {
    Atomics.store(state, 0, 2); Atomics.notify(state, 0);
    if (worker) await worker.terminate();
    if (cg) cg.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
