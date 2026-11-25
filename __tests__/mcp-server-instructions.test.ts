/**
 * Default MCP guidance (issue #529) must match the two-tool default surface:
 * codegraph_explore for open/discovery/multi-symbol/flow questions, and
 * codegraph_node for a symbol or file the agent can already name. node's
 * `includeCode` defaults to false, so symbol-mode guidance must ask for it —
 * otherwise an agent following the text gets locations without the body.
 *
 * Both initialize variants are checked: the full playbook (indexed root) and
 * the per-project variant (no root index). The text stays prose-free here:
 * these assertions pin routing and tool names, not exact wording.
 */
import { describe, it, expect } from 'vitest';
import {
  SERVER_INSTRUCTIONS,
  SERVER_INSTRUCTIONS_NO_ROOT_INDEX,
} from '../src/mcp/server-instructions';

const VARIANTS: Array<[string, string]> = [
  ['SERVER_INSTRUCTIONS', SERVER_INSTRUCTIONS],
  ['SERVER_INSTRUCTIONS_NO_ROOT_INDEX', SERVER_INSTRUCTIONS_NO_ROOT_INDEX],
];

/** Tools that stay defined but are NOT listed by default (see DEFAULT_MCP_TOOLS). */
const UNLISTED_TOOLS = [
  'codegraph_search',
  'codegraph_callers',
  'codegraph_callees',
  'codegraph_impact',
  'codegraph_files',
  'codegraph_status',
];

describe.each(VARIANTS)('%s', (_name, text) => {
  it('names the two default tools and no unlisted tool', () => {
    expect(text).toContain('codegraph_explore');
    expect(text).toContain('codegraph_node');
    for (const tool of UNLISTED_TOOLS) expect(text).not.toContain(tool);
  });

  it('routes a known symbol or file to codegraph_node', () => {
    expect(text).toMatch(/codegraph_node[\s\S]{0,240}\bsymbol\b/i);
    expect(text).toMatch(/codegraph_node[\s\S]{0,240}\bfile\b/i);
  });

  it('tells symbol mode to pass includeCode: true for the body', () => {
    // node's includeCode defaults to false, so a bare symbol call returns only
    // locations. Guidance that promises the body must name the flag.
    expect(text).toMatch(/includeCode\s*:\s*true/);
  });

  it('routes open/discovery/multi-symbol/flow questions to codegraph_explore', () => {
    expect(text).toMatch(
      /codegraph_explore[\s\S]{0,240}\b(open question|flow|relevant symbols|call paths?)\b/i
    );
  });

  it('stays tight', () => {
    // The agent reads this every session — guard against growth into a manual.
    expect(text.length).toBeLessThan(9000);
  });
});
