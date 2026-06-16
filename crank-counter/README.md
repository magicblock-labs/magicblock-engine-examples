# ⚙️ Crank Counter

Simple counter program using Anchor and Ephemeral Rollups with scheduled cranks for automatic execution.

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

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh crank-counter` from the repo root: it builds this example, boots the validators, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster (without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the repo-root `./scripts/test-locally.sh` directly.

## ⏱️ Scheduling a Crank

This example schedules an instruction to run automatically on the Ephemeral Rollup. After delegating the counter PDA, the program's `schedule_increment` instruction CPIs into the MagicBlock magic program with a `ScheduleTask`, which repeatedly invokes `increment` on a fixed interval for a number of iterations — no client transaction needed per tick.

```rust
pub fn schedule_increment(
    ctx: Context<ScheduleIncrement>,
    args: ScheduleIncrementArgs, // task_id, execution_interval_millis, iterations
) -> Result<()> {
    let increment_ix = Instruction {
        program_id: crate::ID,
        accounts: vec![AccountMeta::new(ctx.accounts.counter.key(), false)],
        data: anchor_lang::InstructionData::data(&crate::instruction::Increment {}),
    };

    let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id: args.task_id,
        execution_interval_millis: args.execution_interval_millis,
        iterations: args.iterations,
        instructions: vec![increment_ix],
    }))?;
    // ... CPI into MAGIC_PROGRAM_ID with the serialized ScheduleTask
}
```
