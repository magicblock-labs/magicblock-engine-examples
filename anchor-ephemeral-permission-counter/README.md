# 🔒 Anchor Ephemeral Permission Counter

Counter program using Anchor, Ephemeral Rollups, and **private ephemeral permissions**. The counter PDA is delegated to the ER; access to delegated state is gated by an on-rollup permission account that only the counter authority (and configured members) can use.

## Overview

| Layer | What happens |
| ----- | ------------ |
| **Solana (base)** | `initialize`, `increment`, `delegate` |
| **Ephemeral Rollup** | `initialize_permission`, `increment`, `update_permission`, `close_permission`, `commit`, `increment_and_commit`, `increment_and_undelegate` |

The test suite in `tests/private-counter.ts` walks through the full lifecycle: base-layer setup, delegation to the TEE validator, private permission management on the ER, commits back to Solana, and atomic commit+undelegate.

## Software Packages

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 2.3.13  | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.85.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 0.32.1  | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
# Check and initialize your Solana version
agave-install list
agave-install init 2.3.13

# Check and initialize your Rust version
rustup show
rustup install 1.85.0

# Check and initialize your Anchor version
avm list
avm use 0.32.1
```

## Environment

Copy `.env.example` to `.env` and set endpoints as needed:

```bash
cp .env.example .env
```

| Variable | Description |
| -------- | ----------- |
| `PROVIDER_ENDPOINT` | Base-layer RPC (default: devnet) |
| `TEE_PROVIDER_ENDPOINT` | Ephemeral Rollup / TEE RPC (default: MagicBlock devnet TEE) |
| `TEE_WS_ENDPOINT` | Optional WebSocket for the TEE connection |

Fund the wallet in `Anchor.toml` (`~/.config/solana/id.json` by default) on the cluster you use.

## Build and Test

Install dependencies and run tests against an already-deployed program (skips local validator and deploy):

```bash
yarn
anchor test --skip-deploy --skip-build --skip-local-validator
```

Build, deploy, and run the full test flow (regenerate program keypair if you need a fresh program id):

```bash
rm -rf target/deploy/*.json
anchor test
```

Or use the package script (same as above, skip deploy):

```bash
yarn test
```

## Program Instructions

### Base layer

- **`initialize`** — Creates the counter PDA (`seeds = ["counter", authority]`) and prefunds rent for the future permission account.
- **`increment`** — Increments the counter on Solana (only while not delegated).
- **`delegate`** — Delegates the counter PDA to Ephemeral Rollups (optionally pins a `validator`).

### Ephemeral Rollup

- **`initialize_permission`** — Creates a **private** permission account; initial member is the counter authority with transaction visibility flags.
- **`update_permission`** — Replaces permission members (example test uses a new pubkey).
- **`close_permission`** — Closes the permission account on the ER.
- **`increment`** — Low-latency increment on the delegated counter.
- **`commit`** — Commits counter state from ER to Solana via `MagicIntentBundleBuilder`.
- **`increment_and_commit`** — Increment + commit in one ER transaction.
- **`increment_and_undelegate`** — Increment + commit and undelegate the counter back to the owner program.

## Delegate the counter

Delegation uses the SDK `#[delegate]` macro and `delegate_counter` on the accounts struct:

```rust
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

#[delegate]
#[derive(Accounts)]
pub struct DelegateCounterPrivately<'info> {
    pub authority: Signer<'info>,
    #[account(mut, del, seeds = [COUNTER_SEED, authority.key().as_ref()], bump)]
    pub counter: AccountInfo<'info>,
    // ...
}

pub fn delegate(ctx: Context<DelegateCounterPrivately>) -> Result<()> {
    if ctx.accounts.counter.owner != &ephemeral_rollups_sdk::id() {
        ctx.accounts.delegate_counter(
            &ctx.accounts.authority,
            &[COUNTER_SEED, ctx.accounts.authority.key().as_ref()],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
    }
    Ok(())
}
```

On the client, delegate from the base layer and optionally pin a TEE validator:

```typescript
await program.methods
  .delegate()
  .accounts({
    authority: provider.wallet.publicKey,
    validator: new web3.PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
  })
  .rpc();
```

## Ephemeral permissions

Permissions are created on the ER after delegation. The program CPIs into the permission program with `is_private: true` and signs as the counter PDA:

```rust
CreateEphemeralPermissionCpi {
    payer: ctx.accounts.counter.to_account_info(),
    permissioned_account: ctx.accounts.counter.to_account_info(),
    permission: ctx.accounts.permission.to_account_info(),
    // ...
    args: EphemeralMembersArgs {
        is_private: true,
        members: vec![Member {
            flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
            pubkey: ctx.accounts.counter.authority,
        }],
    },
}
.invoke_signed(&[&signers])?;
```

Derive the permission PDA from the counter account with the TypeScript SDK:

```typescript
import {
  permissionPdaFromAccount,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const permissionPDA = permissionPdaFromAccount(counterPDA);

await program.methods
  .initializePermission()
  .accountsPartial({
    counter: counterPDA,
    permission: permissionPDA,
    magicProgram: MAGIC_PROGRAM_ID,
    permissionProgram: PERMISSION_PROGRAM_ID,
    ephemeralVault: VAULT_ID,
  })
  .rpc();
```

Send ER transactions through a separate `AnchorProvider` connected to the TEE endpoint. The test fetches a TEE auth token when using `*.tee.*` URLs.

## Execute transactions on the ER

```typescript
let tx = await program.methods
  .increment()
  .accounts({ counter: counterPDA })
  .transaction();

tx.feePayer = providerEphemeralRollup.wallet.publicKey;
tx.recentBlockhash = (
  await providerEphemeralRollup.connection.getLatestBlockhash()
).blockhash;
tx = await providerEphemeralRollup.wallet.signTransaction(tx);

const sig = await providerEphemeralRollup.sendAndConfirm(tx);
```

Commit state to Solana and wait for the base-layer commitment signature:

```typescript
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";

const erSig = await providerEphemeralRollup.sendAndConfirm(commitTx);
const baseSig = await GetCommitmentSignature(
  erSig,
  providerEphemeralRollup.connection,
);
```

## Undelegate

This example undelegates via the on-chain `increment_and_undelegate` instruction, which uses `MagicIntentBundleBuilder::commit_and_undelegate` in one atomic ER transaction—not a standalone `createUndelegateInstruction` on the base layer.

```typescript
await program.methods
  .incrementAndUndelegate()
  .accountsPartial({
    payer: providerEphemeralRollup.wallet.publicKey,
    counter: counterPDA,
  })
  .rpc();
```

## Dependencies

- **Rust:** `ephemeral-rollups-sdk` with `anchor`, `disable-realloc`, and `access-control` features (see `programs/private-counter/Cargo.toml`).
- **TypeScript:** `@magicblock-labs/ephemeral-rollups-sdk` (see `package.json`).

Read more about Ephemeral Rollups in the [MagicBlock docs](https://docs.magicblock.gg/EphemeralRollups/ephemeral_rollups).
