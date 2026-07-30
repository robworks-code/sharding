import { describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orchestrate, type Dispatcher } from "../../src/orchestrate/run";
import { runAsync } from "../../src/cli";
import { scaffoldGraph } from "./fixture";

const noopDispatch: Dispatcher = async () => ({ exitCode: 0, output: "" });

describe("orchestrate", () => {
  it("dispatches nothing when no dispatcher is given", async () => {
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const result = await orchestrate(root);
    expect(result.runs).toEqual([]);
    expect(result.plan.waves).toEqual([{ index: 0, shards: ["a"] }]);
  });

  it("dispatches every shard, in its wave, with cwd set to the shard dir", async () => {
    const root = scaffoldGraph({
      gateway: { consumes: ["OrderAPI"] },
      orders: { provides: ["OrderAPI"] },
    });
    const seen: Array<{ shard: string; shardDir: string }> = [];
    const result = await orchestrate(root, {
      dispatch: async ({ shard, shardDir }) => {
        seen.push({ shard, shardDir });
        return { exitCode: 0, output: `${shard} ok` };
      },
    });

    expect(seen.map((s) => s.shard)).toEqual(["orders", "gateway"]);
    // cwd is the whole isolation story: launching here is what makes the
    // session a shard session.
    expect(seen[0].shardDir).toBe(join(root, "shards", "orders"));
    expect(result.runs.map((r) => [r.shard, r.wave])).toEqual([
      ["orders", 0],
      ["gateway", 1],
    ]);
  });

  it("runs the shards within a wave concurrently", async () => {
    const root = scaffoldGraph({ a: { provides: ["A"] }, b: { provides: ["B"] } });
    let inFlight = 0;
    let peak = 0;
    await orchestrate(root, {
      dispatch: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return { exitCode: 0, output: "" };
      },
    });
    expect(peak).toBe(2);
  });

  it("does not let a successful session exit stand in for a clean shard", async () => {
    // The point of the whole mechanism: the verdict is read from disk, so a
    // session that exits 0 having drifted is still reported as drifted.
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    rmSync(join(root, "shards", "a", "surface", "A.json"));

    const result = await orchestrate(root, { dispatch: noopDispatch });
    const run = result.runs[0];
    expect(run.dispatched).toBe(true);
    expect(run.exitCode).toBe(0);
    expect(run.check?.clean).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("still reports the on-disk verdict when a session fails", async () => {
    // The mirror of the case above: a session can fail and still have left the
    // shard in a perfectly clean state.
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const result = await orchestrate(root, {
      dispatch: async () => ({ exitCode: 1, output: "crashed" }),
    });
    expect(result.runs[0].dispatched).toBe(false);
    expect(result.runs[0].output).toBe("crashed");
    expect(result.runs[0].check?.clean).toBe(true);
  });

  it("survives a dispatcher that throws, and still checks the shard", async () => {
    const root = scaffoldGraph({ a: { provides: ["A"] }, b: { provides: ["B"] } });
    const result = await orchestrate(root, {
      dispatch: async ({ shard }) => {
        if (shard === "a") throw new Error("spawn failed");
        return { exitCode: 0, output: "" };
      },
    });
    const a = result.runs.find((r) => r.shard === "a")!;
    expect(a.error).toMatch(/spawn failed/);
    expect(a.check?.clean).toBe(true);
    // The other shard in the wave is unaffected.
    expect(result.runs.find((r) => r.shard === "b")!.dispatched).toBe(true);
  });

  it("reports an unreadable surface as a finding, and still runs the gate", async () => {
    // Regression: this test used to pass `skipGate: true`, which hid that
    // checkPhase threw on the same unreadable file - rejecting the whole
    // orchestration AFTER every session had been spawned, losing every run.
    const root = scaffoldGraph({ a: { provides: ["A"] }, b: { provides: ["B"] } });
    writeFileSync(join(root, "shards", "a", "surface", "A.json"), "{ not json");

    const result = await orchestrate(root, { dispatch: noopDispatch });

    const a = result.runs.find((r) => r.shard === "a")!;
    expect(a.check?.clean).toBe(false);
    expect(a.check?.findings[0].kind).toBe("invalid-surface");
    // The rest of the run is still worth having, and the gate still ran.
    expect(result.runs.find((r) => r.shard === "b")!.check?.clean).toBe(true);
    expect(result.gate).not.toBeNull();
    expect(result.passed).toBe(false);
  });

  it("never loses the runs when the gate itself cannot run", async () => {
    // The sessions are the expensive, already-completed part. A gate that
    // cannot execute must be reported, not thrown past.
    // The failure has to land between planning and gating, so the dispatcher
    // itself pulls the contract out from under the run - which is also a real
    // scenario: the conductor amending the contract while a wave is in flight.
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const result = await orchestrate(root, {
      dispatch: async () => {
        rmSync(join(root, "contract", "VERSION"));
        return { exitCode: 0, output: "" };
      },
    });
    expect(result.runs).toHaveLength(1);
    expect(result.gate).toBeNull();
    expect(result.gateError).toBeTruthy();
    expect(result.passed).toBe(false);
  });

  it("runs the phase gate and passes when everything is clean and acknowledged", async () => {
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const result = await orchestrate(root, { dispatch: noopDispatch });
    expect(result.gate?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("skips the gate when asked, and then never claims to have passed", async () => {
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const result = await orchestrate(root, { dispatch: noopDispatch, skipGate: true });
    expect(result.gate).toBeNull();
    // No gate run means no basis for a pass, so the honest answer is false.
    expect(result.passed).toBe(false);
  });
});

describe("orchestrate CLI flags", () => {
  it("honors --session-cmd regardless of where --skip-gate sits", async () => {
    // `--skip-gate --session-cmd '<cmd>'` used to parse as
    // {"skip-gate": "--session-cmd"} - the session command vanished, so the
    // orchestrator spawned nothing while still reporting a plan and exiting 1.
    // Only the reverse order worked, and both are documented together.
    for (const argv of [
      ["orchestrate", "--skip-gate", "--session-cmd", "echo dispatched"],
      ["orchestrate", "--session-cmd", "echo dispatched", "--skip-gate"],
      ["orchestrate", "--session-cmd=echo dispatched", "--skip-gate"],
    ]) {
      const root = scaffoldGraph({ a: { provides: ["A"] } });
      const out = JSON.parse((await runAsync(argv, root)).stdout);
      expect(out.runs).toHaveLength(1);
      expect(out.runs[0].output.trim()).toBe("dispatched");
      expect(out.gate).toBeNull();
    }
  });

  it("dispatches nothing when no session command is given", async () => {
    const root = scaffoldGraph({ a: { provides: ["A"] } });
    const out = JSON.parse((await runAsync(["orchestrate"], root)).stdout);
    expect(out.runs).toEqual([]);
  });
});
