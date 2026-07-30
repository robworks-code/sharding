import { existsSync, readFileSync } from "node:fs";
import type { StructuralSurface } from "../surface/types";
import { validateSurface } from "../surface/validate";
import { dtsAdapter } from "./dts";
import { identityAdapter } from "./identity";
import { jsonSchemaAdapter } from "./jsonschema";
import { openApiAdapter } from "./openapi";
import { protobufAdapter } from "./protobuf";

/**
 * A shard declares two kinds of surface and they are read from different
 * places, but they are the same artifact in the same format - what this shard
 * exposes, versus what it built against. Making the role a parameter rather
 * than a separate code path is what keeps the two sides honest: previously the
 * consume side hardcoded the identity layout, so a `jsonschema` shard wrote
 * `.schema.json` for what it provided and canonical JSON for what it consumed.
 */
export type SurfaceRole = "provided" | "consumed";

export interface SurfaceAdapter {
  name: string;
  /**
   * Where this adapter reads the given slice+role from. Exposed so callers can
   * name the missing file in a finding rather than saying only "not found".
   */
  locate(shardDir: string, slice: string, role: SurfaceRole): string;
  /**
   * Turn the shard's real output into the canonical IR. Implementations return
   * an unvalidated candidate; `extractSurface` below validates it, so no
   * adapter can put a shape the differ cannot trust into circulation.
   */
  parse(raw: string, slice: string, source: string): unknown;
}

const REGISTRY: Record<string, SurfaceAdapter> = {
  dts: dtsAdapter,
  identity: identityAdapter,
  jsonschema: jsonSchemaAdapter,
  openapi: openApiAdapter,
  protobuf: protobufAdapter,
};

export function getAdapter(name: string): SurfaceAdapter {
  const adapter = REGISTRY[name];
  if (!adapter) {
    throw new Error(`unknown adapter: ${name} (available: ${Object.keys(REGISTRY).sort().join(", ")})`);
  }
  return adapter;
}

export function adapterNames(): string[] {
  return Object.keys(REGISTRY).sort();
}

/** True when the shard has actually materialized this slice's surface file. */
export function surfaceExists(
  adapter: SurfaceAdapter,
  shardDir: string,
  slice: string,
  role: SurfaceRole,
): boolean {
  return existsSync(adapter.locate(shardDir, slice, role));
}

/**
 * The single entry point from the checker into any adapter. Every surface the
 * differ ever sees comes through here and is therefore validated IR.
 */
export function extractSurface(
  adapter: SurfaceAdapter,
  shardDir: string,
  slice: string,
  role: SurfaceRole,
): StructuralSurface {
  const source = adapter.locate(shardDir, slice, role);
  const raw = readFileSync(source, "utf8");
  return validateSurface(adapter.parse(raw, slice, source), source, slice);
}
