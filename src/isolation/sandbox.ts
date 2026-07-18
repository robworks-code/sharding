import { resolve, relative, isAbsolute } from "node:path";

function isInside(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isReadAllowed(shardDir: string, contractDir: string, target: string): boolean {
  return isInside(shardDir, target) || isInside(contractDir, target);
}

export function isWriteAllowed(shardDir: string, contractDir: string, target: string): boolean {
  return isInside(shardDir, target) && !isInside(contractDir, target);
}
