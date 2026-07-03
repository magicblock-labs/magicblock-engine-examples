# 🪄 Magic Gachapon

MagicBlock VRF gachapon demo that mints a Metaplex Core NFT reward.

The Anchor program keeps one machine PDA with four weighted reward templates.
`pull` requests MagicBlock VRF randomness, and the `consume_pull` callback mints
one Metaplex Core asset directly to the player using the selected reward
template.

## VRF Flow

This is a base-layer VRF example, not a delegated Ephemeral Rollup flow.

1. The frontend creates or reuses a local devnet demo wallet.
2. The frontend derives a deterministic `machine_id` from that wallet pubkey, so
   each wallet sets up one machine.
3. `init` creates the machine, treasury PDA, and Core update-authority PDA.
4. `upload_config` writes the four weighted NFT templates.
5. `pull` transfers the `0.01 SOL` pull fee to the treasury and requests VRF.
6. The MagicBlock VRF callback invokes `consume_pull`.
7. The program validates the VRF program identity signer and mints a deterministic
   Metaplex Core asset PDA for the player.

## Current Devnet Demo

| Item | Value |
| --- | --- |
| Program ID | `5q1a1rA56zJTmEUeNdceFGPR6QQRWYmFJjckucTadnDd` |
| Solana RPC | `https://rpc.magicblock.app/devnet` |
| VRF program | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` |
| VRF queue | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` |
| Metaplex Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` |

The frontend uses MagicBlock's Solana devnet RPC,
`https://rpc.magicblock.app/devnet`. ER endpoints such as
`https://devnet.magicblock.app`, `https://devnet-as.magicblock.app/`, and
`https://devnet-us.magicblock.app` are for delegated-account examples.

## Software Packages

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.6   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.85.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 0.32.1  | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
agave-install init 3.1.6
rustup install 1.85.0
avm use 0.32.1
```

## Build and Test

Install dependencies and build the program:

```bash
yarn install
anchor build
```

Run the local Anchor tests:

```bash
anchor test
```

The default tests cover initialization, config upload, authorization, and PDA
derivation. Live VRF and Metaplex Core tests require devnet.

After deploying to devnet, run the live request smoke test:

```bash
yarn test:devnet:smoke
```

Run the full devnet e2e cycle:

```bash
yarn test:devnet:e2e
```

## 🚀 Launch the Frontend

To start the frontend application locally:

```bash
cd gachapon-example/app
npm install
npm run dev
```

The application will be available at `http://localhost:3000` or another port if
3000 is already in use.

The app uses a local demo wallet pattern like the Roll Dice example. It stores a
generated devnet keypair in browser `localStorage` under `solanaKeypair`; this is
for demos only, not production wallet custody.

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
solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/gachapon_example-keypair.json
anchor build
anchor deploy --provider.cluster devnet
```

After deploy, rebuild or restart the frontend so it uses the new program ID.
