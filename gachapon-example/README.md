# Gachapon Example

Anchor example for a simple Metaplex Core gachapon machine.

The program keeps one machine PDA with exactly four configurable reward
templates. `pull` requests VRF randomness and the `consume_pull` callback mints
one Metaplex Core asset directly to the caller using the selected reward
template.

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

## Run

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
