import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuralSurface } from "../surface/types";
import { validateSurface } from "../surface/validate";

export interface Contract {
  version: string;
  slices: Record<string, StructuralSurface>;
}

function loadDir(dir: string, into: Record<string, StructuralSurface>): void {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(dir, file);
    // A contract slice file must be a canonical structural surface. The same
    // validator runs over adapter output, so the contract and the surfaces it
    // is diffed against are held to one definition of the IR rather than two
    // drifting approximations of it.
    //
    // Note the contract side passes no expected slice: unlike a shard surface,
    // which is read as a named slice, a contract file declares its own.
    const surface = validateSurface(JSON.parse(readFileSync(path, "utf8")), path);
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
