---
title: MCP Server
description: The tools CodeGraph exposes to AI agents over MCP.
---

CodeGraph runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server. Agents configured by the installer launch it automatically — you don't start it by hand:

```bash
codegraph serve --mcp
```

When a `.codegraph/` index exists, the agent gets the tools below. In a workspace with **no** index of its own, the tools stay available and work per project — pass `projectPath` to any indexed project; a path with no index returns clean guidance to use built-in tools there, and indexing stays your decision.

## Two tools by default: `codegraph_explore` and `codegraph_node`

By default the server exposes **two tools**. `codegraph_explore` answers open questions and flows: give it a natural-language question or a bag of symbol and file names, and it returns the **verbatim, line-numbered source** of the relevant symbols grouped by file — the same shape the `Read` tool gives you — plus the call paths between them (including dynamic-dispatch hops like callbacks, React re-render, and JSX children that grep can't follow) and a blast-radius summary of what depends on them. One call usually answers the whole question.

`codegraph_node` reads what you can already name: one symbol's full body plus its caller/callee trail (for an ambiguous name, the matching overloads' bodies that fit the response cap, with any remainder listed by file:line), or a whole file with line numbers, narrowable with `offset`/`limit` — the same shape the `Read` tool gives you. It returns the same sufficient answer at about half the size of an explore response, so the agent stops probing for a way to read just that symbol.

Keeping the default focused is deliberate. The measured single-strong-tool result still applies: a well-aimed tool steers agents to a direct answer better than a menu of narrower ones — fewer mis-picks — and agents reach for it both when answering questions and while editing code. `codegraph_node` adds the known-symbol read that previously forced an explore dump or a Read, without turning the surface into that menu.

## The other tools

Six more tools exist and stay fully functional, but are **unlisted by default** — everything they return already arrives inline on a `codegraph_explore` response (its blast-radius section, the relationship map, a symbol's body and its callee list):

| Tool | Purpose |
|---|---|
| `codegraph_search` | Find symbols by name across the codebase (locations only) |
| `codegraph_callers` | Find what calls a function |
| `codegraph_callees` | Find what a function calls |
| `codegraph_impact` | Analyze what code is affected by changing a symbol |
| `codegraph_files` | Get the indexed file structure (faster than filesystem scanning) |
| `codegraph_status` | Check index health and statistics |

Re-enable any of them with the `CODEGRAPH_MCP_TOOLS` environment variable — a comma-separated allowlist of short names that replaces the default:

```bash
CODEGRAPH_MCP_TOOLS=explore,node,search,callers
```

Each also has a CLI equivalent (`codegraph node` / `query` / `callers` / `callees` / `impact` / `files` / `status`) for scripts and non-MCP harnesses.

## How agents should use it

CodeGraph *is* the pre-built search index. For "how does X work?", architecture, a flow ("how does X reach Y"), or where-is-X questions — and while editing code — an agent should answer with `codegraph_explore` and stop, typically with **zero file reads**; a symbol or file it can already name goes through `codegraph_node` instead of `Read`. Either way, that replaces re-deriving the answer with `grep` + `Read`: a direct CodeGraph answer is one to a few calls, a grep/read exploration is dozens.

The MCP server delivers this guidance to the main agent automatically, in the MCP `initialize` response. Because subagents and non-MCP harnesses never see that response, the installer also writes a short marker-fenced section into each agent's instructions file pointing at the `codegraph explore` CLI equivalent.
