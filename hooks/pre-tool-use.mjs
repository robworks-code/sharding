import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decidePreToolUse } from "./logic.mjs";

const event = JSON.parse(readFileSync(0, "utf8"));
const cwd = event.cwd ?? process.cwd();
// A shard session is one whose cwd is inside shards/<name>. Derive the shard dir + repo root from cwd.
const m = cwd.match(/^(.*)\/shards\/([^/]+)(?:\/|$)/);
if (!m) { process.exit(0); } // not a shard session: no restriction
const repoRoot = m[1];
const shardDir = resolve(repoRoot, "shards", m[2]);
const input = event.tool_input ?? {};
const targetPath = input.file_path ?? input.path ?? input.notebook_path ?? null;

const d = decidePreToolUse({ cwd, repoRoot, shardDir, toolName: event.tool_name, targetPath });
if (d.deny) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason },
  }));
}
process.exit(0);
