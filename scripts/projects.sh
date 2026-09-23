#!/bin/bash
# Single source of truth for the example projects. The project name is the stable
# CLI/CI identifier; project_dir maps that identifier to its location in the
# use-case/framework folder layout. Every project exposes `yarn build`; MagicSVM
# projects expose `yarn test` (in-process), validator projects `yarn test:local`.
#
# Sourced by:
#   - scripts/test-locally.sh (full suite, runs every phase)
#   - scripts/test-example.sh (one example per invocation — CI matrix entry point)
#   - scripts/test-magicsvm.sh (MagicSVM projects, no validators)
#   - the CI matrix generators (projects_json / magicsvm_projects_json)
#
# Keep this list in sync when adding/removing examples; both the local runner and
# CI pick it up automatically.

# Validator-based examples, grouped by the phase (validators/oracles) they need. Only the
# examples MagicSVM cannot simulate yet stay here: scheduled tasks (crank-counter), the VRF
# oracle (gachapon-example, roll-dice, pinocchio-roll-dice, rewards-delegated-vrf) and the
# private-permission flow of sealed-auction (see sealed-auction/anchor/MAGICSVM_FLAWS.md).
REGULAR_PROJECTS=(crank-counter gachapon-example)
VRF_PROJECTS=(rewards-delegated-vrf roll-dice pinocchio-roll-dice)
TEE_PROJECTS=(sealed-auction)

# Examples whose `yarn test` runs in-process on MagicSVM (TypeScript; most also ship a Rust
# suite under tests-magicsvm-rs/ run by `yarn test:magicsvm:rs`). No local cluster needed.
MAGICSVM_PROJECTS=(anchor-counter rust-counter pinocchio-counter private-counter pinocchio-private-counter oracle-priced-purchase oncurve-delegation rock-paper-scissor ephemeral-account-chats session-keys binary-prediction magic-actions delegation-actions spl-tokens)

ALL_PROJECTS=("${REGULAR_PROJECTS[@]}" "${VRF_PROJECTS[@]}" "${TEE_PROJECTS[@]}")

# Print the directory for a stable project name, or empty if unknown.
project_dir() {
  case "$1" in
    anchor-counter) echo "counter/anchor" ;;
    pinocchio-counter) echo "counter/pinocchio" ;;
    rust-counter) echo "counter/native-rust" ;;
    binary-prediction) echo "binary-prediction/anchor" ;;
    oracle-priced-purchase) echo "oracle-priced-purchase/anchor" ;;
    crank-counter) echo "crank-counter/anchor" ;;
    delegation-actions) echo "delegation-actions/anchor" ;;
    ephemeral-account-chats) echo "ephemeral-account-chats/anchor" ;;
    gachapon-example) echo "gachapon-example" ;;
    magic-actions) echo "magic-actions/anchor" ;;
    session-keys) echo "session-keys/anchor" ;;
    spl-tokens) echo "spl-tokens/anchor" ;;
    rewards-delegated-vrf) echo "rewards-delegated-vrf/anchor" ;;
    roll-dice) echo "roll-dice/anchor" ;;
    pinocchio-roll-dice) echo "roll-dice/pinocchio" ;;
    private-counter) echo "private-counter/anchor" ;;
    pinocchio-private-counter) echo "private-counter/pinocchio" ;;
    rock-paper-scissor) echo "rock-paper-scissor/anchor" ;;
    sealed-auction) echo "sealed-auction/anchor" ;;
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

magicsvm_projects_json() {
  local out="" p
  for p in "${MAGICSVM_PROJECTS[@]}"; do
    out+="\"$p\","
  done
  echo "[${out%,}]"
}
