import { describe, it, expect } from "vitest";
import { decidePreToolUse } from "../../hooks/logic.mjs";

const shardCwd = "/repo/shards/gateway";

describe("decidePreToolUse", () => {
  it("denies a Read of a sibling shard", () => {
    const d = decidePreToolUse({
      cwd: shardCwd, repoRoot: "/repo", shardDir: "/repo/shards/gateway",
      toolName: "Read", targetPath: "/repo/shards/orders/secret.ts",
    });
    expect(d.deny).toBe(true);
  });
  it("allows a Read of the contract", () => {
    const d = decidePreToolUse({
      cwd: shardCwd, repoRoot: "/repo", shardDir: "/repo/shards/gateway",
      toolName: "Read", targetPath: "/repo/contract/schemas/order.json",
    });
    expect(d.deny).toBe(false);
  });
  it("denies a Write to the contract", () => {
    const d = decidePreToolUse({
      cwd: shardCwd, repoRoot: "/repo", shardDir: "/repo/shards/gateway",
      toolName: "Write", targetPath: "/repo/contract/schemas/order.json",
    });
    expect(d.deny).toBe(true);
  });
  it("ignores tools with no path", () => {
    const d = decidePreToolUse({
      cwd: shardCwd, repoRoot: "/repo", shardDir: "/repo/shards/gateway",
      toolName: "Bash", targetPath: null,
    });
    expect(d.deny).toBe(false);
  });
});
