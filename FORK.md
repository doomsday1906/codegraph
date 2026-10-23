# AgentWorkspace CodeGraph

Maintained branch: `agentworkspace` at `doomsday1906/codegraph`.
`upstream` is `colbymchenry/codegraph`; the starting point is release v1.6.2.

The source carries three fixes: a bounded 2 MiB source limit, recovery of old
size-exclusion markers during normal sync, and WAL bulk indexing with retained
readers. `__tests__/source-compatibility.test.cjs` exercises these with real SQLite
and parsing, including the previously unresolved incoming caller.

Deploy a clean, pushed commit with:

```sh
npm run deploy:local -- <full HEAD commit>
```

Deployment builds the complete app, checks the source fixes, stages an independent
runtime below `~/.local/share/codegraph/releases`, and checks the staged runtime
before atomically switching `current`. `~/.local/bin/codegraph` launches that
immutable release. CLI, MCP and lifecycle use this same command. The installed
package records its source path and exact commit. Existing processes and indexes
stay untouched; new processes use the activated version. Previous releases remain
available for rollback.

`codegraph upgrade --check` checks the maintained branch. `codegraph upgrade`
fast-forwards the clean source checkout from `origin/agentworkspace`, then builds,
tests and installs it. `--force` rebuilds the same commit. It never installs a
stock upstream package. Updating the separate global npm package cannot replace
the maintained release or its launcher.

To incorporate an upstream release, fetch `upstream`, merge the desired release
tag into `agentworkspace`, resolve any conflicts while retaining the fixes, run
the affected tests, review the diff, commit and push. Then use `codegraph upgrade`.
A failed fetch, merge, build or regression check leaves the installed release
active. Source changes that fail checks remain available for repair in Git.

Submit the general indexing fixes upstream separately from the workstation's
deployment integration. Once an upstream release includes them, drop our
corresponding changes after verifying the same regressions.
