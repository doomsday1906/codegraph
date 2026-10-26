/**
 * readGrammarWasmBytes + bytes-based grammar loading (#1231, Phase 2.1).
 *
 * The orchestrator pre-reads each needed grammar's WASM once on the main
 * thread and hands the bytes to every parse worker, so a worker respawn loads
 * grammars from memory instead of re-reading them from a (possibly slow) disk.
 * These tests pin that the byte reader resolves the same artifacts the loader
 * would, and that web-tree-sitter genuinely accepts the bytes.
 */
import { describe, it, expect } from 'vitest';
import { Parser, Language as WasmLanguage } from 'web-tree-sitter';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { readGrammarWasmBytes } from '../src/extraction/grammars';

describe('readGrammarWasmBytes', () => {
  it('reads bytes for a tree-sitter-wasms grammar and a vendored grammar', async () => {
    const bytes = await readGrammarWasmBytes(['typescript', 'lua']);
    expect(bytes.typescript).toBeInstanceOf(Uint8Array); // from tree-sitter-wasms
    expect(bytes.typescript.byteLength).toBeGreaterThan(10_000);
    expect(bytes.lua).toBeInstanceOf(Uint8Array); // vendored under src/extraction/wasm/
    expect(bytes.lua.byteLength).toBeGreaterThan(10_000);
  });

  it('expands delegating languages to the grammars they need (svelte → ts/js)', async () => {
    const bytes = await readGrammarWasmBytes(['svelte']);
    expect(Object.keys(bytes).sort()).toEqual(['javascript', 'typescript']);
  });

  it('omits languages without a WASM grammar instead of failing', async () => {
    const bytes = await readGrammarWasmBytes(['yaml', 'unknown']);
    expect(Object.keys(bytes)).toEqual([]);
  });

  it('produces bytes web-tree-sitter can load into a working parser', async () => {
    await Parser.init();
    const bytes = await readGrammarWasmBytes(['javascript']);
    const language = await WasmLanguage.load(bytes.javascript);
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse('function hello() { return 1; }');
    expect(tree!.rootNode.hasError).toBe(false);
    expect(tree!.rootNode.toString()).toContain('function_declaration');
  });
});

const workerDist = process.env.CODEGRAPH_TEST_DIST ?? path.resolve(__dirname, '../dist');
// E2E: only the real worker can prove readiness does not eagerly compile grammars.
it.skipIf(!fs.existsSync(path.join(workerDist, 'extraction/parse-worker.js')))(
  'loads only the current fallback language, including delegated component grammars', async () => {
    const dist = workerDist;
    const worker = new Worker(`
      const { parentPort } = require('worker_threads');
      const grammars = require(${JSON.stringify(path.join(dist, 'extraction/grammars.js'))});
      const post = parentPort.postMessage.bind(parentPort);
      parentPort.postMessage = message => post({ ...message,
        loaded: ['python', 'typescript', 'javascript', 'cpp', 'csharp'].filter(grammars.isGrammarLoaded) });
      require(${JSON.stringify(path.join(dist, 'extraction/parse-worker.js'))});
    `, { eval: true, env: { ...process.env, CODEGRAPH_KERNEL: '0' } });
    const exchange = (type: string, message: object) => new Promise<any>((resolve, reject) => {
      const onError = (error: Error) => { worker.off('message', onMessage); reject(error); };
      const onMessage = (reply: any) => {
        if (reply.type !== type) return;
        worker.off('error', onError);
        worker.off('message', onMessage);
        resolve(reply);
      };
      worker.once('error', onError);
      worker.on('message', onMessage);
      worker.postMessage(message);
    });
    try {
      const grammarBuffers = await readGrammarWasmBytes(['python', 'vue', 'cpp', 'csharp']);
      const ready = await exchange('grammars-loaded', {
        type: 'load-grammars', languages: ['python', 'vue', 'cpp', 'csharp'], grammarBuffers,
      });
      expect(ready.loaded).toEqual([]);
      const python = await exchange('parse-result', {
        type: 'parse', id: 1, filePath: 'hello.py', language: 'python', content: 'def hello():\n    return 1\n',
      });
      expect(python.loaded).toEqual(['python']);
      expect(python.result.errors).toEqual([]);
      expect(python.result.nodes.some((node: any) => node.name === 'hello')).toBe(true);
      const vue = await exchange('parse-result', {
        type: 'parse', id: 2, filePath: 'hello.vue', language: 'vue',
        content: '<script lang="ts">export function greeting(): string { return "hi"; }</script>',
      });
      expect(vue.loaded).toEqual(['python', 'typescript', 'javascript']);
      expect(vue.result.errors).toEqual([]);
      expect(vue.result.nodes.some((node: any) => node.name === 'greeting')).toBe(true);
    } finally {
      await worker.terminate();
    }
  }, 10_000);
