import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuralSurface } from "../surface/types";
import type { SurfaceAdapter } from "./index";

export const identityAdapter: SurfaceAdapter = {
  name: "identity",
  extract(shardDir: string, slice: string): StructuralSurface {
    const path = join(shardDir, "surface", `${slice}.json`);
    return JSON.parse(readFileSync(path, "utf8")) as StructuralSurface;
  },
};
