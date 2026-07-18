import type { StructuralSurface } from "../surface/types";
import { identityAdapter } from "./identity";
import { jsonSchemaAdapter } from "./jsonschema";

export interface SurfaceAdapter {
  name: string;
  extract(shardDir: string, slice: string): StructuralSurface;
}

const REGISTRY: Record<string, SurfaceAdapter> = {
  identity: identityAdapter,
  jsonschema: jsonSchemaAdapter,
};

export function getAdapter(name: string): SurfaceAdapter {
  const adapter = REGISTRY[name];
  if (!adapter) throw new Error(`unknown adapter: ${name}`);
  return adapter;
}
