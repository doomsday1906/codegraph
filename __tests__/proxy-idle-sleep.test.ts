import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const MODULE = path.resolve(__dirname, '../dist/mcp/proxy.js');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await delay(25);
  }
}

describe.skipIf(process.platform === 'win32')('idle proxy sleep', () => {
  it('sleeps as a shell in the same pid, then resumes the session on the next call', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-sleep-'));
    const sock = path.join(dir, 'd.sock');
    // Fake daemon: hello, then answer every request; record what each connection received.
    const connections: string[][] = [];
    const server = net.createServer((s) => {
      const seen: string[] = [];
      connections.push(seen);
      s.write(JSON.stringify({ codegraph: 'test', pid: process.pid, socketPath: sock, protocol: 1 }) + '\n');
      let buf = '';
      s.on('data', (d) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf('\n')) !== -1) {
          const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
          if (msg.method === undefined) continue; // client hello
          seen.push(msg.method);
          if (msg.id !== undefined) s.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { from: connections.length } }) + '\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(sock, resolve));

    const child = spawn(process.execPath, ['-e', `
      const { runLocalHandshakeProxy, connectWithHello } = require(${JSON.stringify(MODULE)});
      runLocalHandshakeProxy({
        root: process.cwd(),
        getDaemonSocket: () => connectWithHello(${JSON.stringify(sock)}, 'test', { installed: null }),
        makeEngine: () => { throw new Error('in-process engine must not start'); },
      });
    `], {
      env: {
        ...process.env, CODEGRAPH_TELEMETRY: '0', DO_NOT_TRACK: '1', CODEGRAPH_NO_WATCHDOG: '1',
        CODEGRAPH_PPID_POLL_MS: '0', CODEGRAPH_MCP_IDLE_SLEEP_MS: '300',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const lines = () => stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const send = (msg: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    const cmdline = () => fs.readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').split('\0')[0];
    try {
      send({ id: 1, method: 'initialize', params: {} });
      send({ id: 2, method: 'tools/call', params: { name: 'x', arguments: {} } });
      await until(() => lines().some((m) => m.id === 2));

      // Idle: the daemon connection drops and the same pid becomes a shell.
      await until(() => child.exitCode !== null || (connections.length === 1 && cmdline() === 'sh'));
      expect(child.exitCode, stderr).toBeNull();
      expect(child.exitCode).toBeNull();

      send({ id: 3, method: 'tools/call', params: { name: 'x', arguments: {} } });
      await until(() => lines().some((m) => m.id === 3));
      expect(lines().find((m) => m.id === 3).result.from, stderr).toBe(2);
      // The new daemon session is primed with the host's initialize, whose reply is not repeated.
      expect(connections[1]).toEqual(['initialize', 'tools/call']);
      expect(lines().filter((m) => m.id === 1)).toHaveLength(1);

      child.stdin.end();
      await until(() => child.exitCode !== null || child.signalCode !== null);
    } finally {
      child.kill('SIGKILL');
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
