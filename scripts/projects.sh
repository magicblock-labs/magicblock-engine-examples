#!/bin/bash
# Single source of truth for the example projects, grouped by the test phase that
# runs them. The project name is the stable CLI/CI identifier; project_dir maps
# that identifier to its location in the use-case/framework folder layout. Each
# project exposes `yarn build` (compile only) and `yarn test:local` (the local
# test subset).
#
# Sourced by:
#   - scripts/test-locally.sh (full suite, runs every phase)
#   - scripts/test-example.sh (one example per invocation — CI matrix entry point)
#   - the CI matrix generator (reads projects_json to fan out one runner per example)
#
# Keep this list in sync when adding/removing examples; both the local runner and
# CI pick it up automatically.

REGULAR_PROJECTS=(anchor-counter binary-prediction crank-counter ephemeral-account-chats magic-actions oracle-priced-purchase pinocchio-counter rust-counter session-keys spl-tokens)
VRF_PROJECTS=(rewards-delegated-vrf roll-dice pinocchio-roll-dice)
TEE_PROJECTS=(private-counter pinocchio-private-counter rock-paper-scissor)

ALL_PROJECTS=("${REGULAR_PROJECTS[@]}" "${VRF_PROJECTS[@]}" "${TEE_PROJECTS[@]}")

# Print the directory for a stable project name, or empty if unknown.
project_dir() {
  case "$1" in
    anchor-counter) echo "counter/anchor" ;;
    pinocchio-counter) echo "counter/pinocchio" ;;
    rust-counter) echo "counter/native-rust" ;;
    binary-prediction) echo "binary-prediction" ;;
    oracle-priced-purchase) echo "oracle-priced-purchase" ;;
    crank-counter) echo "crank-counter/anchor" ;;
    delegation-actions) echo "delegation-actions/anchor" ;;
    ephemeral-account-chats) echo "ephemeral-account-chats/anchor" ;;
    magic-actions) echo "magic-actions/anchor" ;;
    session-keys) echo "session-keys/anchor" ;;
    spl-tokens) echo "spl-tokens/anchor" ;;
    rewards-delegated-vrf) echo "rewards-delegated-vrf/anchor" ;;
    roll-dice) echo "roll-dice/anchor" ;;
    pinocchio-roll-dice) echo "roll-dice/pinocchio" ;;
    private-counter) echo "private-counter/anchor" ;;
    pinocchio-private-counter) echo "private-counter/pinocchio" ;;
    rock-paper-scissor) echo "rock-paper-scissor/anchor" ;;
    oncurve-delegation) echo "oncurve-delegation/client" ;;
    *) echo "" ;;
  esac
}

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
