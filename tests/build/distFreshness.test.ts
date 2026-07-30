import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - plain .mjs build script, no type declarations by design
import { BUNDLE_PATH, buildBundle } from "../../scripts/build.mjs";

/**
 * The plugin runs `dist/cli.mjs`, not `src/`. A source change committed without
 * `npm run build` ships a bundle that does not contain the fix, and every other
 * test in this suite still passes because they exercise `src/` directly.
 *
 * This is the only test that measures the artifact the user actually runs.
 */
describe("dist bundle freshness", () => {
  it("matches a fresh build of src/ byte for byte", async () => {
    const scratch = join(mkdtempSync(join(tmpdir(), "sharding-build-")), "cli.mjs");
    await buildBundle(scratch);

    const committed = readFileSync(BUNDLE_PATH, "utf8");
    const fresh = readFileSync(scratch, "utf8");

    expect(
      committed === fresh,
      "dist/cli.mjs is stale relative to src/. Run `npm run build` and commit the result.",
    ).toBe(true);
  }, 30_000);
});
