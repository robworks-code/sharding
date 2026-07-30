import { join } from "node:path";
import { jsonSchemaToShape } from "../surface/jsonSchemaShape";
import type { SurfaceAdapter, SurfaceRole } from "./index";

export const jsonSchemaAdapter: SurfaceAdapter = {
  name: "jsonschema",
  locate(shardDir: string, slice: string, role: SurfaceRole): string {
    return role === "consumed"
      ? join(shardDir, "surface", "consumed", `${slice}.schema.json`)
      : join(shardDir, "surface", `${slice}.schema.json`);
  },
  parse(raw: string, slice: string): unknown {
    const schema = JSON.parse(raw);
    const name = schema.title ?? slice;
    return { slice, symbols: { [name]: { name, kind: "type", shape: jsonSchemaToShape(schema) } } };
  },
};
