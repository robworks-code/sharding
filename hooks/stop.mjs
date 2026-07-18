import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const event = JSON.parse(readFileSync(0, "utf8"));
const cwd = event.cwd ?? process.cwd();
const m = cwd.match(/^(.*)\/shards\/([^/]+)(?:\/|$)/);
if (!m) process.exit(0); // only shard sessions are gated on stop
const repoRoot = m[1];
const shard = m[2];
const cli = resolve(process.env.CLAUDE_PLUGIN_ROOT ?? ".", "src", "cli.ts");

try {
  execFileSync("npx", ["tsx", cli, "check", shard], { cwd: repoRoot, encoding: "utf8" });
  process.exit(0); // clean -> allow stop
} catch (e) {
  const report = String(e.stdout ?? "");
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `Shard "${shard}" has drifted from the frozen contract and cannot be declared done. Fix these before finishing:\n${report}`,
  }));
  process.exit(0);
}
