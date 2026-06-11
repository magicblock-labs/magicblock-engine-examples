# ⚡ MagicBlock Engine - Integration Examples

Scaling solution for performant, composable games and applications.

## ✨Overview

This repository contains examples of how delegate/undelegate accounts and run transactions in an Ephemeral Rollups.
Read more about Ephemeral Rollups [here](https://docs.magicblock.gg/EphemeralRollups/ephemeral_rollups).

> To view integrated demos for specific usecases, please look at [MagicBlock Starter Kits](https://github.com/magicblock-labs/starter-kits).

## 👷 Examples

### Counter programs

- [Anchor Counter](./anchor-counter/README.md) — Counter program in Anchor. Tests delegate/undelegate via the TypeScript SDK.
- [Rust Counter](./rust-counter/README.md) — Counter program in native Rust. Tests delegate/undelegate natively.
- [Pinocchio Counter](./pinocchio-counter/README.md) — Counter program built with Pinocchio (no heap, no Borsh `Vec`s).
- [Pinocchio Ephemeral Permission Counter](./pinocchio-ephemeral-permission-counter/README.md) — Pinocchio counter with ephemeral permission accounts on the ER.
- [Pinocchio Private Counter](./pinocchio-private-counter/README.md) — Pinocchio counter variant exercising private state on the ER.
- [Private Counter](./private-counter/README.md) — Anchor counter gated by an on-rollup ephemeral permission account.
- [Session Keys](./session-keys/README.md) — Counter using gpl-session keys for delegated-signer auth on both base chain and ER.
- [Crank Counter](./crank-counter/README.md) — Counter driven by MagicBlock's scheduled crank system.
- [Ephemeral Account Chats](./ephemeral-account-chats/README.md) — Chat program using Anchor "ephemeral accounts" (state lives only on the ER).

### Tokens & payments

- [Dummy Token Transfer](./dummy-token-transfer/README.md) — Token transferer that can delegate and execute on both the base chain and the ER.
- [SPL Tokens](./spl-tokens/README.md) — SPL token delegation example with transfers on the ER.
- [Private Payments](./private-payments/README.md) — Next.js demo for MagicBlock private payments.

### VRF & games

- [Roll Dice](./roll-dice/README.md) — Dice roll using a verifiable random function (VRF) on the ER.
- [Pinocchio Roll Dice](./pinocchio-roll-dice/README.md) — Pinocchio (no-Anchor) VRF dice variant.
- [Rewards (Delegated VRF)](./rewards-delegated-vrf/README.md) — Rewards distribution program using delegated VRF.
- [Rock Paper Scissor](./rock-paper-scissor/README.md) — Two-player RPS with hidden moves on the ER until reveal.

### Other patterns

- [Magic Actions](./magic-actions/README.md) — Execute base-chain actions from inside an Ephemeral Rollup.
- [On-Curve Delegation](./oncurve-delegation/README.md) — Delegate on-curve (non-PDA) accounts to the ER and manage their lifecycle.

## Backward Compatibility

Older pre-Anchor 1.0 versions of the migrated programs are kept in
[00-LEGACY_EXAMPLES](./00-LEGACY_EXAMPLES/README.md). The `00-` prefix keeps
these compatibility references listed before the active examples in
alphabetical folder views. These examples are for users who still need the
previous Anchor 0.32.1 implementations while upgrading to the current Anchor 1.0
programs.

## 🚧 Under Testing 🚧

The Ephemeral Rollups are currently under testing. Reach out to us on [Discord](https://discord.com/invite/MBkdC3gxcv) to get access to the testing endpoint.
