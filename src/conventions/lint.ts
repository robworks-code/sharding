import type { Finding, StructuralSurface } from "../surface/types";
import { isObjectShape } from "../surface/types";

export interface ConventionRules {
  symbolNamePattern?: string;
  fieldNamePattern?: string;
}

export function lintConventions(surface: StructuralSurface, rules: ConventionRules): Finding[] {
  const findings: Finding[] = [];
  const symbolRe = rules.symbolNamePattern ? new RegExp(rules.symbolNamePattern) : null;
  const fieldRe = rules.fieldNamePattern ? new RegExp(rules.fieldNamePattern) : null;
  for (const sym of Object.values(surface.symbols)) {
    if (symbolRe && !symbolRe.test(sym.name)) {
      findings.push({ slice: surface.slice, kind: "type-mismatch", location: sym.name, expected: rules.symbolNamePattern, actual: sym.name });
    }
    if (fieldRe && isObjectShape(sym.shape)) {
      for (const fieldName of Object.keys(sym.shape.fields)) {
        if (!fieldRe.test(fieldName)) {
          findings.push({ slice: surface.slice, kind: "type-mismatch", location: `${sym.name}.${fieldName}`, expected: rules.fieldNamePattern, actual: fieldName });
        }
      }
    }
  }
  return findings;
}
