import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadManifest } from "../manifest/model";
import { checkPhase, type PhaseCheckResult } from "../check/phaseCheck";
import { checkShard, type ShardCheckResult } from "../check/shardCheck";
import { planPhase, type OrchestrationPlan } from "./plan";

/**
 * The orchestrator: drive one isolated session per shard, wave by wave, then
 * put the whole phase through the existing gate.
 *
 * The design constraint that shapes this file is that the orchestrator must not
 * become a second source of truth. It does not decide whether a shard is
 * finished - `checkShard` does, from what is on disk. A session that exits 0
 * having done nothing produces exactly the same verdict as one that never ran,
 * because the verdict is read from the shard's surface rather than from the
 * process. That is deliberate: it is what stops a cooperative-looking session
 * from talking its way past the gate.
 */

export interface ShardRun {
  shard: string;
  wave: number;
  /** Whether the dispatched session exited successfully. */
  dispatched: boolean;
  exitCode: number | null;
  output: string;
  /** The verdict that actually counts, read from disk after the session ran. */
  check: ShardCheckResult | null;
  error?: string;
}

export interface OrchestrationResult {
  plan: OrchestrationPlan;
  runs: ShardRun[];
  gate: PhaseCheckResult | null;
  /** Set when the gate itself could not run - never a pass. */
  gateError?: string;
  /**
   * Set when dispatch stopped early because a wave left a shard unclean. The
   * waves after this index were never dispatched, so their shards' verdicts
   * describe whatever was already on disk.
   */
  haltedAfterWave?: number;
  passed: boolean;
}

export type Dispatcher = (ctx: {
  shard: string;
  shardDir: string;
  root: string;
}) => Promise<{ exitCode: number | null; output: string }>;

/**
 * Default dispatcher: run a command with its cwd set to the shard directory.
 *
 * `cwd` is the whole isolation story here. Every hook and every read-only
 * command in this project already resolves its role from where the session is,
 * so launching in `shards/<name>/` is what makes the session a shard session -
 * the sandbox is not re-implemented, it is inherited.
 */
export function commandDispatcher(command: string): Dispatcher {
  // A user-supplied string is run through a shell on purpose: it is meant to be
  // written the way it would be typed, pipes and all.
  return ({ shardDir }) => spawnProcess(command, undefined, shardDir);
}

/**
 * Spawn a binary with an explicit argv array and no shell.
 *
 * The preset dispatchers use this rather than `commandDispatcher`, because the
 * arguments they build are generated - a multi-line prompt full of quotes and
 * backticks - and pasting generated text into a shell string is how an argument
 * stops being an argument.
 */
export function spawnDispatcher(
  bin: string,
  args: string[],
  shardDir: string,
): Promise<{ exitCode: number | null; output: string }> {
  return spawnProcess(bin, args, shardDir);
}

function spawnProcess(
  command: string,
  args: string[] | undefined,
  shardDir: string,
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = args
      ? spawn(command, args, { cwd: shardDir, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(command, { cwd: shardDir, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (e) => resolve({ exitCode: null, output: output + String(e.message) }));
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });
}

export interface OrchestrateOptions {
  /** Omit to plan only - compute the waves and run nothing. */
  dispatch?: Dispatcher;
  /** Skip the phase gate (useful when dispatching a subset for inspection). */
  skipGate?: boolean;
  /**
   * Stop dispatching after a wave that left any of its shards unclean.
   *
   * Off by default, because a wave failing does not make the later waves
   * meaningless - the shards are independent, and a run that surfaces every
   * problem at once is usually more useful than one that stops at the first.
   * It is worth turning on when sessions are expensive: a consumer dispatched
   * against a provider that just failed is working from a slice that is not
   * there yet.
   */
  haltOnWaveFailure?: boolean;
}

export async function orchestrate(
  root: string,
  options: OrchestrateOptions = {},
): Promise<OrchestrationResult> {
  const plan = planPhase(root);
  const manifest = loadManifest(root);
  const runs: ShardRun[] = [];
  let haltedAfterWave: number | undefined;

  if (options.dispatch) {
    for (const wave of plan.waves) {
      // Within a wave the shards are independent by construction, so they run
      // concurrently. Waves themselves are sequential - that is the only
      // ordering the plan asserts.
      const results = await Promise.all(
        wave.shards.map(async (shard): Promise<ShardRun> => {
          const shardDir = join(root, manifest.shards[shard].dir);
          try {
            const { exitCode, output } = await options.dispatch!({ shard, shardDir, root });
            return {
              shard,
              wave: wave.index,
              dispatched: exitCode === 0,
              exitCode,
              output,
              // Read the verdict from disk regardless of how the session
              // exited. A failed session may still have left the shard clean,
              // and a successful one may have left it drifted.
              check: safeCheck(root, shard),
            };
          } catch (e: any) {
            return {
              shard,
              wave: wave.index,
              dispatched: false,
              exitCode: null,
              output: "",
              check: safeCheck(root, shard),
              error: String(e?.message ?? e),
            };
          }
        }),
      );
      runs.push(...results);

      // Cleanliness, not exit status: a session that crashed having left the
      // shard conforming is not a reason to abandon the rest of the run, and a
      // session that exited 0 having drifted very much is.
      if (options.haltOnWaveFailure && results.some((r) => r.check?.clean !== true)) {
        haltedAfterWave = wave.index;
        break;
      }
    }
  }

  // The gate must not be able to discard the run. By the time it executes,
  // every session has already been spawned, so letting checkPhase throw would
  // lose all of `runs` and surface as an unhandled rejection with no output -
  // the worst possible outcome, since the expensive part already happened.
  let gate: PhaseCheckResult | null = null;
  let gateError: string | undefined;
  if (!options.skipGate) {
    try {
      gate = checkPhase(root);
    } catch (e: any) {
      gateError = String(e?.message ?? e);
    }
  }
  return { plan, runs, gate, gateError, haltedAfterWave, passed: gate ? gate.passed : false };
}

/**
 * A shard whose surface is unreadable (malformed JSON, a schema the adapter
 * rejects) must not take down the whole orchestration run - the other shards'
 * results are still worth having, and the gate will fail on its own.
 */
function safeCheck(root: string, shard: string): ShardCheckResult | null {
  try {
    return checkShard(root, shard);
  } catch {
    return null;
  }
}
