# 🎲 Pinocchio Roll Dice

Pinocchio (no-Anchor) dice rolling program using Ephemeral Rollups and MagicBlock's verifiable random function (VRF) to generate random numbers.

For the Anchor-based variant and frontend demo, see [Roll Dice](../anchor/README.md).

## VRF Flow

The dice account is delegated to the Ephemeral Rollup. On the ER, the program requests randomness from the VRF oracle with a client seed; the oracle fulfills the request by invoking the program's callback instruction with verified random bytes, which become the dice roll.

## Software Packages

| Software   | Version | Installation Guide                                      |
| ---------- | ------- | ------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)     |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)  |

```sh
agave-install init 3.1.9
rustup install 1.89.0
```

## Build and Test

Install dependencies and build the program:

```bash
yarn
yarn build
```

This example runs against a **local MagicBlock cluster** — a base Solana validator, an Ephemeral Rollup fronted by the Query Filtering Service, and a VRF oracle that fulfills randomness requests. Start it in one terminal and leave it running:

```bash
yarn setup
```

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh pinocchio-roll-dice` from the repo root: it builds this example, boots the validators and VRF oracle, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.
