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
  // A ref is compared by name, so one that yields no name is not a ref the
  // differ can use. Falling through (which a truthiness check on `$ref` did)
  // sent it to the default branch and it came out a null primitive - a shape
  // nobody declared, reported downstream as confident type drift.
  if ("$ref" in node) {
    const name = String(node.$ref ?? "").split("/").pop() ?? "";
    if (!name) {
      throw new Error(
        `$ref ${JSON.stringify(node.$ref)} does not name a symbol. Write the whole pointer ` +
          `(e.g. "#/components/schemas/Money") - a ref is matched against the contract by its last segment.`,
      );
    }
    return { kind: "ref", name };
  }
  if (node.enum) return { kind: "enum", values: node.enum.map(String) };

  // Composition keywords. These are rare in hand-written JSON Schema but very
  // common in generated OpenAPI, where `allOf` is the usual way to express
  // "this model plus these fields" - so collapsing them to a null primitive
  // (the old default branch) meant the differ reported confident type-mismatch
  // findings against a shape nobody declared.
  if (Array.isArray(node.allOf)) return mergeAll(node.allOf);
  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      if (branches.length === 1) return jsonSchemaToShape(branches[0]);
      // A genuine union of differing shapes has no canonical representation.
      // Failing names the schema; guessing would not.
      throw new Error(
        `${key} with ${branches.length} branches has no structural equivalent in the canonical surface. ` +
          `Model the shared shape with allOf or $ref, or declare this slice with the identity adapter.`,
      );
    }
  }

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

/**
 * `allOf` is intersection: merge every branch's fields into one object. A
 * branch that is a `$ref` cannot be followed here (the mapper sees one schema,
 * not the document), so it contributes nothing structurally - the ref is
 * already compared by name wherever it appears as a field type.
 */
function mergeAll(branches: any[]): ShapeType {
  const fields: Record<string, Field> = {};
  for (const branch of branches) {
    const shape = jsonSchemaToShape(branch);
    if (shape.kind === "object") Object.assign(fields, shape.fields);
  }
  return { kind: "object", fields };
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
