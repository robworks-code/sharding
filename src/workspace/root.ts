import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { locateShard } from "../shard/ack";

/**
 * Find the conductor workspace a working directory belongs to.
 *
 * Every read of conductor state - the manifest, the contract, the phase gate -
 * is anchored to this. Resolving it from the session's actual location is what
 * lets a shard session run a read-only command without first walking itself
 * back to the root, the same way hooks/stop.mjs already does on its behalf.
 *
 * The shard boundary wins over an ancestor search: a shard that contains its
 * own .sharding directory (a vendored workspace, a fixture) must not be able to
 * redefine which graph it is measured against. Outside a shard, the nearest
 * ancestor holding .sharding/manifest.yaml is the workspace.
 *
 * With no workspace anywhere above, the directory is returned as given, so the
 * caller still fails with "no manifest at <cwd>/..." rather than a path the
 * user never named.
 */
export function resolveRoot(cwd: string): string {
  const loc = locateShard(cwd);
  if (loc) return loc.repoRoot;

  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".sharding", "manifest.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}
