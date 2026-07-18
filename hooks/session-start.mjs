import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const event = JSON.parse(readFileSync(0, "utf8"));
const cwd = event.cwd ?? process.cwd();
const m = cwd.match(/^(.*)\/shards\/([^/]+)(?:\/|$)/);
const repoRoot = m ? m[1] : cwd;
const relDir = m ? `shards/${m[2]}` : ".";
const cli = resolve(process.env.CLAUDE_PLUGIN_ROOT ?? ".", "src", "cli.ts");

let context;
try {
  const out = execFileSync("npx", ["tsx", cli, "orient", "--dir", relDir], { cwd: repoRoot, encoding: "utf8" });
  const info = JSON.parse(out);
  context = info.role === "shard"
    ? `You are working in shard "${info.shard}". You may read ONLY this shard's directory and the read-only contract/. You couple to other shards solely through contract/ (consumed slices: ${(info.consumes ?? []).join(", ") || "none"}). Run /shard-check before claiming done.`
    : `You are in the conductor workspace. Use /shard-contract to change the frozen contract, /shard-status for the graph, and /shard-phase-check to gate a phase.`;
} catch {
  context = "Sharding plugin active. Run /shard-status to see the shard graph.";
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
