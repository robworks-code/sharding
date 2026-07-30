import type { Field, ShapeType } from "./types";

/**
 * JSON Schema -> canonical shape.
 *
 * Shared by the `jsonschema` and `openapi` adapters. OpenAPI's schema object is
 * JSON Schema with a handful of additions, so one mapper serving both is not a
 * convenience - it is what makes "the same field type" mean the same thing to
 * the differ regardless of which artifact the shard emitted.
 */
export function jsonSchemaToShape(node: any): ShapeType {
  if (!node || typeof node !== "object") return { kind: "primitive", name: "null" };

  // $ref wins over everything: a node carrying one has no local shape to read.
  if (node.$ref) return { kind: "ref", name: String(node.$ref).split("/").pop() ?? "" };
  if (node.enum) return { kind: "enum", values: node.enum.map(String) };

  // A node with `properties` is an object even when it omits an explicit
  // "type": "object" (valid, common JSON Schema) - inferring it here keeps
  // the field structure instead of collapsing it to a bare null primitive.
  if (node.type === "object" || (node.type === undefined && node.properties)) {
    return { kind: "object", fields: propertiesToFields(node) };
  }

  switch (node.type) {
    case "string": case "number": case "boolean": case "null":
      return { kind: "primitive", name: node.type };
    case "integer":
      return { kind: "primitive", name: "number" };
    case "array":
      return { kind: "array", items: jsonSchemaToShape(node.items ?? { type: "null" }) };
    default:
      return { kind: "primitive", name: "null" };
  }
}

/** Map a schema's `properties` + `required` list to canonical fields. */
export function propertiesToFields(node: any): Record<string, Field> {
  const required: string[] = node?.required ?? [];
  const fields: Record<string, Field> = {};
  for (const [k, v] of Object.entries((node?.properties ?? {}) as Record<string, any>)) {
    fields[k] = { type: jsonSchemaToShape(v), required: required.includes(k) };
  }
  return fields;
}
