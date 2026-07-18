import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const cmd = (n: string) => readFileSync(join(root, "commands", `${n}.md`), "utf8");

describe("plugin command surface", () => {
  it("ships all six commands and the skill", () => {
    for (const n of ["shard-init", "shard-contract", "shard-new", "shard-check", "shard-phase-check", "shard-status"]) {
      expect(existsSync(join(root, "commands", `${n}.md`))).toBe(true);
    }
    expect(existsSync(join(root, "skills", "sharding", "SKILL.md"))).toBe(true);
  });
  it("check/status/phase-check commands invoke the matching CLI subcommand", () => {
    expect(cmd("shard-check")).toMatch(/cli\.mjs check/);
    expect(cmd("shard-status")).toMatch(/cli\.mjs status/);
    expect(cmd("shard-phase-check")).toMatch(/cli\.mjs phase-check/);
  });
});
