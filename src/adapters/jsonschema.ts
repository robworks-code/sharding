import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Field, ShapeType, StructuralSurface } from "../surface/types";
import type { SurfaceAdapter } from "./index";

function schemaPath(shardDir: string, slice: string): string {
  return join(shardDir, "surface", `${slice}.schema.json`);
}

function toShape(node: any): ShapeType {
  if (node.enum) return { kind: "enum", values: node.enum.map(String) };
  // A node with `properties` is an object even when it omits an explicit
  // "type": "object" (valid, common JSON Schema) - inferring it here keeps
  // the field structure instead of collapsing it to a bare null primitive.
  if (node.type === "object" || (node.type === undefined && node.properties)) {
    const required: string[] = node.required ?? [];
    const fields: Record<string, Field> = {};
    for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, any>)) {
      fields[k] = { type: toShape(v), required: required.includes(k) };
    }
    return { kind: "object", fields };
  }
  switch (node.type) {
    case "string": case "number": case "boolean": case "null":
      return { kind: "primitive", name: node.type };
    case "integer":
      return { kind: "primitive", name: "number" };
    case "array":
      return { kind: "array", items: toShape(node.items ?? { type: "null" }) };
    default:
      if (node.$ref) return { kind: "ref", name: String(node.$ref).split("/").pop() ?? "" };
      return { kind: "primitive", name: "null" };
  }
}

export const jsonSchemaAdapter: SurfaceAdapter = {
  name: "jsonschema",
  exists(shardDir: string, slice: string): boolean {
    return existsSync(schemaPath(shardDir, slice));
  },
  extract(shardDir: string, slice: string): StructuralSurface {
    const schema = JSON.parse(readFileSync(schemaPath(shardDir, slice), "utf8"));
    const name = schema.title ?? slice;
    return {
      slice,
      symbols: { [name]: { name, kind: "type", shape: toShape(schema) } },
    };
  },
};
