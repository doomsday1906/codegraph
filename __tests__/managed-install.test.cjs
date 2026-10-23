const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('activation preserves the working release on failed checks and switches only complete releases', async () => {
  const { activate } = await import('../scripts/deploy-local.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-managed-install-'));
  const data = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  try {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    for (const [release, name] of [[first, 'first'], [second, 'second']]) {
      fs.mkdirSync(release);
      fs.writeFileSync(path.join(release, 'node'), `#!/bin/sh\nprintf '${name}\\n'\n`, { mode: 0o755 });
    }
    const read = () => execFileSync(path.join(bin, 'codegraph'), ['--version'], { encoding: 'utf8' }).trim();
    activate(first, data, bin, () => {});
    assert.equal(read(), 'first');
    assert.throws(() => activate(second, data, bin, () => { throw Error('failed regression'); }), /failed regression/);
    assert.equal(read(), 'first');
    activate(second, data, bin, () => assert.equal(read(), 'first'));
    assert.equal(read(), 'second');
    assert(fs.existsSync(first));
    fs.writeFileSync(path.join(bin, 'codegraph'), '#!/bin/sh\necho foreign\n');
    assert.throws(() => activate(first, data, bin, () => {}), /another installation/);
    assert.equal(fs.realpathSync(path.join(data, 'current')), second);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
