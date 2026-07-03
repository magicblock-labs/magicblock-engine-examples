#!/bin/bash
# Single source of truth for the example projects, grouped by the test phase that
# runs them. The directory name IS the project name (and the argument passed to
# run_test / test-example.sh). Each project exposes `yarn build` (compile only)
# and `yarn test:local` (the local test subset).
#
# Sourced by:
#   - scripts/test-locally.sh (full suite, runs every phase)
#   - scripts/test-example.sh (one example per invocation — CI matrix entry point)
#   - the CI matrix generator (reads projects_json to fan out one runner per example)
#
# Keep this list in sync when adding/removing examples; both the local runner and
# CI pick it up automatically.

REGULAR_PROJECTS=(anchor-counter binary-prediction crank-counter dummy-token-transfer ephemeral-account-chats magic-actions oracle-priced-purchase pinocchio-counter rust-counter session-keys spl-tokens)
VRF_PROJECTS=(rewards-delegated-vrf roll-dice pinocchio-roll-dice)
TEE_PROJECTS=(private-counter pinocchio-private-counter rock-paper-scissor)

ALL_PROJECTS=("${REGULAR_PROJECTS[@]}" "${VRF_PROJECTS[@]}" "${TEE_PROJECTS[@]}")

# Print the phase (regular|vrf|tee) a project belongs to, or empty if unknown.
project_phase() {
  local name="$1" p
  for p in "${REGULAR_PROJECTS[@]}"; do [ "$p" = "$name" ] && { echo regular; return; }; done
  for p in "${VRF_PROJECTS[@]}"; do [ "$p" = "$name" ] && { echo vrf; return; }; done
  for p in "${TEE_PROJECTS[@]}"; do [ "$p" = "$name" ] && { echo tee; return; }; done
  echo ""
}

# Emit every project name as a compact JSON array, for the GitHub Actions matrix
# (consumed via `fromJSON`). e.g. ["anchor-counter","crank-counter",...]
projects_json() {
  local out="" p
  for p in "${ALL_PROJECTS[@]}"; do
    out+="\"$p\","
  done
  echo "[${out%,}]"
}
