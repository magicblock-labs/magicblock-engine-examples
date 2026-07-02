# ➕ Rewards with Delegated VRF

Anchor rewards program that mints random rewards on an Ephemeral Rollup using MagicBlock's verifiable random function (VRF).

## VRF Flow

A reward account is delegated to the Ephemeral Rollup. On the ER, the program requests randomness from the VRF oracle; the oracle fulfills the request by invoking the program's callback instruction with verified random bytes, which the program uses to determine the reward. State is then committed back to the base layer.

## Software Packages

This program has utilized the following software packages.

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
agave-install init 3.1.9
rustup install 1.89.0
avm use 1.0.2
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

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh rewards-delegated-vrf` from the repo root: it builds this example, boots the validators and VRF oracle, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

## Stress Test

To exercise repeated VRF requests, run the stress test (requests a random reward 100 times):

```bash
yarn test:stress
```

## Notes

You may need to update the example program id and authority:

```rust
declare_id!("HuGRGfqr7BNdeogipmidXL21PjF4qSoXFDaCBhetviwZ");
pub const PROGRAM_AUTHORITY: Pubkey = pubkey!("EyBRt4Acr7b4s3exfnVvJ4EgL8oa6Lc4JK1Leonud34W");
```
