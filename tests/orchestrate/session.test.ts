import { afterAll, describe, it, expect } from "vitest";
import { chmodSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { buildShardPrompt, claudeSessionArgs, claudeSessionDispatcher } from "../../src/orchestrate/session";
import { orchestrate } from "../../src/orchestrate/run";
import { run, runAsync } from "../../src/cli";
import { scaffoldGraph } from "./fixture";

/**
 * A throwaway copy of the multi-adapter example.
 *
 * Nothing here may point the engine at `examples/multistack` in the repo. These
 * tests SPAWN PROCESSES with cwd set to a shard directory, and a dispatcher bug
 * - or a mutation introduced while testing one - then writes into tracked
 * files. That is not hypothetical: mutating the dispatcher to join its argv
 * into a shell string made the prompt's `Cart -> surface/Cart.d.ts` lines parse
 * as output redirections, and it truncated every surface file it named.
 */
function multistack(): string {
  const dst = mkdtempSync(join(tmpdir(), "session-ws-"));
  cpSync(join(__dirname, "..", "..", "examples", "multistack"), dst, { recursive: true });
  return dst;
}

/** A shared read-only copy for the tests that never write to it. */
const MULTISTACK = multistack();
afterAll(() => rmSync(MULTISTACK, { recursive: true, force: true }));

/** Every shard surface file in the workspace, keyed by path, as raw bytes. */
function surfaceBytes(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(relative(root, full), readFileSync(full, "utf8"));
    }
  };
  for (const shard of readdirSync(join(root, "shards"))) {
    walk(join(root, "shards", shard, "surface"));
  }
  return out;
}

/**
 * A stand-in for the `claude` binary that records the argv it was handed.
 *
 * Nothing in this file may spawn the real thing: a test that launches a model
 * session is neither hermetic nor free, and the behaviour under test is the
 * invocation, which the stub captures exactly.
 */
interface Invocation {
  argv: string[];
  stdin: string;
}

function argvRecorder(): { bin: string; readCalls: () => Invocation[]; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "stub-claude-"));
  const log = join(dir, "calls.jsonl");
  const bin = join(dir, "claude-stub");
  writeFileSync(
    bin,
    // Reads stdin to EOF, which is also what a real \`--print\` session does -
    // so a dispatcher that forgets to close the pipe hangs this stub too,
    // rather than passing and hanging only in production.
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n");
  process.exit(0);
});
`,
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    readCalls: () =>
      readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("buildShardPrompt", () => {
  it("names each slice with the path the shard's own adapter reads", () => {
    // The prompt is generated from the manifest and the adapter, never from a
    // hardcoded layout - a dts shard must be told about `.d.ts` files.
    const prompt = buildShardPrompt(MULTISTACK, "checkout");
    expect(prompt).toContain("Cart -> surface/Cart.d.ts");
    expect(prompt).toContain("Product -> surface/consumed/Product.d.ts");
    expect(prompt).toContain("Your surface adapter is `dts`");
    expect(prompt).toContain("The contract is frozen at version v1");
  });

  it("uses the right extension per adapter, not the identity layout", () => {
    expect(buildShardPrompt(MULTISTACK, "telemetry")).toContain(
      "PurchaseEvent -> surface/PurchaseEvent.proto",
    );
    expect(buildShardPrompt(MULTISTACK, "pricing")).toContain("Price -> surface/Price.schema.json");
    expect(buildShardPrompt(MULTISTACK, "storefront")).toContain(
      "StorefrontAPI -> surface/StorefrontAPI.openapi.yaml",
    );
  });

  it("inlines the shard's charter", () => {
    expect(buildShardPrompt(MULTISTACK, "catalog")).toContain(
      "Owns the product catalog and the shared money type",
    );
  });

  it("says so rather than lying when a shard has no SHARD.md", () => {
    const root = scaffoldGraph({ alpha: { provides: ["A"] } });
    const prompt = buildShardPrompt(root, "alpha");
    expect(prompt).toContain("no SHARD.md");
    expect(prompt).toContain("A -> surface/A.json");
  });

  it("reports a shard with nothing to consume as (none)", () => {
    expect(buildShardPrompt(MULTISTACK, "catalog")).toMatch(
      /must have a snapshot of the shape you built against:\n {2}\(none\)/,
    );
  });

  it("appends the phase task when one is given", () => {
    expect(buildShardPrompt(MULTISTACK, "catalog", { task: "Add a stock count." })).toContain(
      "Your task for this phase:\nAdd a stock count.",
    );
    expect(buildShardPrompt(MULTISTACK, "catalog")).not.toContain("Your task for this phase");
  });

  it("rejects a shard that is not in the manifest", () => {
    expect(() => buildShardPrompt(MULTISTACK, "nope")).toThrow(/unknown shard: nope/);
  });

  it("reports the frozen contract version, not the manifest's ack baseline", () => {
    // `/shard-contract` bumps contract/VERSION and leaves the manifest's
    // contractVersion alone - that field is only the baseline for shards that
    // have never acked. Reading it here told every session the OLD version at
    // exactly the moment a bump made re-aligning shards the reason to dispatch.
    const root = multistack();
    try {
      writeFileSync(join(root, "contract", "VERSION"), "v2\n");
      const prompt = buildShardPrompt(root, "catalog");
      expect(prompt).toContain("frozen at version v2");
      expect(prompt).not.toContain("frozen at version v1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * Flags the installed Claude Code CLI declares as variadic (`<x...>`). A
 * variadic flag keeps consuming tokens until the next `--flag`, so anything
 * that follows one and is not itself a flag gets eaten.
 */
const VARIADIC = ["--add-dir", "--mcp-config", "--plugin-dir", "--plugin-url", "--file", "--betas"];

describe("claudeSessionArgs", () => {
  it("runs headless and grants the contract directory", () => {
    const args = claudeSessionArgs("/ws");
    expect(args).toContain("--print");
    // Without this the session starts in shards/<name>/ and cannot read the
    // contract it is being measured against.
    expect(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2)).toEqual([
      "--add-dir",
      join("/ws", "contract"),
    ]);
  });

  it("passes no positional argument at all", () => {
    // The guard for the bug that made the whole preset a no-op. The prompt used
    // to be a trailing positional; `--add-dir` is variadic, so commander read
    // it as a second directory and every session exited with "Input must be
    // provided either through stdin or as a prompt argument". Reproduced
    // against the real binary. With the prompt on stdin there is no positional
    // left for any flag to swallow, and this asserts that structurally.
    for (const options of [{}, { model: "opus" }, { extraArgs: ["--verbose"] }]) {
      const args = claudeSessionArgs("/ws", options);
      const positionals = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
      expect(positionals).toEqual([]);
    }
  });

  it("never leaves a variadic flag's value at the end of the argv", () => {
    // Defence in depth behind the rule above: even a value that legitimately
    // follows a variadic flag must be followed by another flag, or a future
    // trailing argument would silently join it.
    for (const options of [{}, { model: "opus" }, { extraArgs: ["--verbose"] }]) {
      const args = claudeSessionArgs("/ws", options);
      for (const flag of VARIADIC) {
        const i = args.indexOf(flag);
        if (i === -1) continue;
        const after = args.slice(i + 1).findIndex((a) => a.startsWith("--"));
        expect(after, `${flag} is not followed by another flag in ${JSON.stringify(args)}`).toBeGreaterThan(-1);
      }
    }
  });

  it("grants the contract directory only, not the workspace root", () => {
    // Granting the root would hand the session every sibling shard.
    expect(claudeSessionArgs("/ws")).not.toContain("/ws");
  });

  it("defaults to acceptEdits and honors an override", () => {
    expect(claudeSessionArgs("/ws")).toContain("acceptEdits");
    expect(claudeSessionArgs("/ws", { permissionMode: "bypassPermissions" })).toContain(
      "bypassPermissions",
    );
    expect(claudeSessionArgs("/ws", { permissionMode: "bypassPermissions" })).not.toContain(
      "acceptEdits",
    );
  });

  it("passes a model and extra args through", () => {
    const args = claudeSessionArgs("/ws", { model: "opus", extraArgs: ["--verbose"] });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
    expect(args).toContain("--verbose");
  });
});

describe("claudeSessionDispatcher", () => {
  it("delivers each shard's prompt over stdin, intact", async () => {
    // The prompt is generated multi-line text containing backticks, quotes and
    // `->` arrows. On stdin it is data: no argument parser and no shell can
    // reinterpret it, which is what both prior bugs here came down to.
    const root = multistack();
    const stub = argvRecorder();
    try {
      const result = await orchestrate(root, {
        dispatch: claudeSessionDispatcher({ bin: stub.bin }),
        skipGate: true,
      });
      expect(result.runs).toHaveLength(5);

      const calls = stub.readCalls();
      expect(calls).toHaveLength(5);
      for (const { argv, stdin } of calls) {
        expect(argv).not.toContain(stdin);
        expect(stdin).toContain("You are the `");
        expect(stdin).toContain("\n");
        expect(stdin).toContain("Working rules:");
      }
      // One distinct prompt per shard, not the same one five times.
      expect(new Set(calls.map((c) => c.stdin))).toHaveProperty("size", 5);
    } finally {
      stub.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the workspace untouched when the session writes nothing", async () => {
    // The consequence assertion behind the one above. The prompt is full of
    // `Cart -> surface/Cart.d.ts` lines, and `>` is a shell redirect: run the
    // argv through a shell and the session truncates the very surface files it
    // was being told about, from inside the shard directory. Asserting the
    // bytes survive catches that where an argv assertion only implies it.
    const root = multistack();
    const before = surfaceBytes(root);
    expect(before.size).toBeGreaterThan(0);
    const stub = argvRecorder();
    try {
      await orchestrate(root, {
        dispatch: claudeSessionDispatcher({ bin: stub.bin }),
        skipGate: true,
      });
      expect(surfaceBytes(root)).toEqual(before);
    } finally {
      stub.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs each session with cwd set to its own shard", async () => {
    const root = multistack();
    const dir = mkdtempSync(join(tmpdir(), "stub-cwd-"));
    const log = join(dir, "cwd.jsonl");
    const bin = join(dir, "claude-stub");
    writeFileSync(
      bin,
      `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(log)}, process.cwd() + "\\n");
`,
    );
    chmodSync(bin, 0o755);
    try {
      await orchestrate(root, {
        dispatch: claudeSessionDispatcher({ bin }),
        skipGate: true,
      });
      const cwds = readFileSync(log, "utf8").trim().split("\n").sort();
      expect(cwds.map((c) => c.split("/").pop())).toEqual([
        "catalog",
        "checkout",
        "pricing",
        "storefront",
        "telemetry",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("haltOnWaveFailure", () => {
  function graphWithBrokenProvider() {
    // beta consumes what alpha provides, so they land in separate waves.
    const root = scaffoldGraph({ alpha: { provides: ["A"] }, beta: { consumes: ["A"] } });
    return root;
  }

  it("stops dispatching after a wave that left a shard unclean", async () => {
    const root = graphWithBrokenProvider();
    const dispatched: string[] = [];
    const result = await orchestrate(root, {
      haltOnWaveFailure: true,
      skipGate: true,
      dispatch: async ({ shard, shardDir }) => {
        dispatched.push(shard);
        // alpha drifts: it deletes the surface it is supposed to provide.
        if (shard === "alpha") rmSync(join(shardDir, "surface", "A.json"));
        return { exitCode: 0, output: "" };
      },
    });

    expect(dispatched).toEqual(["alpha"]);
    expect(result.haltedAfterWave).toBe(0);
    expect(result.runs.map((r) => r.shard)).toEqual(["alpha"]);
    // A shard that never ran has no ShardRun at all, so it has to be named
    // somewhere or a reader has to subtract `runs` from `plan` to find it.
    expect(result.skipped).toEqual(["beta"]);
  });

  it("reports a first-wave halt as index 0, which must not be read as falsy", async () => {
    // `haltedAfterWave === 0` is the most common halt. Anything testing it for
    // truthiness silently reports the run as having completed.
    const root = graphWithBrokenProvider();
    const result = await orchestrate(root, {
      haltOnWaveFailure: true,
      skipGate: true,
      dispatch: async ({ shard, shardDir }) => {
        if (shard === "alpha") rmSync(join(shardDir, "surface", "A.json"));
        return { exitCode: 0, output: "" };
      },
    });
    expect(result.haltedAfterWave).toBe(0);
    expect("haltedAfterWave" in result).toBe(true);
  });

  it("keeps going by default, so one bad wave does not hide the rest", async () => {
    const root = graphWithBrokenProvider();
    const dispatched: string[] = [];
    const result = await orchestrate(root, {
      skipGate: true,
      dispatch: async ({ shard, shardDir }) => {
        dispatched.push(shard);
        if (shard === "alpha") rmSync(join(shardDir, "surface", "A.json"));
        return { exitCode: 0, output: "" };
      },
    });

    expect(dispatched.sort()).toEqual(["alpha", "beta"]);
    expect(result.haltedAfterWave).toBeUndefined();
    expect(result.skipped).toBeUndefined();
  });

  it("halts on drift, not on exit status", async () => {
    // A session that crashed but left the shard conforming is not a reason to
    // abandon the run - the verdict is the surface on disk, as everywhere else.
    const root = graphWithBrokenProvider();
    const dispatched: string[] = [];
    const result = await orchestrate(root, {
      haltOnWaveFailure: true,
      skipGate: true,
      dispatch: async ({ shard }) => {
        dispatched.push(shard);
        return { exitCode: 1, output: "boom" };
      },
    });

    expect(dispatched.sort()).toEqual(["alpha", "beta"]);
    expect(result.haltedAfterWave).toBeUndefined();
    expect(result.runs.every((r) => r.dispatched === false)).toBe(true);
    expect(result.runs.every((r) => r.check?.clean === true)).toBe(true);
  });
});

describe("cli session wiring", () => {
  it("refuses --session-cmd and --session-preset together", async () => {
    const { code, stdout } = await runAsync(
      ["orchestrate", "--session-cmd", "true", "--session-preset", "claude"],
      MULTISTACK,
    );
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toMatch(/alternatives/);
  });

  it("rejects an unknown preset by name", async () => {
    const { code, stdout } = await runAsync(["orchestrate", "--session-preset", "codex"], MULTISTACK);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toMatch(/unknown session preset: codex/);
  });

  it("actually dispatches through --session-preset claude", async () => {
    // Every other test in this file builds the dispatcher by hand, so the CLI
    // could stop wiring the preset up entirely and they would all still pass -
    // a fully tested, completely disconnected feature. This one goes through
    // the real command and requires the binary to have been invoked.
    const root = multistack();
    const stub = argvRecorder();
    try {
      const { stdout } = await runAsync(
        ["orchestrate", "--session-preset", "claude", "--session-bin", stub.bin, "--skip-gate"],
        root,
      );
      expect(JSON.parse(stdout).runs).toHaveLength(5);
      const calls = stub.readCalls();
      expect(calls).toHaveLength(5);
      expect(calls[0].argv).toContain("--print");
      expect(calls[0].stdin).toContain("You are the `");
    } finally {
      stub.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("dispatches nothing when neither --session-cmd nor --session-preset is given", async () => {
    const root = multistack();
    try {
      const { stdout } = await runAsync(["orchestrate", "--skip-gate"], root);
      expect(JSON.parse(stdout).runs).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("previews every shard in the phase without spawning anything", () => {
    const { code, stdout } = run(["session-preview"], MULTISTACK);
    expect(code).toBe(0);
    const preview = JSON.parse(stdout);
    expect(preview.bin).toBe("claude");
    // The prompt is not an argument any more, and the preview must not imply
    // it is - the user approves what will actually run.
    expect(preview.promptDelivery).toBe("stdin");
    expect(preview.args).toContain("--print");
    expect(preview.sessions.map((s: any) => s.shard).sort()).toEqual([
      "catalog",
      "checkout",
      "pricing",
      "storefront",
      "telemetry",
    ]);
  });

  it("does not mistake a flag's value for the shard name", () => {
    // `--session-model opus checkout` must preview `checkout`, not `opus`.
    const { code, stdout } = run(
      ["session-preview", "--session-model", "opus", "checkout"],
      MULTISTACK,
    );
    expect(code).toBe(0);
    const preview = JSON.parse(stdout);
    expect(preview.sessions).toHaveLength(1);
    expect(preview.sessions[0].shard).toBe("checkout");
    expect(preview.args).toContain("opus");
  });

  it("rejects a session flag written without a value", () => {
    // `--session-model` alone parses to the literal "true", which would spawn
    // `claude --model true` once per shard and surface only as N dead sessions.
    const { code, stdout } = run(["session-preview", "--session-model"], MULTISTACK);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toMatch(/--session-model needs a value/);
  });

  it("rejects a permission mode the binary does not accept", () => {
    const { code, stdout } = run(
      ["session-preview", "--session-permission-mode", "yolo"],
      MULTISTACK,
    );
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toMatch(/unknown permission mode: yolo/);
    expect(run(["session-preview", "--session-permission-mode", "bypassPermissions"], MULTISTACK).code).toBe(0);
  });

  it("names an unknown shard instead of previewing nothing", () => {
    const { code, stdout } = run(["session-preview", "ghost"], MULTISTACK);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toMatch(/unknown shard: ghost/);
  });
});
