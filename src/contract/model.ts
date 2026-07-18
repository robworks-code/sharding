import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuralSurface } from "../surface/types";

export interface Contract {
  version: string;
  slices: Record<string, StructuralSurface>;
}

function loadDir(dir: string, into: Record<string, StructuralSurface>): void {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(dir, file);
    const surface = JSON.parse(readFileSync(path, "utf8")) as StructuralSurface;
    // A contract slice file must be a canonical structural surface:
    // { slice: string, symbols: { ... } }. Without this guard a malformed
    // file (e.g. a free-form interface shape) silently keys the slice map at
    // `undefined`, and every shard then reports a spurious missing-symbol.
    if (typeof surface.slice !== "string" || surface.slice.length === 0) {
      throw new Error(`contract file ${path} is missing a string "slice" field (expected canonical { slice, symbols } surface)`);
    }
    if (typeof surface.symbols !== "object" || surface.symbols === null) {
      throw new Error(`contract slice "${surface.slice}" (${path}) is missing a "symbols" object`);
    }
    if (into[surface.slice]) {
      throw new Error(`contract slice "${surface.slice}" is declared twice (duplicate in ${path})`);
    }
    into[surface.slice] = surface;
  }
}

export function loadContract(root: string): Contract {
  const dir = join(root, "contract");
  if (!existsSync(dir)) throw new Error(`no contract at ${dir}`);
  const version = readFileSync(join(dir, "VERSION"), "utf8").trim();
  const slices: Record<string, StructuralSurface> = {};
  loadDir(join(dir, "interfaces"), slices);
  loadDir(join(dir, "schemas"), slices);
  return { version, slices };
}
