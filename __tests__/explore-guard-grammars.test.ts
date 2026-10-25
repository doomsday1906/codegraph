import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../src/index';
import * as sourceTools from '../src/mcp/tools';
import * as sourceGuards from '../src/graph/branch-guards';
import * as sourceGrammars from '../src/extraction/grammars';

const runtime = process.env.CODEGRAPH_TEST_DIST;
const { ToolHandler }: typeof sourceTools = runtime ? require(path.join(runtime, 'mcp/tools.js')) : sourceTools;
const guards: typeof sourceGuards = runtime ? require(path.join(runtime, 'graph/branch-guards.js')) : sourceGuards;
const { getParser }: typeof sourceGrammars = runtime ? require(path.join(runtime, 'extraction/grammars.js')) : sourceGrammars;

let dir: string | undefined;
let cg: CodeGraph | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  cg?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

it('loads only rendered flow callers, keeping guards when the next query changes language', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-explore-grammars-'));
  fs.writeFileSync(path.join(dir, 'app.py'),
    'def py_leaf():\n    return 1\n' +
    'def py_middle(ready):\n    if ready:\n        return py_leaf()\n' +
    'def py_entry(enabled):\n    if enabled:\n        return py_middle(True)\n');
  fs.writeFileSync(path.join(dir, 'app.ts'),
    'export function tsLeaf() { return 2 }\n' +
    'export function tsMiddle(ready: boolean) { if (ready) return tsLeaf() }\n' +
    'export function tsEntry(enabled: boolean) { if (enabled) return tsMiddle(true) }\n');
  cg = CodeGraph.initSync(dir);
  await cg.indexAll();
  const warm = vi.spyOn(guards, 'warmBranchGuardGrammars');
  const handler = new ToolHandler(cg);
  try {
    await handler.execute('codegraph_explore', { query: 'py_leaf' });
    expect(warm).not.toHaveBeenCalled();
    for (const [query, language] of [
      ['py_entry py_middle py_leaf', 'python'],
      ['tsEntry tsMiddle tsLeaf', 'typescript'],
    ]) {
      warm.mockClear();
      const result = await handler.execute('codegraph_explore', { query });
      const text = result.content?.map((item) => item.text ?? '').join('\n') ?? '';
      expect(text).toContain('**Flow (call path among the symbols you queried)**');
      expect(text).toContain('(when enabled)');
      expect(text).toContain('(when ready)');
      expect(warm.mock.calls).toEqual([[[language, language]]]);
      expect(getParser('swift')).toBeNull();
    }
  } finally {
    handler.closeAll();
  }
}, 30_000);
