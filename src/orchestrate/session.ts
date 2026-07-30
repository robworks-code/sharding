import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getAdapter, type SurfaceRole } from "../adapters/index";
import { loadManifest, type Manifest } from "../manifest/model";
import { spawnDispatcher, type Dispatcher } from "./run";

/**
 * The blessed way to launch a real Claude Code session per shard.
 *
 * `commandDispatcher` will run anything, which is right for a mechanism but
 * leaves the interesting part to the user: the most likely hand-written attempt
 * is a plain interactive `claude`, which blocks its wave forever and defeats
 * the concurrency the planner just computed. So the preset here is opinionated
 * about the three things that actually decide whether an unattended run works:
 *
 * 1. `--print`, so the session terminates instead of waiting for a human.
 * 2. `--add-dir <root>/contract`, because a shard session starts in
 *    `shards/<name>/` and the contract it must read is outside that directory.
 *    Without this the session cannot see the thing it is being measured against.
 * 3. A prompt built from the shard's own charter and manifest entry, so the
 *    session knows which slices it owns and where its surface files belong.
 *
 * What the preset deliberately does NOT do is grant itself trust. Isolation
 * still comes from cwd plus the plugin's PreToolUse hook, and the verdict still
 * comes from re-reading the surface off disk after the session exits.
 */

export interface ShardSessionOptions {
  /** The Claude Code binary. Overridable so a test never spawns the real one. */
  bin?: string;
  model?: string;
  /**
   * Defaults to `acceptEdits`: a shard session's whole job is editing its own
   * directory, and the sandbox that matters is enforced by the PreToolUse hook
   * rather than by the permission mode. `bypassPermissions` runs with no
   * prompting at all - it is the genuinely unattended setting, and it is opt-in
   * on purpose.
   */
  permissionMode?: string;
  /** Appended to the generated prompt - the phase's actual instruction. */
  task?: string;
  /** Passed through to the binary verbatim, after the generated flags. */
  extraArgs?: string[];
}

function surfacePathFor(
  adapterName: string,
  shardDir: string,
  slice: string,
  role: SurfaceRole,
): string {
  try {
    return relative(shardDir, getAdapter(adapterName).locate(shardDir, slice, role));
  } catch {
    // An adapter the registry does not know is a manifest error that the check
    // will report properly. The prompt should still be usable, so name the
    // slice without inventing a path for it.
    return "(unknown adapter - see the manifest)";
  }
}

function sliceLines(
  adapterName: string,
  shardDir: string,
  slices: string[],
  role: SurfaceRole,
): string {
  if (slices.length === 0) return "  (none)";
  return slices
    .map((slice) => `  - ${slice} -> ${surfacePathFor(adapterName, shardDir, slice, role)}`)
    .join("\n");
}

/**
 * Build the prompt a shard session starts from.
 *
 * Everything in it is read from the workspace rather than written by hand: the
 * charter is the shard's own `SHARD.md`, the slices and adapter come from the
 * manifest, and the surface paths come from the adapter itself. A prompt that
 * restated any of that from memory would be one more place for the truth to
 * drift away from the manifest.
 */
export function buildShardPrompt(
  root: string,
  shard: string,
  options: { manifest?: Manifest; task?: string } = {},
): string {
  const manifest = options.manifest ?? loadManifest(root);
  const entry = manifest.shards[shard];
  if (!entry) throw new Error(`unknown shard: ${shard}`);
  const shardDir = join(root, entry.dir);

  const charterPath = join(shardDir, "SHARD.md");
  const charter = existsSync(charterPath)
    ? readFileSync(charterPath, "utf8").trim()
    : "(this shard has no SHARD.md - treat the slices above as the whole charter)";

  return [
    `You are the \`${shard}\` shard in a sharding workspace.`,
    "",
    `The contract is frozen at version ${manifest.contractVersion}. You may read it, and you may never write it.`,
    `Your surface adapter is \`${entry.adapter}\`.`,
    "",
    "You PROVIDE these contract slices. Each one must be declared in your own surface:",
    sliceLines(entry.adapter, shardDir, entry.provides, "provided"),
    "",
    "You CONSUME these contract slices. Each one must have a snapshot of the shape you built against:",
    sliceLines(entry.adapter, shardDir, entry.consumes, "consumed"),
    "",
    "Your charter, from SHARD.md:",
    "---",
    charter,
    "---",
    "",
    "Working rules:",
    "- Work only inside this directory. Do not read or write any sibling shard, and do not write the contract. A PreToolUse hook enforces this and will deny the call.",
    "- Your DECLARED surface is what the gate measures. Implementation with no matching surface file reads as drift, and so does a surface file with nothing behind it.",
    "- Check yourself at any point with the `/sharding:shard-check` command.",
    "- Your exit code is not the verdict. The conductor re-reads your surface from disk after you stop, so finishing early with a drifted surface fails the phase just the same.",
    ...(options.task ? ["", "Your task for this phase:", options.task] : []),
    "",
  ].join("\n");
}

/**
 * The argv for one shard session. Kept separate from the dispatcher so a test -
 * and `/shard-orchestrate`, when it shows the user what it is about to run -
 * can inspect the exact invocation without spawning anything.
 */
export function claudeSessionArgs(prompt: string, root: string, options: ShardSessionOptions = {}): string[] {
  const args = [
    "--print",
    "--permission-mode",
    options.permissionMode ?? "acceptEdits",
    // The contract lives above the session's cwd, so it has to be granted
    // explicitly. Granting the contract directory alone, rather than the
    // workspace root, is what keeps sibling shards out of reach.
    "--add-dir",
    join(root, "contract"),
  ];
  if (options.model) args.push("--model", options.model);
  args.push(...(options.extraArgs ?? []));
  args.push(prompt);
  return args;
}

/**
 * A dispatcher that runs one headless Claude Code session per shard.
 *
 * Note the argv is passed as an array with no shell: a generated prompt is
 * multi-line free text containing quotes and backticks, and interpolating that
 * into a shell string is how a prompt turns into a command.
 */
export function claudeSessionDispatcher(options: ShardSessionOptions = {}): Dispatcher {
  const manifests = new Map<string, Manifest>();
  return async (ctx) => {
    if (!manifests.has(ctx.root)) manifests.set(ctx.root, loadManifest(ctx.root));
    const prompt = buildShardPrompt(ctx.root, ctx.shard, {
      manifest: manifests.get(ctx.root),
      task: options.task,
    });
    return spawnDispatcher(
      options.bin ?? "claude",
      claudeSessionArgs(prompt, ctx.root, options),
      ctx.shardDir,
    );
  };
}
