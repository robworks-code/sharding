#!/usr/bin/env node
/**
 * Fail when the rebuilt bundle is not the one that would be pushed.
 *
 * Deliberately NOT part of `npm run verify`. Verify builds before it tests, so
 * it can never leave a stale bundle on disk - and an uncommitted `dist/` during
 * ordinary development is not staleness, it is work in progress. Failing verify
 * on that would be a false alarm that trains people to ignore the gate.
 *
 * Push is the moment the question becomes real: is the bundle other people will
 * run the one this source builds? Run via `npm run prepush`, or from a
 * `.git/hooks/pre-push` that calls it.
 */
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

try {
  // Uncommitted (staged or not) means the rebuild is not what would be pushed.
  const dirty = git(["status", "--porcelain", "--", "dist/"]);
  if (dirty) {
    process.stderr.write(
      "dist/ differs from HEAD after a rebuild, so the bundle that would be pushed is stale.\n" +
        "The plugin runs dist/cli.mjs, not src/ - commit the rebuilt bundle:\n" +
        "  git add dist/cli.mjs && git commit --amend --no-edit\n",
    );
    process.exit(1);
  }
} catch (e) {
  // Not a git repo, or git is unavailable. The freshness test already covers
  // staleness on disk, so this check declines rather than failing the gate.
  process.stderr.write(`skipping committed-dist check: ${e.message}\n`);
}
