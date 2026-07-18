import { resolve, relative, isAbsolute } from "node:path";

function isInside(dir, target) {
  const rel = relative(resolve(dir), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// A shard session is one whose cwd is inside shards/<name>. Derive the shard dir + repo root from cwd.
// Anchored to the FIRST /shards/ segment (non-greedy) so a nested "shards" dir inside a shard's own
// subtree (e.g. /repo/shards/gateway/tools/shards/output) doesn't get mistaken for the repo boundary.
export function detectShard(cwd) {
  const m = cwd.match(/^(.*?)\/shards\/([^/]+)(?:\/|$)/);
  if (!m) return null;
  const repoRoot = m[1];
  const shard = m[2];
  const shardDir = resolve(repoRoot, "shards", shard);
  return { repoRoot, shardDir, shard };
}

// { cwd, repoRoot, shardDir, toolName, targetPath } -> { deny: boolean, reason?: string }
export function decidePreToolUse(ctx) {
  const contractDir = resolve(ctx.repoRoot, "contract");
  if (!ctx.targetPath) return { deny: false };
  const target = resolve(ctx.targetPath);
  const isWrite = ["Write", "Edit", "NotebookEdit"].includes(ctx.toolName);
  if (isWrite) {
    if (isInside(contractDir, target)) return { deny: true, reason: "shards may not write the contract; change it from the conductor with /shard-contract" };
    if (!isInside(ctx.shardDir, target)) return { deny: true, reason: `writes are limited to this shard (${ctx.shardDir})` };
    return { deny: false };
  }
  if (ctx.toolName === "Read") {
    if (isInside(ctx.shardDir, target) || isInside(contractDir, target)) return { deny: false };
    return { deny: true, reason: "this shard may read only its own directory and the read-only contract/" };
  }
  return { deny: false };
}
