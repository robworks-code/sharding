import { checkShard } from "./check/shardCheck";
import { status } from "./check/status";
import { checkPhase } from "./check/phaseCheck";
import { loadManifest, shardForDir } from "./manifest/model";
import { loadContract } from "./contract/model";
import { locateShard, writeAck } from "./shard/ack";
import { isReadAllowed, isWriteAllowed } from "./isolation/sandbox";
import { resolveRoot } from "./workspace/root";
import { planPhase } from "./orchestrate/plan";
import { commandDispatcher, orchestrate } from "./orchestrate/run";
import {
  buildShardPrompt,
  claudeSessionArgs,
  claudeSessionDispatcher,
  type ShardSessionOptions,
} from "./orchestrate/session";
import { join } from "node:path";

/**
 * Parse `--key value`, `--key=value`, and bare boolean `--key`.
 *
 * A boolean flag must NOT swallow the next argument: `--skip-gate
 * --session-cmd '<cmd>'` previously parsed to `{"skip-gate": "--session-cmd"}`,
 * silently dropping the session command entirely, so the orchestrator spawned
 * nothing while still reporting a plan. Only one argument order worked.
 */
/** The `--session-*` flags, shared by `orchestrate` and `session-preview`. */
function sessionOptions(f: Record<string, string>): ShardSessionOptions {
  return {
    bin: f["session-bin"],
    model: f["session-model"],
    permissionMode: f["session-permission-mode"],
    task: f["session-task"],
  };
}

function parseArgs(argv: string[]): { flags: Record<string, string>; positionals: string[] } {
  const out: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[arg.slice(2)] = "true";
    } else {
      // Consumed as this flag's value, so it is NOT a positional. Scanning for
      // "the first argument without a leading --" independently of this loop
      // would pick up `opus` from `--session-model opus <shard>`.
      out[arg.slice(2)] = next;
      i++;
    }
  }
  return { flags: out, positionals };
}

function flags(argv: string[]): Record<string, string> {
  return parseArgs(argv).flags;
}

/**
 * `cwd` is where the session actually is; conductor state is read from the
 * workspace that contains it. Commands are therefore position-independent - a
 * shard session can run a read-only check on itself without leaving its
 * directory, which is the only place it is allowed to be.
 */
export function run(argv: string[], cwd: string): { code: number; stdout: string } {
  const [cmd, ...rest] = argv;
  const j = (v: unknown) => JSON.stringify(v, null, 2);
  const root = resolveRoot(cwd);

  switch (cmd) {
    case "check": {
      // No argument means "this shard", derived from where the session is.
      const shard = rest[0] ?? locateShard(cwd)?.shard;
      if (!shard) {
        return {
          code: 1,
          stdout: j({
            checked: false,
            reason: "no shard named and not inside one: pass a shard name, or run from inside a shard",
          }),
        };
      }
      const result = checkShard(root, shard);
      return { code: result.clean ? 0 : 1, stdout: j(result) };
    }
    case "status": {
      const report = status(root);
      return { code: report.blastRadius.length === 0 ? 0 : 1, stdout: j(report) };
    }
    case "ack": {
      // Acknowledgment is the shard's own testimony about a change no shape
      // diff can see, so it is derived from where the session actually is and
      // written into that shard's directory. Nothing conductor-owned is
      // touched; the phase gate still measures the shard for real drift, so a
      // shard cannot launder drift by claiming it looked.
      const loc = locateShard(cwd);
      if (!loc) {
        return {
          code: 1,
          stdout: j({
            acknowledged: false,
            reason: "not inside a shard: a shard acknowledges itself, from its own directory",
          }),
        };
      }
      const version = loadContract(loc.repoRoot).version;
      writeAck(loc.shardDir, version);
      return { code: 0, stdout: j({ shard: loc.shard, acknowledged: true, verifiedAgainst: version }) };
    }
    case "phase-check": {
      const result = checkPhase(root);
      return { code: result.passed ? 0 : 1, stdout: j(result) };
    }
    case "sandbox-check": {
      const f = flags(rest);
      const allowed = f.mode === "write"
        ? isWriteAllowed(f["shard-dir"], f["contract-dir"], f.target)
        : isReadAllowed(f["shard-dir"], f["contract-dir"], f.target);
      return { code: allowed ? 0 : 1, stdout: j({ allowed }) };
    }
    case "orient": {
      const f = flags(rest);
      const manifest = loadManifest(root);
      const shard = shardForDir(manifest, f.dir);
      if (!shard) return { code: 0, stdout: j({ role: "conductor" }) };
      const entry = manifest.shards[shard];
      return { code: 0, stdout: j({ role: "shard", shard, consumes: entry.consumes }) };
    }
    case "plan": {
      const plan = planPhase(root);
      return { code: 0, stdout: j(plan) };
    }
    case "session-preview": {
      // Spawning sessions is the one irreversible thing the engine does, so the
      // exact invocation has to be inspectable before it runs - both for the
      // user to approve and for a reviewer to see what a shard session is told.
      const { flags: f, positionals } = parseArgs(rest);
      const manifest = loadManifest(root);
      const named = positionals[0];
      const shards = named ? [named] : planPhase(root).waves.flatMap((w) => w.shards);
      const unknown = shards.find((s) => !manifest.shards[s]);
      if (unknown) return { code: 2, stdout: j({ error: `unknown shard: ${unknown}` }) };

      const options = sessionOptions(f);
      return {
        code: 0,
        stdout: j({
          bin: options.bin ?? "claude",
          sessions: shards.map((shard) => {
            const prompt = buildShardPrompt(root, shard, { manifest, task: options.task });
            return {
              shard,
              cwd: join(root, manifest.shards[shard].dir),
              args: claudeSessionArgs(prompt, root, options),
              prompt,
            };
          }),
        }),
      };
    }
    default:
      return { code: 2, stdout: j({ error: `unknown command: ${cmd}` }) };
  }
}

/**
 * Async dispatch layered over `run`.
 *
 * Only orchestration needs to be asynchronous - it drives real child processes
 * concurrently. Every other command stays synchronous and independently
 * testable, so adding the orchestrator did not make the rest of the CLI
 * await-shaped for no reason.
 */
export async function runAsync(argv: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const [cmd, ...rest] = argv;
  if (cmd !== "orchestrate") return run(argv, cwd);

  const j = (v: unknown) => JSON.stringify(v, null, 2);
  const root = resolveRoot(cwd);
  const f = flags(rest);

  // Without --session-cmd or --session-preset the orchestrator plans and gates
  // but dispatches nothing. That is the honest default: spawning sessions is
  // the one irreversible thing here, so it happens only when explicitly asked
  // for.
  const preset = f["session-preset"];
  if (preset && f["session-cmd"]) {
    return {
      code: 2,
      stdout: j({ error: "--session-cmd and --session-preset are alternatives; pass one" }),
    };
  }
  if (preset && preset !== "claude") {
    return { code: 2, stdout: j({ error: `unknown session preset: ${preset} (known: claude)` }) };
  }

  let dispatch;
  if (preset) dispatch = claudeSessionDispatcher(sessionOptions(f));
  else if (f["session-cmd"]) dispatch = commandDispatcher(f["session-cmd"]);

  const result = await orchestrate(root, {
    dispatch,
    skipGate: "skip-gate" in f,
    haltOnWaveFailure: "halt-on-wave-failure" in f,
  });
  return { code: result.passed ? 0 : 1, stdout: j(result) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { code, stdout } = await runAsync(process.argv.slice(2), process.cwd());
  process.stdout.write(stdout + "\n");
  process.exit(code);
}
