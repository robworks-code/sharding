import type { Field, ShapeType, StructuralSurface, SurfaceSymbol, SymbolKind } from "./types";

/**
 * Runtime enforcement of the canonical structural surface.
 *
 * `StructuralSurface` is the one intermediate representation every adapter
 * targets and the only thing the differ consumes. A TypeScript interface alone
 * cannot enforce that across a filesystem boundary: adapters read JSON, and a
 * `JSON.parse(...) as StructuralSurface` cast asserts a shape nobody checked.
 *
 * Validating at the boundary is what makes the IR a real contract rather than a
 * convention. The failure mode it removes is specific and was observed in
 * practice: a malformed file produces not an error but a *plausible* surface -
 * an undefined slice key, a shape that silently reads as a bare primitive - and
 * the differ then reports confident, precise findings about nothing.
 *
 * Errors name the source file and the path within it, because the person
 * reading them is hand-writing JSON.
 */

const PRIMITIVE_NAMES = new Set(["string", "number", "boolean", "null"]);
const SYMBOL_KINDS = new Set<string>(["type", "endpoint", "function", "event"]);
const SHAPE_KINDS = new Set<string>(["primitive", "object", "array", "enum", "ref"]);

export class SurfaceValidationError extends Error {
  constructor(source: string, path: string, detail: string) {
    super(`${source}: ${path} ${detail}`);
    this.name = "SurfaceValidationError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateShape(node: unknown, source: string, path: string): ShapeType {
  if (!isPlainObject(node)) {
    throw new SurfaceValidationError(source, path, "must be a shape object");
  }
  const kind = node.kind;
  if (typeof kind !== "string" || !SHAPE_KINDS.has(kind)) {
    throw new SurfaceValidationError(
      source,
      path,
      `has an invalid shape kind ${JSON.stringify(kind)} (expected one of ${[...SHAPE_KINDS].join(", ")})`,
    );
  }

  switch (kind) {
    case "primitive": {
      if (typeof node.name !== "string" || !PRIMITIVE_NAMES.has(node.name)) {
        throw new SurfaceValidationError(
          source,
          path,
          `is a primitive with an invalid name ${JSON.stringify(node.name)} (expected one of ${[...PRIMITIVE_NAMES].join(", ")})`,
        );
      }
      return { kind: "primitive", name: node.name as "string" | "number" | "boolean" | "null" };
    }
    case "object": {
      if (!isPlainObject(node.fields)) {
        throw new SurfaceValidationError(source, path, "is an object shape but has no `fields` object");
      }
      const fields: Record<string, Field> = {};
      for (const [name, raw] of Object.entries(node.fields)) {
        const fieldPath = `${path}.${name}`;
        if (!isPlainObject(raw)) {
          throw new SurfaceValidationError(source, fieldPath, "must be a { type, required } field object");
        }
        if (typeof raw.required !== "boolean") {
          // Defaulting this would be worse than failing: `required` is compared,
          // so a guessed value produces a confident required-mismatch finding
          // against something the author never stated.
          throw new SurfaceValidationError(
            source,
            fieldPath,
            `must declare \`required\` as a boolean (got ${JSON.stringify(raw.required)})`,
          );
        }
        fields[name] = { type: validateShape(raw.type, source, `${fieldPath}.type`), required: raw.required };
      }
      return { kind: "object", fields };
    }
    case "array": {
      return { kind: "array", items: validateShape(node.items, source, `${path}[]`) };
    }
    case "enum": {
      if (!Array.isArray(node.values) || node.values.some((v) => typeof v !== "string")) {
        throw new SurfaceValidationError(source, path, "is an enum but `values` is not an array of strings");
      }
      return { kind: "enum", values: node.values as string[] };
    }
    case "ref": {
      if (typeof node.name !== "string" || node.name.length === 0) {
        throw new SurfaceValidationError(source, path, "is a ref but has no non-empty `name`");
      }
      return { kind: "ref", name: node.name };
    }
    /* c8 ignore next */
    default:
      throw new SurfaceValidationError(source, path, `has an unhandled shape kind ${kind}`);
  }
}

function validateSymbol(node: unknown, source: string, key: string): SurfaceSymbol {
  const path = `symbols.${key}`;
  if (!isPlainObject(node)) {
    throw new SurfaceValidationError(source, path, "must be a symbol object");
  }
  if (typeof node.kind !== "string" || !SYMBOL_KINDS.has(node.kind)) {
    throw new SurfaceValidationError(
      source,
      path,
      `has an invalid symbol kind ${JSON.stringify(node.kind)} (expected one of ${[...SYMBOL_KINDS].join(", ")})`,
    );
  }
  // The map key is what the differ reports against, so a `name` that disagrees
  // with it would make findings point at a symbol the file does not contain.
  const name = node.name === undefined ? key : node.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new SurfaceValidationError(source, path, "has a `name` that is not a non-empty string");
  }
  if (name !== key) {
    throw new SurfaceValidationError(
      source,
      path,
      `declares name ${JSON.stringify(name)} but is keyed as ${JSON.stringify(key)} (they must match)`,
    );
  }
  return { name, kind: node.kind as SymbolKind, shape: validateShape(node.shape, source, `${path}.shape`) };
}

/**
 * Validate an arbitrary parsed value as a canonical structural surface.
 *
 * `source` is a human-facing origin - a file path - used only in error text.
 * When `expectedSlice` is given, the file's own `slice` must match it; that is
 * what stops a shard from satisfying one slice's check with another's surface.
 */
export function validateSurface(
  value: unknown,
  source: string,
  expectedSlice?: string,
): StructuralSurface {
  if (!isPlainObject(value)) {
    throw new SurfaceValidationError(source, "<root>", "must be a JSON object (expected canonical { slice, symbols })");
  }
  if (typeof value.slice !== "string" || value.slice.length === 0) {
    throw new SurfaceValidationError(
      source,
      "slice",
      "is missing or not a non-empty string (expected canonical { slice, symbols } surface)",
    );
  }
  if (!isPlainObject(value.symbols)) {
    throw new SurfaceValidationError(source, "symbols", "is missing or not an object");
  }
  if (expectedSlice !== undefined && value.slice !== expectedSlice) {
    throw new SurfaceValidationError(
      source,
      "slice",
      `declares ${JSON.stringify(value.slice)} but was read as slice ${JSON.stringify(expectedSlice)}`,
    );
  }

  const symbols: Record<string, SurfaceSymbol> = {};
  for (const [key, raw] of Object.entries(value.symbols)) {
    symbols[key] = validateSymbol(raw, source, key);
  }
  return { slice: value.slice, symbols };
}
