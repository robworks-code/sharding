#!/usr/bin/env node
/**
 * Single source of truth for how the shipped bundle is built.
 *
 * The plugin consumes `dist/cli.mjs`, never `src/`, so a stale bundle means a
 * fix silently does not take effect. `buildBundle()` is exported so the
 * freshness test can rebuild with exactly these options instead of restating
 * them - restated flags would drift, and a drifted check passes for the wrong
 * reason.
 */
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BUNDLE_PATH = join(repoRoot, "dist", "cli.mjs");

/**
 * Build the CLI bundle. Output is byte-identical regardless of `outfile`, which
 * is what lets the freshness test build to a scratch path and compare.
 */
export async function buildBundle(outfile = BUNDLE_PATH) {
  await build({
    entryPoints: [join(repoRoot, "src", "cli.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
  });
  return outfile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildBundle(process.argv[2]);
}
