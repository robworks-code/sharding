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
    // The default must not spawn anything, and the command must tell the model
    // to confirm before it does.
    const orchestrate = cmd("shard-orchestrate");
    expect(orchestrate).toMatch(/dispatches nothing/i);
    expect(orchestrate).toMatch(/[Cc]onfirm the exact command with the user/);
  });
});
