#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, cwd = source, env = process.env) =>
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const dataRoot = path.join(os.homedir(), '.local/share/codegraph');
const binRoot = path.join(os.homedir(), '.local/bin');

export function activate(release, data, bin, check) {
  check();
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const current = path.join(data, 'current');
  const launcher = path.join(bin, 'codegraph');
  const script = `#!/bin/sh\nCG_RELEASE=$(readlink -f ${quote(current)}) || exit 1\nexec "$CG_RELEASE/node" --liftoff-only "$CG_RELEASE/lib/dist/bin/codegraph.js" "$@"\n`;
  if (fs.existsSync(launcher) && fs.readFileSync(launcher, 'utf8') !== script)
    throw new Error(`Refusing to overwrite another installation at ${launcher}`);
  if (fs.existsSync(current) && !fs.lstatSync(current).isSymbolicLink())
    throw new Error(`Expected a release symlink at ${current}`);
  const next = current + `.next-${process.pid}`;
  const nextLauncher = launcher + `.next-${process.pid}`;
  try {
    fs.symlinkSync(release, next);
    fs.writeFileSync(nextLauncher, script, { mode: 0o755, flag: 'wx' });
    fs.renameSync(nextLauncher, launcher);
    fs.renameSync(next, current);
  } finally {
    fs.rmSync(next, { force: true });
    fs.rmSync(nextLauncher, { force: true });
  }
}

function main(args) {
  if (git('status', '--porcelain')) throw new Error('Source checkout must be clean before deployment.');
  if (git('branch', '--show-current') !== 'agentworkspace')
    throw new Error('Deploy from the maintained agentworkspace branch.');
  let revision = git('rev-parse', 'HEAD');
  if (args.includes('--update')) {
    run('git', ['fetch', 'origin', 'agentworkspace']);
    const available = git('rev-parse', 'refs/remotes/origin/agentworkspace');
    const installed = fs.existsSync(path.join(dataRoot, 'current/lib/package.json'))
      ? JSON.parse(fs.readFileSync(path.join(dataRoot, 'current/lib/package.json'))).agentworkspace.revision : null;
    console.log(`Installed ${installed || 'none'}; maintained fork ${available}`);
    if (args.includes('--check')) return;
    run('git', ['merge', '--ff-only', 'origin/agentworkspace']);
    revision = git('rev-parse', 'HEAD');
    if (revision === installed && !args.includes('--force')) {
      console.log('Maintained CodeGraph is already up to date.');
      return;
    }
  } else if (args.length !== 1 || args[0] !== revision) {
    throw new Error('Usage: npm run deploy:local -- <exact HEAD commit>');
  }
  if (git('rev-parse', 'origin/agentworkspace') !== revision)
    throw new Error('Push the exact source revision before deploying it.');
  run('npm', ['ci', '--no-audit', '--no-fund']);
  run('npm', ['run', 'build:kernel'], source, { ...process.env, CARGO_BUILD_JOBS: '2' });
  run('npm', ['run', 'build']);
  run(process.execPath, ['--liftoff-only', '--test', '__tests__/source-compatibility.test.cjs']);
  const sourceChecks = ['--liftoff-only', 'node_modules/vitest/vitest.mjs', 'run',
    '__tests__/source-indexing.test.ts', '__tests__/query-pool.test.ts', '__tests__/kernel-wide-comments.test.ts',
    '--project', 'engine', '--maxWorkers', '1', '--minWorkers', '1', '--testTimeout', '60000'];
  run(process.execPath, sourceChecks);
  const release = path.join(dataRoot, 'releases', revision + '-' + Date.now());
  const lib = path.join(release, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.cpSync(path.join(source, 'dist'), path.join(lib, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(lib, 'kernel'));
  fs.copyFileSync(path.join(source, 'codegraph-kernel/prebuilds', `${process.platform}-${process.arch}`, 'codegraph-kernel.node'),
    path.join(lib, 'kernel/codegraph-kernel.node'));
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  metadata.agentworkspace = { root: source, revision };
  fs.writeFileSync(path.join(lib, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json')));
  fs.writeFileSync(path.join(lib, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], lib);
  fs.copyFileSync(process.execPath, path.join(release, 'node'));
  fs.chmodSync(path.join(release, 'node'), 0o755);
  activate(release, dataRoot, binRoot, () => {
    run(path.join(release, 'node'), ['--liftoff-only', '--test', '__tests__/source-compatibility.test.cjs'], source,
      { ...process.env, CODEGRAPH_TEST_DIST: path.join(lib, 'dist'), CODEGRAPH_TELEMETRY: '0' });
    run(path.join(release, 'node'), sourceChecks, source,
      { ...process.env, CODEGRAPH_TEST_DIST: path.join(lib, 'dist'), CODEGRAPH_TELEMETRY: '0' });
    run(path.join(release, 'node'), [path.join(lib, 'dist/bin/codegraph.js'), '--version']);
    const upgrade = execFileSync(path.join(release, 'node'),
      [path.join(lib, 'dist/bin/codegraph.js'), 'upgrade', '--check'],
      { cwd: source, encoding: 'utf8', timeout: 60000 });
    if (!upgrade.includes(`AgentWorkspace CodeGraph ${revision}`) || !upgrade.includes('maintained fork'))
      throw new Error('Staged update command did not use the maintained fork.');
    if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== revision)
      throw new Error('Source changed during deployment; installed version preserved.');
  });
  console.log(`Installed maintained CodeGraph ${revision}\n${path.join(binRoot, 'codegraph')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
