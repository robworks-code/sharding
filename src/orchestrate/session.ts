import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdapter, type SurfaceRole } from "../adapters/index";
import { loadContract } from "../contract/model";
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
 * What the preset deliberately does NOT do is grant itself trust. The verdict
 * still comes from re-reading the surface off disk after the session exits, and
 * the sandbox is carried into the session rather than assumed (see
 * `resolvePluginRoot`).
 */

/**
 * Where this engine's own plugin directory lives, or `undefined` if it cannot
 * be found.
 *
 * This matters because isolation is not something the orchestrator implements.
 * cwd decides where a session starts; what stops it reaching a sibling shard or
 * writing the frozen contract is the PreToolUse hook in `hooks/logic.mjs`. That
 * hook only runs if Claude Code loaded this plugin - and the engine is
 * documented as usable standalone, so "the plugin happens to be installed" is
 * not something a dispatch may assume. It used to: sessions were spawned with
 * `--permission-mode acceptEdits` and told the boundary was a rule, with
 * nothing enforcing it whenever the plugin was absent.
 *
 * The fix is to stop detecting and start carrying: `--plugin-dir` loads a
 * plugin for one session, so the dispatch hands each session the very hooks
 * that constrain it. Verified against the real binary - the hook process runs
 * and receives the tool payload.
 *
 * Resolution walks UP from this module rather than counting directories,
 * because the depth differs between the shipped bundle (`dist/cli.mjs`, one
 * level down) and the sources under test (`src/orchestrate/session.ts`, two).
 * The predicate is the two files that make a directory this plugin: its
 * manifest, and the hooks the enforcement actually lives in.
 */
export function resolvePluginRoot(from?: string): string | undefined {
  let dir = from ?? dirname(fileURLToPath(import.meta.url));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (
      existsSync(join(dir, ".claude-plugin", "plugin.json")) &&
      existsSync(join(dir, "hooks", "hooks.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Whether a dispatch will carry its own sandbox, and why not when it will not. */
export interface Enforcement {
  enforced: boolean;
  pluginRoot?: string;
  reason?: string;
}

/**
 * Resolve the enforcement a dispatch would run under.
 *
 * Kept separate from the argv so both `orchestrate` (which refuses to dispatch
 * unenforced) and `session-preview` (which reports it) read the same answer,
 * and so a reviewer can see the sandbox status without spawning anything.
 */
export function sessionEnforcement(options: ShardSessionOptions = {}): Enforcement {
  // Reports what IS, not what is permitted. `allowUnenforced` deliberately has
  // no say here: it decides whether an unenforced run may proceed, and folding
  // it in would have made the flag report `enforced: false` and then trip the
  // very refusal it exists to waive. A sandbox that can be loaded is always
  // loaded.
  const override = options.pluginRoot;
  if (override !== undefined) {
    // A typo'd `--session-plugin-dir` must not read as "no plugin found" and
    // get waived by a flag the user passed for an unrelated reason - it is a
    // wrong argument, and it is reported as one.
    return existsSync(join(override, ".claude-plugin", "plugin.json")) &&
      existsSync(join(override, "hooks", "hooks.json"))
      ? { enforced: true, pluginRoot: override }
      : {
          enforced: false,
          reason: `${override} is not a plugin directory (no .claude-plugin/plugin.json and hooks/hooks.json inside it)`,
        };
  }
  const pluginRoot = resolvePluginRoot();
  if (!pluginRoot) {
    return {
      enforced: false,
      reason:
        "could not locate this plugin's directory (expected a .claude-plugin/plugin.json and hooks/hooks.json above the running engine), so the PreToolUse hook that confines a shard session cannot be loaded",
    };
  }
  return { enforced: true, pluginRoot };
}

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
  /**
   * Override the plugin directory handed to each session. Exists so a test can
   * pin resolution instead of depending on where the test runner happens to
   * live; a real run resolves it from the running engine.
   */
  pluginRoot?: string;
  /**
   * Dispatch even though no sandbox will be loaded. Opt-in, because the default
   * permission mode lets a session write, and without the hook nothing stops it
   * writing a sibling shard or the frozen contract.
   */
  allowUnenforced?: boolean;
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
  options: { manifest?: Manifest; task?: string; enforced?: boolean } = {},
): string {
  const manifest = options.manifest ?? loadManifest(root);
  const entry = manifest.shards[shard];
  if (!entry) throw new Error(`unknown shard: ${shard}`);
  const shardDir = join(root, entry.dir);
  // The frozen version is `contract/VERSION`, NOT the manifest's
  // `contractVersion` - that field is only the acknowledgment baseline for
  // shards that have never acked (see shardCheck). `/shard-contract` bumps
  // VERSION without touching the manifest, so using the manifest here told
  // every session the old version at exactly the moment a bump made re-aligning
  // shards the reason to dispatch them.
  const contractVersion = loadContract(root).version;

  const charterPath = join(shardDir, "SHARD.md");
  const charter = existsSync(charterPath)
    ? readFileSync(charterPath, "utf8").trim()
    : "(this shard has no SHARD.md - treat the slices above as the whole charter)";

  return [
    `You are the \`${shard}\` shard in a sharding workspace.`,
    "",
    `The contract is frozen at version ${contractVersion}. You may read it, and you may never write it.`,
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
    // Stated as a rule the session must keep either way, but the sentence about
    // enforcement has to match the run it is describing. Claiming a hook will
    // deny the call is false when none is loaded, and that is exactly the case
    // where the session most needs to treat the boundary as its own
    // responsibility. `--allow-unenforced` is what makes the second form
    // reachable at all.
    options.enforced === false
      ? "- Work only inside this directory. Do not read or write any sibling shard, and do not write the contract. NOTHING IS ENFORCING THIS RUN: no sandbox hook is loaded, so the boundary holds only because you keep it."
      : "- Work only inside this directory. Do not read or write any sibling shard, and do not write the contract. A PreToolUse hook denies these outright; treat the rule as binding regardless.",
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
export function claudeSessionArgs(root: string, options: ShardSessionOptions = {}): string[] {
  const enforcement = sessionEnforcement(options);
  const args = [
    // Load this plugin for the session so the sandbox travels with the
    // dispatch. `--plugin-dir` takes a single `<path>` (it is repeatable via
    // more flags, not variadic), so unlike `--add-dir` it cannot swallow what
    // follows it.
    ...(enforcement.pluginRoot ? ["--plugin-dir", enforcement.pluginRoot] : []),
    // The contract lives above the session's cwd, so it has to be granted
    // explicitly. Granting the contract directory alone, rather than the
    // workspace root, is what keeps sibling shards out of reach.
    //
    // `--add-dir` is variadic (`<directories...>`), so it must never be the
    // last flag before a positional: commander happily reads the next token as
    // a second directory. This is not hypothetical - the prompt used to be
    // passed as a trailing argument, and `--add-dir <dir> <prompt>` swallowed
    // it whole, so every session exited immediately with "Input must be
    // provided either through stdin or as a prompt argument". Keeping a flag
    // directly after it is defence in depth; the prompt going over stdin (see
    // below) is what actually removes the hazard.
    "--add-dir",
    join(root, "contract"),
    "--permission-mode",
    options.permissionMode ?? "acceptEdits",
    "--print",
  ];
  if (options.model) args.push("--model", options.model);
  args.push(...(options.extraArgs ?? []));
  return args;
}

/**
 * A dispatcher that runs one headless Claude Code session per shard.
 *
 * The prompt goes over STDIN, not argv, and that is the whole point of this
 * function's shape. A generated prompt is multi-line free text full of quotes,
 * backticks and `->` arrows; as a trailing positional it is at the mercy of
 * every variadic flag in front of it, and joining it into a shell string turns
 * its arrows into output redirections. Over stdin it is data, and no argument
 * parser or shell can reinterpret it.
 *
 * The argv that remains is passed as an array with no shell for the same
 * reason.
 */
export function claudeSessionDispatcher(options: ShardSessionOptions = {}): Dispatcher {
  const manifests = new Map<string, Manifest>();
  const enforcement = sessionEnforcement(options);
  return async (ctx) => {
    if (!manifests.has(ctx.root)) manifests.set(ctx.root, loadManifest(ctx.root));
    const prompt = buildShardPrompt(ctx.root, ctx.shard, {
      manifest: manifests.get(ctx.root),
      task: options.task,
      enforced: enforcement.enforced,
    });
    return spawnDispatcher(
      options.bin ?? "claude",
      claudeSessionArgs(ctx.root, options),
      ctx.shardDir,
      prompt,
    );
  };
}
