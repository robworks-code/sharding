#!/bin/zsh
# Mutation matrix for src/surface/validate.ts.
#
# Each row disables one guard and records which tests fail. A row that fails
# ZERO tests is the finding: that guard is either dead code or unenforced.
#
# The restore runs on EXIT/INT/TERM, not just the happy path - a row killed
# mid-run would otherwise leave the repo holding a mutated source file that
# looks like an ordinary working-tree edit.
set -u
cd "${0:A:h}/.."

F=src/surface/validate.ts
BAK=$(mktemp)
cp "$F" "$BAK"
trap 'cp "$BAK" "$F"; rm -f "$BAK"' EXIT INT TERM

run_row() {
  local label="$1" perl_expr="$2"
  cp "$BAK" "$F"
  /usr/bin/perl -pi -e "$perl_expr" "$F"
  if /usr/bin/cmp -s "$BAK" "$F"; then
    print -r -- "MUTATION-DID-NOT-APPLY  $label"
    return
  fi
  local out
  out=$(npx vitest run tests/surface/validate.test.ts tests/contract/model.test.ts 2>&1)
  local failed
  failed=$(print -r -- "$out" | /usr/bin/grep -oE 'Tests +[0-9]+ failed' | /usr/bin/grep -oE '[0-9]+' | head -1)
  : "${failed:=0}"
  print -r -- "failed=${failed}  $label"
}

run_row "primitive name whitelist"   's/!PRIMITIVE_NAMES\.has\(node\.name\)/false/'
run_row "symbol kind whitelist"      's/!SYMBOL_KINDS\.has\(node\.kind\)/false/'
run_row "shape kind whitelist"       's/!SHAPE_KINDS\.has\(kind\)/false/'
run_row "required-is-boolean"        's/typeof raw\.required !== "boolean"/false/'
run_row "name-matches-key"           's/^(\s*)if \(name !== key\)/$1if (false)/'
run_row "expected-slice match"       's/value\.slice !== expectedSlice/false/'
run_row "enum values are strings"    's/typeof v !== "string"/false/'
run_row "ref has a name"             's/node\.name\.length === 0/false/'
run_row "symbols is an object"       's/!isPlainObject\(value\.symbols\)/false/'
run_row "object has fields map"      's/!isPlainObject\(node\.fields\)/false/'

print -r -- "--- restored; git diff should be empty for $F ---"
