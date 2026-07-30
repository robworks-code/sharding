import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Shared workspace builder for the orchestrator tests.
 *
 * Deliberately a plain module and not an export from a `.test.ts` file:
 * importing a test file to borrow a helper re-executes its `describe` blocks in
 * the importing file, which silently double-counts every one of its tests.
 */

interface ShardSpec {
  provides?: string[];
  consumes?: string[];
}

/**
 * Build a workspace whose graph is exactly the given shards. Surfaces are
 * written to match the contract so the planner is measured on graph shape
 * alone, not on drift.
 */
export function scaffoldGraph(shards: Record<string, ShardSpec>, phaseShards?: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "shard-plan-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");

  const slices = new Set<string>();
  for (const spec of Object.values(shards)) {
    for (const s of [...(spec.provides ?? []), ...(spec.consumes ?? [])]) slices.add(s);
  }
  const surfaceFor = (slice: string) => ({
    slice,
    symbols: { [slice]: { name: slice, kind: "type", shape: { kind: "object", fields: {} } } },
  });
  for (const slice of slices) {
    writeFileSync(join(root, "contract", "schemas", `${slice}.json`), JSON.stringify(surfaceFor(slice)));
  }

  let manifest = "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n";
  for (const [name, spec] of Object.entries(shards)) {
    mkdirSync(join(root, "shards", name, "surface", "consumed"), { recursive: true });
    for (const slice of spec.provides ?? []) {
      writeFileSync(join(root, "shards", name, "surface", `${slice}.json`), JSON.stringify(surfaceFor(slice)));
    }
    for (const slice of spec.consumes ?? []) {
      writeFileSync(
        join(root, "shards", name, "surface", "consumed", `${slice}.json`),
        JSON.stringify(surfaceFor(slice)),
      );
    }
    manifest +=
      `  ${name}:\n    dir: shards/${name}\n    adapter: identity\n` +
      `    provides: [${(spec.provides ?? []).join(", ")}]\n` +
      `    consumes: [${(spec.consumes ?? []).join(", ")}]\n`;
  }
  writeFileSync(join(root, ".sharding", "manifest.yaml"), manifest);
  writeFileSync(
    join(root, "contract", "phases.yaml"),
    `phases:\n  - id: phase-1\n    contractVersion: v1\n    shards: [${(phaseShards ?? Object.keys(shards)).join(", ")}]\n`,
  );
  return root;
}
