import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuralSurface } from "../surface/types";
import type { SurfaceAdapter } from "./index";

function surfacePath(shardDir: string, slice: string): string {
  return join(shardDir, "surface", `${slice}.json`);
}

export const identityAdapter: SurfaceAdapter = {
  name: "identity",
  exists(shardDir: string, slice: string): boolean {
    return existsSync(surfacePath(shardDir, slice));
  },
  extract(shardDir: string, slice: string): StructuralSurface {
    return JSON.parse(readFileSync(surfacePath(shardDir, slice), "utf8")) as StructuralSurface;
  },
};
