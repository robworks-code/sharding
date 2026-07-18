import { describe, it, expect } from "vitest";
import { decidePreToolUse, detectShard } from "../../hooks/logic.mjs";

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

describe("detectShard", () => {
  it("detects a normal shard cwd", () => {
    const d = detectShard("/repo/shards/gateway/src");
    expect(d).toEqual({ repoRoot: "/repo", shard: "gateway", shardDir: "/repo/shards/gateway" });
  });

  it("returns null for a conductor cwd (no /shards/)", () => {
    const d = detectShard("/repo");
    expect(d).toBeNull();
  });

  it("anchors to the FIRST /shards/ segment, not a nested one", () => {
    // Regression test: the greedy regex this replaces would anchor to the LAST /shards/
    // segment, mis-deriving repoRoot/shardDir when a shard's own subtree contains a
    // directory literally named "shards" (e.g. a shard's build output).
    const d = detectShard("/repo/shards/gateway/tools/shards/output");
    expect(d).toEqual({ repoRoot: "/repo", shard: "gateway", shardDir: "/repo/shards/gateway" });
  });
});
