/**
 * CODEGRAPH_MCP_TOOLS allowlist — lets an operator (or an A/B harness) trim the
 * exposed MCP tool surface without touching the client config. Inert when unset.
 * Filtering happens in the static pre-project surface (getStaticTools), in
 * ListTools (getTools), and is enforced again on execute().
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ToolHandler, getStaticTools } from '../src/mcp/tools';

const ENV = 'CODEGRAPH_MCP_TOOLS';
const DEFAULT_SURFACE = ['codegraph_explore', 'codegraph_node'];

describe('CODEGRAPH_MCP_TOOLS allowlist', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  const listed = () => new ToolHandler(null).getTools().map(t => t.name).sort();
  const staticListed = () => getStaticTools().map(t => t.name).sort();

  it('exposes exactly codegraph_explore and codegraph_node by default when unset', () => {
    delete process.env[ENV];
    // The default set (see DEFAULT_MCP_TOOLS) is explore + node: explore for
    // open questions/flows, node for a symbol or file the agent can already
    // name. The other tools stay defined and executable but unlisted;
    // CODEGRAPH_MCP_TOOLS re-enables them. Both surfaces must agree — the
    // static one answers tools/list before any project is open.
    expect(listed()).toEqual(DEFAULT_SURFACE);
    expect(staticListed()).toEqual(DEFAULT_SURFACE);
  });

  it('replaces the default entirely: explore alone', () => {
    process.env[ENV] = 'explore';
    expect(listed()).toEqual(['codegraph_explore']);
    expect(staticListed()).toEqual(['codegraph_explore']);
  });

  it('replaces the default entirely: node alone', () => {
    process.env[ENV] = 'node';
    expect(listed()).toEqual(['codegraph_node']);
    expect(staticListed()).toEqual(['codegraph_node']);
  });

  it('re-enables an unlisted tool via the allowlist (impact)', () => {
    process.env[ENV] = 'explore,impact';
    expect(listed()).toEqual(['codegraph_explore', 'codegraph_impact']);
    expect(staticListed()).toEqual(['codegraph_explore', 'codegraph_impact']);
  });

  it('filters ListTools to the allowlisted short names', () => {
    process.env[ENV] = 'explore,search,node';
    expect(listed()).toEqual(['codegraph_explore', 'codegraph_node', 'codegraph_search']);
    expect(staticListed()).toEqual(['codegraph_explore', 'codegraph_node', 'codegraph_search']);
  });

  it('accepts fully-qualified codegraph_ names and ignores whitespace', () => {
    process.env[ENV] = ' codegraph_explore , search ';
    expect(listed()).toEqual(['codegraph_explore', 'codegraph_search']);
    expect(staticListed()).toEqual(['codegraph_explore', 'codegraph_search']);
  });

  it('treats an empty/whitespace value as unset (default surface)', () => {
    process.env[ENV] = '   ';
    expect(listed()).toEqual(DEFAULT_SURFACE);
    expect(staticListed()).toEqual(DEFAULT_SURFACE);
  });

  it('rejects a disabled tool on execute (defense in depth)', async () => {
    process.env[ENV] = 'node';
    const res = await new ToolHandler(null).execute('codegraph_explore', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/disabled via CODEGRAPH_MCP_TOOLS/);
  });

  it('lets an allowlisted tool past the guard', async () => {
    process.env[ENV] = 'search';
    // No CodeGraph attached, so it fails *after* the allowlist guard — the
    // "disabled" message must NOT appear, proving the guard passed it through.
    const res = await new ToolHandler(null).execute('codegraph_search', { query: 'x' });
    expect(res.content[0].text).not.toMatch(/disabled via CODEGRAPH_MCP_TOOLS/);
  });
});

/**
 * getStaticTools() answers tools/list before any project opens (the proxy
 * path). It must mirror getTools()'s default and allowlist behavior — a drift
 * here lists the wrong surface to every agent that connects pre-init.
 */
describe('getStaticTools default and allowlist parity', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  const staticListed = () => getStaticTools().map(t => t.name).sort();
  const liveListed = () => new ToolHandler(null).getTools().map(t => t.name).sort();

  it('defaults to explore+node when unset, matching the live surface', () => {
    delete process.env[ENV];
    expect(staticListed()).toEqual(DEFAULT_SURFACE);
    expect(staticListed()).toEqual(liveListed());
  });

  it('replaces the default with a custom list, matching the live surface', () => {
    process.env[ENV] = 'explore,node,search,callers';
    const expected = [
      'codegraph_callers',
      'codegraph_explore',
      'codegraph_node',
      'codegraph_search',
    ];
    expect(staticListed()).toEqual(expected);
    expect(staticListed()).toEqual(liveListed());
  });
});
