import type { Finding, ShapeType, StructuralSurface, SurfaceSymbol } from "./types";

function shapeLabel(s: ShapeType): string {
  switch (s.kind) {
    case "primitive": return s.name;
    case "object": return "object";
    case "array": return `array<${shapeLabel(s.items)}>`;
    case "enum": return `enum(${s.values.join("|")})`;
    case "ref": return `ref:${s.name}`;
  }
}

function diffShape(expected: ShapeType, actual: ShapeType, slice: string, loc: string): Finding[] {
  if (expected.kind !== actual.kind) {
    return [{ slice, kind: "type-mismatch", location: loc, expected: shapeLabel(expected), actual: shapeLabel(actual) }];
  }
  if (expected.kind === "object" && actual.kind === "object") {
    const findings: Finding[] = [];
    for (const [name, field] of Object.entries(expected.fields)) {
      const child = actual.fields[name];
      if (!child) {
        findings.push({ slice, kind: "missing-field", location: `${loc}.${name}`, expected: shapeLabel(field.type) });
        continue;
      }
      if (field.required !== child.required) {
        findings.push({
          slice, kind: "required-mismatch", location: `${loc}.${name}`,
          expected: String(field.required), actual: String(child.required),
        });
      }
      findings.push(...diffShape(field.type, child.type, slice, `${loc}.${name}`));
    }
    for (const name of Object.keys(actual.fields)) {
      if (!expected.fields[name]) {
        findings.push({ slice, kind: "extra-field", location: `${loc}.${name}`, actual: shapeLabel(actual.fields[name].type) });
      }
    }
    return findings;
  }
  if (expected.kind === "array" && actual.kind === "array") {
    return diffShape(expected.items, actual.items, slice, `${loc}[]`);
  }
  if (expected.kind === "enum" && actual.kind === "enum") {
    const e = [...expected.values].sort().join("|");
    const a = [...actual.values].sort().join("|");
    return e === a ? [] : [{ slice, kind: "enum-mismatch", location: loc, expected: e, actual: a }];
  }
  if (expected.kind === "primitive" && actual.kind === "primitive") {
    return expected.name === actual.name
      ? []
      : [{ slice, kind: "type-mismatch", location: loc, expected: expected.name, actual: actual.name }];
  }
  if (expected.kind === "ref" && actual.kind === "ref") {
    return expected.name === actual.name
      ? []
      : [{ slice, kind: "type-mismatch", location: loc, expected: `ref:${expected.name}`, actual: `ref:${actual.name}` }];
  }
  return [];
}

function diffSymbol(expected: SurfaceSymbol, actual: SurfaceSymbol, slice: string): Finding[] {
  if (expected.kind !== actual.kind) {
    return [{ slice, kind: "kind-mismatch", location: expected.name, expected: expected.kind, actual: actual.kind }];
  }
  return diffShape(expected.shape, actual.shape, slice, expected.name);
}

export function diffSurface(expected: StructuralSurface, actual: StructuralSurface): Finding[] {
  const slice = expected.slice;
  const findings: Finding[] = [];
  for (const [name, sym] of Object.entries(expected.symbols)) {
    const other = actual.symbols[name];
    if (!other) {
      findings.push({ slice, kind: "missing-symbol", location: name });
      continue;
    }
    findings.push(...diffSymbol(sym, other, slice));
  }
  for (const name of Object.keys(actual.symbols)) {
    if (!expected.symbols[name]) {
      findings.push({ slice, kind: "unexpected-symbol", location: name });
    }
  }
  return findings;
}
