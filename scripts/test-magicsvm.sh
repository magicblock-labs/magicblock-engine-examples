#!/bin/bash
# Run the MagicSVM tests (TypeScript `yarn test`, plus the Rust suite when the
# example has one) for every MagicSVM example (MAGICSVM_PROJECTS in projects.sh).
#
# MagicSVM tests are in-process and do not start validators. They do need the
# compiled program .so (and IDL, for Anchor examples), so each example is built
# first via `yarn build`.
#
# Usage:
#   bash scripts/test-magicsvm.sh              # all MagicsVM examples
#   bash scripts/test-magicsvm.sh spl-tokens   # substring filter
#
# Env:
#   FAIL_FAST=0     keep going after a failure (default: stop on first)
#   SKIP_TS=1       skip yarn test (TypeScript suite)
#   SKIP_RS=1       skip yarn test:magicsvm:rs
#   SKIP_BUILD=1    skip yarn build (use existing target/deploy)
#   EXACT_MATCH=1   require the filter to equal the project name (used by CI)
#   MAGICSVM_RS_TARGET_DIR=<dir>  CARGO_TARGET_DIR for the Rust suites (CI shares one cache)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/projects.sh
. "$SCRIPT_DIR/projects.sh"

TEST_FILTER="${1:-}"
FAIL_FAST="${FAIL_FAST:-1}"
SKIP_TS="${SKIP_TS:-0}"
SKIP_RS="${SKIP_RS:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
EXACT_MATCH="${EXACT_MATCH:-0}"
YARN_MUTEX="${YARN_MUTEX:-file:/tmp/.yarn-install-mutex}"

PASSED=()
FAILED=()
SKIPPED=()

matches_filter() {
  [ -z "$TEST_FILTER" ] && return 0
  if [ "$EXACT_MATCH" = "1" ]; then
    [ "$1" = "$TEST_FILTER" ]
  else
    [[ "$1" == *"$TEST_FILTER"* ]]
  fi
}

echo "Installing MagicSVM test helpers..."
( cd "$REPO_ROOT/test-utils/ts" && yarn install --mutex "$YARN_MUTEX" && yarn build )

run_one() {
  local name="$1"
  local dir
  dir="$(project_dir "$name")"
  if [ -z "$dir" ]; then
    echo "Unknown MagicsVM project '$name'"
    return 1
  fi
  if ! matches_filter "$name"; then
    return 2
  fi

  echo ""
  echo "========================================"
  echo "MagicsVM: $name ($dir)"
  echo "========================================"

  (
    cd "$dir"
    yarn install --mutex "$YARN_MUTEX"
    if [ "$SKIP_BUILD" != "1" ]; then
      yarn build
    fi
    ran=0
    if [ "$SKIP_TS" != "1" ]; then
      yarn test || exit 1
      ran=1
    fi
    if [ "$SKIP_RS" != "1" ] && grep -q '"test:magicsvm:rs"' package.json; then
      rs_env=()
      if [ -n "${MAGICSVM_RS_TARGET_DIR:-}" ]; then
        rs_env+=("CARGO_TARGET_DIR=$MAGICSVM_RS_TARGET_DIR")
      fi
      env ${rs_env[@]+"${rs_env[@]}"} RUSTUP_TOOLCHAIN="${MAGICSVM_RUSTUP_TOOLCHAIN:-nightly}" \
        yarn test:magicsvm:rs || exit 1
      ran=1
    fi
    if [ "$ran" -eq 0 ]; then
      if [ "$SKIP_TS" = "1" ] && [ "$SKIP_RS" = "1" ]; then
        exit 2
      fi
      echo "No MagicSVM tests ran for $name (SKIP_TS/SKIP_RS)"
      exit 1
    fi
  )
}

for name in "${MAGICSVM_PROJECTS[@]}"; do
  status=0
  run_one "$name" || status=$?
  if [ "$status" -eq 0 ]; then
    PASSED+=("$name")
  elif [ "$status" -eq 2 ]; then
    SKIPPED+=("$name")
  else
    FAILED+=("$name")
    if [ "$FAIL_FAST" != "0" ]; then
      echo "FAIL_FAST: stopping after $name"
      echo "MagicsVM failed: $name"
      exit 1
    fi
  fi
done

if [ -n "$TEST_FILTER" ] && [ "${#PASSED[@]}" -eq 0 ] && [ "${#FAILED[@]}" -eq 0 ]; then
  echo "No MagicsVM project matched '$TEST_FILTER'"
  exit 1
fi

echo ""
echo "========================================"
echo "MagicsVM: ${#PASSED[@]} passed, ${#FAILED[@]} failed, ${#SKIPPED[@]} skipped"
echo "========================================"
if [ "${#FAILED[@]}" -gt 0 ]; then
  for name in "${FAILED[@]}"; do
    echo "  ✗ $name"
  done
  exit 1
fi
exit 0
