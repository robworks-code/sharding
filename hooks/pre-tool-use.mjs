import { readFileSync } from "node:fs";
import { decidePreToolUse, detectShard } from "./logic.mjs";

const event = JSON.parse(readFileSync(0, "utf8"));
const cwd = event.cwd ?? process.cwd();
const detected = detectShard(cwd);
if (!detected) { process.exit(0); } // not a shard session: no restriction
const { repoRoot, shardDir } = detected;
const input = event.tool_input ?? {};
const targetPath = input.file_path ?? input.path ?? input.notebook_path ?? null;

const d = decidePreToolUse({ cwd, repoRoot, shardDir, toolName: event.tool_name, targetPath });
if (d.deny) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason },
  }));
}
process.exit(0);
