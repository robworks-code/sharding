import { resolve, relative, isAbsolute } from "node:path";

// NOTE: This module reimplements the containment rule that hooks/logic.mjs
// enforces at runtime. The two must stay in sync - any changes to the rule
// logic here must also be reflected in hooks/logic.mjs PreToolUse enforcement.

// Known limitation (PoC): comparison is lexical (path.resolve normalizes "."/".."
// but does NOT follow symlinks), so a shard containing a symlink into a sibling
// could bypass the read boundary at the filesystem level. Acceptable under this
// PoC's cooperating-agent threat model (guardrails against accidental drift, not
// a hardened sandbox against a malicious shard). Hardening would realpath the
// existing directory portion of the target - note fs.realpathSync throws on a
// not-yet-created write target, so a naive swap breaks write-allow checks.
function isInside(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isReadAllowed(shardDir: string, contractDir: string, target: string): boolean {
  return isInside(shardDir, target) || isInside(contractDir, target);
}

export function isWriteAllowed(shardDir: string, contractDir: string, target: string): boolean {
  return isInside(shardDir, target) && !isInside(contractDir, target);
}
