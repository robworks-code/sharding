export type ShapeType =
  | { kind: "primitive"; name: "string" | "number" | "boolean" | "null" }
  | { kind: "object"; fields: Record<string, Field> }
  | { kind: "array"; items: ShapeType }
  | { kind: "enum"; values: string[] }
  | { kind: "ref"; name: string };

export interface Field {
  type: ShapeType;
  required: boolean;
}

export type SymbolKind = "type" | "endpoint" | "event" | "function";

export interface SurfaceSymbol {
  name: string;
  kind: SymbolKind;
  shape: ShapeType;
}

export interface StructuralSurface {
  slice: string;
  symbols: Record<string, SurfaceSymbol>;
}

export type FindingKind =
  | "missing-symbol"
  | "unexpected-symbol"
  | "kind-mismatch"
  | "missing-field"
  | "extra-field"
  | "type-mismatch"
  | "required-mismatch"
  | "enum-mismatch";

export interface Finding {
  slice: string;
  kind: FindingKind;
  location: string;
  expected?: string;
  actual?: string;
}

export function isObjectShape(s: ShapeType): s is Extract<ShapeType, { kind: "object" }> {
  return s.kind === "object";
}
