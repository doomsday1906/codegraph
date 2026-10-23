# AgentWorkspace CodeGraph

Maintained branch: `agentworkspace` at `doomsday1906/codegraph`.
`upstream` is `colbymchenry/codegraph`; the starting point is release v1.6.2.

This is Andrew's Linux/WSL source checkout. The installed command is
`~/.local/bin/codegraph`; immutable runtimes live under
`~/.local/share/codegraph/releases`. Do not patch installed JavaScript or use
the global npm package as our update route. The old npm installation may remain
while existing sessions still depend on it; retire it through npm only after
checking that no live processes need its files. Keep project `.codegraph/` data.

The source keeps WAL bulk indexing safe with retained readers, supports a shared
`maxSourceFileSizeBytes` in each project's `codegraph.json`, and recovers old size
exclusions and incoming callers during sync. Our default stays at 2 MiB to preserve
already-indexed large files in existing worktrees; upstream can keep its 1 MiB
default when taking the configurable limit.
AgentWorkspace also commits an explicit 2 MiB project setting.
CLI/MCP status and explore responses expose remaining size exclusions.
`__tests__/source-indexing.test.ts` exercises these through normal `npm test`
and deployment's staged-runtime checks. `source-compatibility.test.cjs` keeps
fork-specific runtime identity, the 2 MiB compatibility default and native-kernel
installation checks.

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

## Commits and contributions

- Keep a commit focused on one change, with an imperative title explaining the
  fix. Commit source and its regression test together. Keep general CodeGraph
  fixes separate from our deployment code and fork/workstation instructions.
- Work on `agentworkspace` for a small owned change; use an owned topic branch
  for concurrent or larger work. Preserve unrelated changes and review every
  changed line before merging into `agentworkspace`. Use normal merges or
  fast-forwards; do not rewrite published history.
- After **every** commit, immediately push the owned branch to `origin` and
  verify that `git ls-remote origin refs/heads/<branch>` contains that commit.
  Pushing a topic branch does not install it. Deployment accepts only a clean,
  pushed `agentworkspace` commit.
- Run the smallest affected tests through the workstation wrapper:
  `python3 /home/andrew/AgentWorkspace/scripts/safe_test.py run -- <command>`.
  Runtime changes must also work through the normal CLI/MCP route. Instruction
  and documentation changes need a diff/command review, not an app rebuild.
- Leave the package version to the upstream release process; deployed fork
  identity is the exact Git commit. Do not publish npm packages or release tags
  as part of an ordinary fix.

## Upstream PRs

1. Check upstream's current contribution guidance and whether the problem is
   already fixed. Fetch `upstream` and create a separate owned branch from its
   current default branch; cherry-pick only the general fixes and tests.
2. Review the complete PR diff. Exclude our installer, local paths, fork
   instructions and unrelated changes. Push the PR branch to `origin`, not
   `upstream`; target `colbymchenry/codegraph` explicitly when creating the PR.
3. Describe the actual failure and resulting behavior, include a small
   reproduction and focused test results, and state what was not checked.
   Use `--body-file` for multiline text with `gh pr create`.
4. Keep our fixes installed while the PR is reviewed or merged. Remove a fork
   fix only after an upstream **release** includes it and the same regressions
   pass on that release. Our local deployment integration can remain separate.
