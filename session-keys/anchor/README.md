# 🔑 Session Keys

Counter program using Anchor and Ephemeral Rollups, authorized with session keys so a temporary signer can act on behalf of the counter authority without re-signing every transaction.

🌐 **Live demo:** https://counter-session-keys-example.magicblock.app

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

Run the tests in-process with [MagicSVM](https://github.com/magicblock-labs/magicsvm):

```bash
yarn test
```

MagicSVM simulates the base layer and the Ephemeral Rollup in one process: no validators, no
network. The suite creates and revokes a session while exercising counter delegation, commits, and
undelegation through that session.

A Rust MagicSVM suite lives in `tests-magicsvm-rs/` (needs a nightly toolchain): `yarn test:magicsvm:rs`.

## 🔑 Session Keys

A session key is a short-lived keypair that a user authorizes once, then uses to sign subsequent transactions without prompting the wallet each time — ideal for the high-frequency, low-latency transactions an Ephemeral Rollup enables.

Instructions are guarded with `#[session_auth_or(...)]` from the `session-keys` crate, which authorizes the call when either the real counter authority signs, or a valid `SessionTokenV2` is presented:

```rust
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

#[session_auth_or(
    ctx.accounts.counter.authority.key() == ctx.accounts.payer.key(),
    SessionError::InvalidToken
)]
pub fn increment(ctx: Context<Increment>) -> Result<()> {
    let counter = &mut ctx.accounts.counter;
    counter.count += 1;
    Ok(())
}
```

On the client, a session token is created and managed with the Gum SDK's `SessionTokenManager`, and the session keypair signs the rollup transactions:

```typescript
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";

const sessionKeypair = initializeSessionSignerKeypair();
const sessionTokenManager = new SessionTokenManager(
  provider.wallet,
  provider.connection,
);
```

## 📤 Delegate, Commit, Undelegate

The counter PDA is delegated to the Ephemeral Rollup so it can be mutated with low latency, then committed/undelegated back to the base layer:

- `delegate` — transfers the PDA to the delegation program (validator can be pinned via the first remaining account).
- `commit` / `increment_and_commit` — commits ER state back to the base layer via `MagicIntentBundleBuilder`.
- `undelegate` — commits and returns ownership of the PDA to the program.

The `advanced-magic.ts` test exercises these flows end-to-end against the local cluster.
