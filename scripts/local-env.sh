# shellcheck shell=sh
# Local MagicBlock cluster endpoints — the single source of truth shared by the
# test harness (test-locally.sh) and each example's `yarn test:local`.
#
# Why this file exists: the example tests fall back to devnet when these vars are
# unset (e.g. `process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com"`).
# Sourcing this points the SDK at the local cluster brought up by `yarn setup`
# (SETUP_ONLY=1 ./scripts/test-locally.sh) instead. Source it, don't execute it:
#   . ../scripts/local-env.sh && yarn test:local
#
# Request flow for local tests:
#   client -> QFS (6699) -> ER validator (7799) -> base solana validator (8899)

export PROVIDER_ENDPOINT=http://localhost:8899
export WS_ENDPOINT=ws://localhost:8900
export EPHEMERAL_PROVIDER_ENDPOINT=http://localhost:7799
export EPHEMERAL_WS_ENDPOINT=ws://localhost:7800
export QFS_ENDPOINT=http://localhost:6699
export QFS_WS_ENDPOINT=ws://localhost:6700
# Anchor SDK reads ANCHOR_PROVIDER_URL/ANCHOR_WALLET when test code calls
# AnchorProvider.env(). Without these, `anchor test` overrides them based on the
# Anchor.toml [provider] cluster (often devnet) and tests silently hit the wrong network.
export ANCHOR_PROVIDER_URL=$PROVIDER_ENDPOINT
export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
# Router-style tests (advanced-magic, magic-actions) point at the
# MagicBlock router on devnet — locally there's no router, so route them through the
# ephemeral validator.
export ROUTER_ENDPOINT=$EPHEMERAL_PROVIDER_ENDPOINT
export ROUTER_WS_ENDPOINT=$EPHEMERAL_WS_ENDPOINT
export VALIDATOR=mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev
# VRF queues — local oracle (paywJiVATr...) index 0 on base, index 1 delegated on ER.
export VRF_BASE_QUEUE="GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb"
export VRF_EPHEMERAL_QUEUE="Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT"
# TEE examples reach the ER through the QFS (see test-locally.sh run_test); expose the
# QFS endpoint under the names their test code reads so standalone runs route locally too.
export TEE_PROVIDER_ENDPOINT=$QFS_ENDPOINT
export TEE_WS_ENDPOINT=$QFS_WS_ENDPOINT
