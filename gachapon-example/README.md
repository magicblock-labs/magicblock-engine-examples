# Magic Gachapon

Anchor and Next.js demo for a MagicBlock VRF-powered gachapon machine.

The program keeps one machine PDA with exactly four configurable reward
templates. `pull` requests VRF randomness and the `consume_pull` callback mints
one Metaplex Core asset directly to the caller using the selected reward
template.

The frontend demonstrates the full demo flow:

- creates or reuses a local devnet demo wallet
- creates one gachapon machine for that wallet
- uploads four weighted reward templates once
- requests MagicBlock VRF randomness
- waits for the callback to mint a Metaplex Core NFT
- links each step to Solana Explorer

## Current Devnet Demo

| Item | Value |
| --- | --- |
| Program ID | `5q1a1rA56zJTmEUeNdceFGPR6QQRWYmFJjckucTadnDd` |
| Solana RPC | `https://rpc.magicblock.app/devnet` |
| VRF program | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` |
| VRF queue | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` |
| Metaplex Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` |
| Pull fee | `0.01 SOL` |

This demo uses MagicBlock's Solana devnet RPC,
`https://rpc.magicblock.app/devnet`, because the Gachapon flow runs on the base
layer and requests VRF from there. It does not submit transactions to an
Ephemeral Rollup endpoint such as `https://devnet.magicblock.app`,
`https://devnet-as.magicblock.app/`, or `https://devnet-us.magicblock.app`.
Those ER endpoints are for delegated-account execution examples.

## Frontend

```bash
cd gachapon-example/app
npm install
npm run dev
```

The app uses a local demo wallet pattern like the Roll Dice example. It
generates a devnet keypair in the browser and stores it in `localStorage` under
`solanaKeypair`. This is for demos only; do not use it as a production wallet
custody pattern.

Machine setup is deterministic per wallet. The contract still accepts
`init(machine_id: u64)`, and the frontend derives that `machine_id` from the
wallet pubkey, so each pubkey maps to one setup machine and can skip setup on
later pulls.

## Instructions

- `init(machine_id)` initializes a machine, treasury PDA, and Core update-authority PDA.
- `upload_config(rewards)` uploads four weighted NFT templates.
- `pull(pull_id, client_seed)` creates a pending pull and requests VRF.
- `consume_pull(randomness, pull_id)` is the VRF callback. It selects a weighted
  reward and creates the Core asset directly for the player.

The Core minting path follows the Colony program pattern:

- `CreateV2CpiBuilder`
- `Plugin::Attributes`
- PDA update authority
- fixed Core program id: `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`

Unlike Colony's planet mint, the callback cannot rely on a user signer. The
reward asset is therefore a deterministic PDA:

```text
["asset", machine, player, pull_id]
```

The program signs for that PDA during the Core CPI.

## MagicBlock VRF Notes

This example uses the same VRF request wire shape as
`ephemeral-vrf-sdk@0.2.x`, but inlines the small request instruction helper.
That keeps the program compatible with the Colony-style `mpl-core` dependency
set while preserving the MagicBlock requirements:

- use `DEFAULT_QUEUE` for this non-delegated base-layer example
- pass all callback accounts in `pull`
- validate `VRF_PROGRAM_IDENTITY` as the callback signer
- mint only in the callback after randomness is delivered

## Contract

```bash
cd gachapon-example
yarn install
anchor build
anchor test
```

The default tests cover initialization, config upload, and authorization. A full
`pull` smoke test needs the VRF and Metaplex Core programs available on the
target cluster.

After deploying to devnet, run the live request smoke test with:

```bash
yarn test:devnet:smoke
```

Run the full devnet e2e cycle with:

```bash
yarn test:devnet:e2e
```

The e2e test creates a fresh machine with placeholder reward URIs, requests VRF,
waits for the callback to settle the pull, and verifies the minted Core asset
owner, update authority, name, URI, and attributes.

## Deploying Your Own Program

Do not commit deploy keypairs. Anchor writes deploy keys to
`target/deploy/*-keypair.json`; this example ignores generated target files and
keypair JSON files.

To deploy your own copy, generate a new program keypair, update the program ID
in these files, then deploy:

- `programs/gachapon-example/src/lib.rs`
- `Anchor.toml`
- `app/lib/gachapon-devnet.ts`

```bash
cd gachapon-example
solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/gachapon_example-keypair.json
anchor build
anchor deploy --provider.cluster devnet
```

After deploy, rebuild or restart the frontend so it uses the new program ID.
