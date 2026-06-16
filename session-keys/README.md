# 🔑 Session Keys

Counter program using Anchor and Ephemeral Rollups, authorized with session keys so a temporary signer can act on behalf of the counter authority without re-signing every transaction.

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

This example runs against a **local MagicBlock cluster** — a base Solana validator plus an Ephemeral Rollup, fronted by the Query Filtering Service. Start it in one terminal and leave it running:

```bash
yarn setup
```

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh session-keys` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

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
