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
    const surface = JSON.parse(readFileSync(join(dir, file), "utf8")) as StructuralSurface;
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
