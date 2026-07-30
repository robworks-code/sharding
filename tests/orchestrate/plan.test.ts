import { describe, expect, it } from "vitest";
import { planPhase } from "../../src/orchestrate/plan";
import { scaffoldGraph } from "./fixture";

describe("planPhase", () => {
  it("puts independent shards in a single wave", () => {
    const root = scaffoldGraph({ a: { provides: ["A"] }, b: { provides: ["B"] } });
    const plan = planPhase(root);
    expect(plan.waves).toEqual([{ index: 0, shards: ["a", "b"] }]);
  });

  it("orders a consumer after the shard providing what it consumes", () => {
    const root = scaffoldGraph({
      gateway: { consumes: ["OrderAPI"] },
      orders: { provides: ["OrderAPI"] },
    });
    const plan = planPhase(root);
    expect(plan.waves).toEqual([
      { index: 0, shards: ["orders"] },
      { index: 1, shards: ["gateway"] },
    ]);
  });

  it("builds a chain of waves for a transitive dependency", () => {
    const root = scaffoldGraph({
      c: { consumes: ["B"] },
      b: { provides: ["B"], consumes: ["A"] },
      a: { provides: ["A"] },
    });
    expect(planPhase(root).waves.map((w) => w.shards)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("schedules a cycle together rather than failing", () => {
    // Two shards consuming each other's slices is legal - they couple through
    // the contract, not through each other - so there is simply no order.
    const root = scaffoldGraph({
      a: { provides: ["A"], consumes: ["B"] },
      b: { provides: ["B"], consumes: ["A"] },
    });
    const plan = planPhase(root);
    expect(plan.cyclic).toEqual(["a", "b"]);
    expect(plan.waves).toEqual([{ index: 0, shards: ["a", "b"] }]);
  });

  it("does not treat a shard's own provided slice as a dependency on itself", () => {
    const root = scaffoldGraph({ a: { provides: ["A"], consumes: ["A"] } });
    const plan = planPhase(root);
    expect(plan.cyclic).toEqual([]);
    expect(plan.waves).toEqual([{ index: 0, shards: ["a"] }]);
  });

  it("reports a consumed slice no participating shard provides", () => {
    const root = scaffoldGraph({ gateway: { consumes: ["OrderAPI"] } });
    const plan = planPhase(root);
    // Not fatal: the slice may come from a shard outside the phase. The gate
    // judges it; the planner only makes it visible.
    expect(plan.unprovided).toEqual([{ shard: "gateway", slice: "OrderAPI" }]);
    expect(plan.waves).toEqual([{ index: 0, shards: ["gateway"] }]);
  });

  it("plans only the shards the phase names", () => {
    const root = scaffoldGraph(
      { a: { provides: ["A"] }, b: { provides: ["B"] }, c: { provides: ["C"] } },
      ["a", "b"],
    );
    const plan = planPhase(root);
    expect(plan.waves.flatMap((w) => w.shards).sort()).toEqual(["a", "b"]);
  });

  it("rejects a phase naming a shard the manifest does not define", () => {
    const root = scaffoldGraph({ a: { provides: ["A"] } }, ["a", "ghost"]);
    expect(() => planPhase(root)).toThrow(/names shard "ghost", which is not in the manifest/);
  });

  it("reports the phase and its frozen contract version", () => {
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const plan = planPhase(root);
    expect(plan.phase).toBe("phase-1");
    expect(plan.contractVersion).toBe("v1");
  });
});
