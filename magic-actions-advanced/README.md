# ✨ Magic Actions Advanced

Combines two advanced magic-action patterns in one program:

1. **Post-delegation actions** — an `increment` instruction is queued in the delegation payload and fired automatically by the ER validator when the counter account is first cloned. No separate increment transaction required.

2. **PDA-paid magic action commits** — a protocol-owned `global_signer` PDA acts as the shared escrow authority, so the *protocol* pays the magic-action fee instead of the user's wallet.

## Flow

```
initialize                    → create Counter (0) + Leaderboard (0) on base
delegate                      → counter delegated to ER; post-delegation increment fires (counter = 1)
increment (ER)                → explicit increment on ER (counter = 2)
commitAndUpdateLeaderboard    → commit counter from ER; fire update_leaderboard on base
                                via global_signer PDA escrow; leaderboard high score = 2
undelegate                    → counter committed back to base; delegation ended
```

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

## Build and Test

Run the tests with existing program:

```bash
anchor test --skip-deploy --skip-build --skip-local-validator
```

Build, deploy and run the tests with new program (note: delete keypairs in `target/deploy` folder):

```bash
# Delete keypairs in the deploy folder
rm -rf target/deploy/*.keypair

# Build, deploy and test program
anchor test
```
