import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const cmd = (n: string) => readFileSync(join(root, "commands", `${n}.md`), "utf8");

describe("plugin command surface", () => {
  it("ships every command and the skill", () => {
    for (const n of [
      "shard-init", "shard-contract", "shard-new", "shard-check", "shard-ack",
      "shard-phase-check", "shard-status", "shard-plan", "shard-orchestrate",
    ]) {
      expect(existsSync(join(root, "commands", `${n}.md`))).toBe(true);
    }
    expect(existsSync(join(root, "skills", "sharding", "SKILL.md"))).toBe(true);
  });
  it("commands invoke the matching CLI subcommand", () => {
    expect(cmd("shard-check")).toMatch(/cli\.mjs check/);
    expect(cmd("shard-ack")).toMatch(/cli\.mjs ack/);
    expect(cmd("shard-status")).toMatch(/cli\.mjs status/);
    expect(cmd("shard-phase-check")).toMatch(/cli\.mjs phase-check/);
    expect(cmd("shard-plan")).toMatch(/cli\.mjs plan/);
    expect(cmd("shard-orchestrate")).toMatch(/cli\.mjs orchestrate/);
  });
  it("makes dispatching opt-in and confirmed, since it spawns real processes", () => {
    // The default must not spawn anything, and the command must route approval
    // through `session-preview` - the point being that the user approves the
    // real invocation rather than a description of it.
    const orchestrate = cmd("shard-orchestrate");
    expect(orchestrate).toMatch(/dispatches nothing/i);
    expect(orchestrate).toMatch(/cli\.mjs session-preview/);
    expect(orchestrate).toMatch(/show the user the exact `args`/);
  });

  it("documents the claude session preset it is the blessed entry point for", () => {
    const orchestrate = cmd("shard-orchestrate");
    expect(orchestrate).toMatch(/--session-preset claude/);
    // The two dispatch forms are alternatives; a doc that offers both without
    // saying so invites the combination the CLI rejects.
    expect(orchestrate).toMatch(/alternatives/);
  });

  it("tells the reader what enforces shard isolation, and what happens without it", () => {
    // The engine refuses to dispatch unenforced, and `--allow-unenforced`
    // waives that. A doc naming the escape hatch without its consequence is how
    // a model ends up passing it to get past an error message.
    const orchestrate = cmd("shard-orchestrate");
    expect(orchestrate).toMatch(/--plugin-dir/);
    expect(orchestrate).toMatch(/refuses to dispatch/i);
    expect(orchestrate).toMatch(/--allow-unenforced/);
    expect(orchestrate).toMatch(/Report `enforcement`/);
  });
});
