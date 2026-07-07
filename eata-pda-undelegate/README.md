# eata-pda-undelegate — reproduction

Minimal reproduction of: **undelegating an ephemeral ATA (eATA) whose owner is a
_delegated account_ fails.**

## The bug

`ephemeral-spl-token` (`e-token`) `undelegate_ephemeral_ata` (commit
`c7e9fff`) forwards two `None`s to the ephemeral-rollups CPI:

```rust
ephemeral_rollups_pinocchio::instruction::commit_and_undelegate_accounts(
    payer,
    accounts,        // = [user ATA]
    magic_context,
    magic_program,
    None,            // <- magic_fee_vault
    None,            // <- signer_seeds
)
```

When the eATA's SPL authority (`payer`/`owner`) is **itself a delegated
account**, the magic program's `ScheduleCommit` requires a valid **validator
magic fee vault** to charge the commit against. Because e-token passes `None`,
the commit fails:

```
ScheduleCommit ERR: invalid magic fee vault account <pubkey>
Program Magic11111111111111111111111111111111111111 failed:
    An account required by the instruction is missing
```

A **wallet-owned** (non-delegated) eATA does not require a fee vault, so it
undelegates fine. This is what the `fix/undelegate-eata-fee-vault` branch
(`Some(magic_fee_vault)`) addresses.

## What the test does

Two flows that differ ONLY in whether the eATA owner is delegated:

| case | owner | result |
|------|-------|--------|
| `control` | a wallet keypair (not delegated) | undelegate **succeeds** (ER schedule + base commit) |
| `repro`   | this program's PDA, **delegated** to the ER | undelegate **fails** with `invalid magic fee vault account` |

The small on-chain program (`programs/eata-pda-undelegate`) exists only to:

1. `init_authority` / `delegate_authority` — create a PDA and delegate it to the
   ER, so the eATA's owner is a delegated account.
2. `undelegate_owned_eata` — CPI e-token's `undelegate` (`data = [5]`) with
   `invoke_signed`, so the PDA owner can sign.

Everything else (mint, ATA, eATA init/delegate) is done from the test client via
the `@magicblock-labs/ephemeral-rollups-sdk` helpers.

> Observed separately: a **non-delegated** program PDA owner undelegates fine —
> so the trigger is the owner being *delegated*, not that it is a PDA or that the
> call goes through a CPI. The `signer_seeds` `None` (the 2nd `None`) is not the
> blocker for this scenario; the `magic_fee_vault` `None` (the 1st `None`) is.

## Running

The reproduction runs against a real local MagicBlock cluster (base
`solana-test-validator` + `ephemeral-validator`).

> **Important:** it requires the **`e-token` build at commit `c7e9fff`** (the
> version that passes `None` for the fee vault) loaded at `SPLxh…`. The local
> cluster otherwise loads the version bundled with the `ephemeral-validator` npm
> package, which is a *different* build and does **not** reproduce the failure.
> `tests/fixtures/ephemeral_token_program.so` is the `c7e9fff` build, and
> `scripts/load-etoken.sh` swaps it into the validator's `local-dumps`:

```bash
./scripts/load-etoken.sh          # load the c7e9fff e-token (backs up the original)

# from the repo root, bring up the local cluster and run this example
yarn setup                        # start the validators
yarn test:local                   # run tests/eata-pda-undelegate.ts

./scripts/load-etoken.sh restore  # (optional) restore the bundled e-token
```

Expected: `2 passing` — the `control` succeeds and the `repro` fails exactly as
described above.

## Notes / limitations

- The failure surfaced here is the **magic fee vault `None`** (the 1st `None`).
  The `fix/undelegate-eata-fee-vault` working-tree change (`Some(magic_fee_vault)`,
  6-account layout) could **not** be verified against `ephemeral-validator`
  `0.13.2` locally: that validator's magic program does not understand the fee
  vault prefix and treats the passed vault as an account to undelegate
  (`account ... is required to be writable and delegated in order to be
  undelegated`). Verifying the fix needs a validator whose magic program
  supports the fee-vault prefix.
