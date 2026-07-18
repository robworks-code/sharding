import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Field, ShapeType, StructuralSurface } from "../surface/types";
import type { SurfaceAdapter } from "./index";

function toShape(node: any): ShapeType {
  if (node.enum) return { kind: "enum", values: node.enum.map(String) };
  switch (node.type) {
    case "string": case "number": case "boolean": case "null":
      return { kind: "primitive", name: node.type };
    case "integer":
      return { kind: "primitive", name: "number" };
    case "array":
      return { kind: "array", items: toShape(node.items ?? { type: "null" }) };
    case "object": {
      const required: string[] = node.required ?? [];
      const fields: Record<string, Field> = {};
      for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, any>)) {
        fields[k] = { type: toShape(v), required: required.includes(k) };
      }
      return { kind: "object", fields };
    }
    default:
      if (node.$ref) return { kind: "ref", name: String(node.$ref).split("/").pop() ?? "" };
      return { kind: "primitive", name: "null" };
  }
}

export const jsonSchemaAdapter: SurfaceAdapter = {
  name: "jsonschema",
  extract(shardDir: string, slice: string): StructuralSurface {
    const path = join(shardDir, "surface", `${slice}.schema.json`);
    const schema = JSON.parse(readFileSync(path, "utf8"));
    const name = schema.title ?? slice;
    return {
      slice,
      symbols: { [name]: { name, kind: "type", shape: toShape(schema) } },
    };
  },
};
