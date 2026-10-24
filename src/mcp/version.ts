/**
 * Resolved package version, computed once at module load.
 *
 * The runtime identity is the rendezvous datum between cooperating daemon and
 * proxy processes: the daemon advertises its version in the hello line, and
 * the proxy refuses to share IPC across a mismatch (falls back to direct
 * mode). Keeping the resolution in one place avoids drift between the CLI
 * `--version` output (which reads `package.json` directly) and the base package
 * identity. Maintained deployments add their exact source commit for the
 * daemon handshake so two builds of the same upstream version stay distinct.
 *
 * Resolution strategy: read the bundled `package.json` two levels up from
 * this file — same relative position whether we're loaded from `src/mcp/` or
 * the `dist/mcp/` output, since `tsc` preserves the layout. If reading fails
 * (e.g. the package was unpacked oddly), fall back to "0.0.0-unknown" — a
 * sentinel that will never match a real version, so the proxy harmlessly
 * falls back to direct mode.
 */

import * as fs from 'fs';
import * as path from 'path';

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to sentinel.
  }
  return '0.0.0-unknown';
}

export const CodeGraphPackageVersion = readPackageVersion();

/** Exact runtime identity of the package whose `package.json` is at `pkgPath`. */
function runtimeIdentity(pkgPath: string): string {
  const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const revision = parsed.agentworkspace?.revision;
  return typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)
    ? `${parsed.version}+aw.${revision}` : parsed.version;
}

const ownPackage = path.join(__dirname, '..', '..', 'package.json');

/** A maintained build must not attach to a different commit's daemon. */
export const CodeGraphRuntimeIdentity = (() => {
  try {
    return runtimeIdentity(ownPackage);
  } catch { /* Ordinary upstream installations use the package version. */ }
  return CodeGraphPackageVersion;
})();

/** Where a maintained deployment keeps the release its launcher starts (scripts/deploy-local.mjs). */
const deployment: { installed?: unknown; launcher?: unknown } = (() => {
  try { return JSON.parse(fs.readFileSync(ownPackage, 'utf8')).agentworkspace ?? {}; } catch { return {}; }
})();

/** The launcher of a maintained deployment; null for other installations. */
export const InstalledLauncher = typeof deployment.launcher === 'string' ? deployment.launcher : null;

/**
 * Identity of the release the launcher starts now, or null when unknown. A
 * process whose own identity differs is superseded: an upgrade happened while it ran.
 */
export function installedRuntimeIdentity(): string | null {
  if (typeof deployment.installed !== 'string') return null;
  try { return runtimeIdentity(path.join(deployment.installed, 'package.json')); } catch { return null; }
}
