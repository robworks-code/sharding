import { join } from "node:path";
import type { SurfaceAdapter, SurfaceRole } from "./index";

/**
 * The file already IS the canonical IR, so this adapter only locates it and
 * parses JSON. Validation is deliberately not its job - `extractSurface`
 * applies the same check to every adapter, so identity gets no special trust
 * for being a pass-through.
 */
export const identityAdapter: SurfaceAdapter = {
  name: "identity",
  locate(shardDir: string, slice: string, role: SurfaceRole): string {
    return role === "consumed"
      ? join(shardDir, "surface", "consumed", `${slice}.json`)
      : join(shardDir, "surface", `${slice}.json`);
  },
  parse(raw: string): unknown {
    return JSON.parse(raw);
  },
};
