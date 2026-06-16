#!/bin/bash
# Run the local test suite for a SINGLE example, with its own fresh validators.
#
# This is the per-example entry point used by the CI matrix (one runner per
# example). Building/testing every example on one runner was exhausting disk;
# fanning out to one runner per example keeps each runner's disk usage bounded.
#
# It is a thin wrapper around test-locally.sh — it does NOT reimplement any of
# the validator orchestration. It just:
#   1. exact-matches the one requested project (so "roll-dice" doesn't also drag
#      in "pinocchio-roll-dice", etc.), and
#   2. enables only the test phase that project belongs to (so the VRF oracle /
#      other phases aren't started needlessly),
# then hands off to test-locally.sh, which builds the program, starts the
# validators, runs the test, and tears everything down exactly as it does for a
# full local run.
#
# Usage: scripts/test-example.sh <example-name>
#   e.g. scripts/test-example.sh spl-tokens
#
# All of test-locally.sh's env flags (FAIL_FAST, DEVNET_RPC_URL, …) still apply
# and are inherited.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/projects.sh
. "$SCRIPT_DIR/projects.sh"

EXAMPLE="${1:-}"
if [ -z "$EXAMPLE" ]; then
  echo "Usage: $0 <example-name>"
  echo "Known examples: ${ALL_PROJECTS[*]}"
  exit 2
fi

phase="$(project_phase "$EXAMPLE")"
if [ -z "$phase" ]; then
  echo "Unknown example '$EXAMPLE'."
  echo "Known examples: ${ALL_PROJECTS[*]}"
  exit 2
fi

# Enable only the phase this example belongs to, so test-locally.sh doesn't build
# the other phases' projects or start their validators/oracles.
export SKIP_REGULAR_TESTS=1 SKIP_VRF_TESTS=1 SKIP_TEE_TESTS=1
case "$phase" in
  regular) SKIP_REGULAR_TESTS=0 ;;
  vrf)     SKIP_VRF_TESTS=0 ;;
  tee)     SKIP_TEE_TESTS=0 ;;
esac

# Exact match: the filter test-locally.sh applies is a substring match by default,
# which would over-select (e.g. "private-counter" also matches
# "pinocchio-private-counter"). EXACT_MATCH=1 makes it select only this project.
export EXACT_MATCH=1

echo "Running single example '$EXAMPLE' (phase: $phase)"
exec bash "$SCRIPT_DIR/test-locally.sh" "$EXAMPLE"
