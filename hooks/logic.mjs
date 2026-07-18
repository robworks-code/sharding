import { resolve, relative, isAbsolute } from "node:path";

function isInside(dir, target) {
  const rel = relative(resolve(dir), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
