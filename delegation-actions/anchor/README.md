# ✨ Delegation Actions

Demonstrates **post-delegation actions**: instructions attached to a delegation
that the Ephemeral Rollup (ER) validator runs automatically inside the rollup,
right after an account is delegated — with no extra transaction.

In this example a counter is delegated with `delegate_with_actions`. The attached
action is a self-CPI back into `increment`, so the counter lands in the ER
already incremented to `1`.

## How it works

1. `initialize` creates the counter PDA on the base layer (`count = 0`).
2. `delegate_with_actions` delegates the counter **and** attaches an `increment`
   action. On the base layer the [delegation program] stores the action payload
   inside the delegation record; it does not run it.
3. The ER validator clones the delegated account into the rollup and executes the
   stored action there — so the ER counter becomes `1` automatically.
4. From then on the counter behaves like any delegated account: run low-latency
   `increment` transactions on the ER, then `undelegate` to commit state back.

The action is built **on-chain** and serialized into the compact
`PostDelegationActions` payload via `.cleartext()`:

```rust
let increment_action = Instruction {
    program_id: crate::ID,
    accounts: vec![AccountMeta::new(counter_key, false)],
    data: crate::instruction::Increment {}.data(),
};
let actions = vec![increment_action].cleartext();

delegate_account_with_actions(
    delegate_accounts,
    &[COUNTER_SEED],
    DelegateConfig { /* optional validator */ ..Default::default() },
    actions,
    &[], // no extra signers required by the action
)?;
```

> `cleartext` actions are public. For private/encrypted actions (executed by a
> trusted validator that holds the decryption key), the payload is built
> off-chain by a client with the validator's key.

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
network. The suite tests a post-delegation action, base and Ephemeral Rollup increments, and
undelegation.

A Rust MagicSVM suite lives in `tests-magicsvm-rs/` (needs a nightly toolchain): `yarn test:magicsvm:rs`.

[delegation program]: https://github.com/magicblock-labs/delegation-program
