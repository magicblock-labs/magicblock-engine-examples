# Post-Delegation Actions

Post-delegation actions let a base-layer delegation instruction carry ER-side
instructions that should execute after the account becomes delegated. This is
the opposite direction from Magic Actions:

- Post-delegation actions: submitted on base layer, executed on the ER after
  delegation/clone.
- Magic Actions / post-commit actions: submitted on the ER, executed on base
  layer after commit.

The examples in this repo currently use plain delegation plus separate ER
transactions. Real examples of post-delegation actions live in:

- `magicblock-labs/ephemeral-spl-token`
  - `e-token/src/processor/internal/shuttle_delegation.rs`
  - `e-token/src/processor/deposit_and_delegate_shuttle_ephemeral_ata_with_merge_and_private_transfer.rs`
  - `e-token/src/processor/sponsored_lamports_transfer.rs`
- `magicblock-labs/magicblock-validator`
  - `test-integration/test-cloning/tests/10_post_delegation_token_transfer.rs`
- `magicblock-labs/delegation-program`
  - `tests/test_delegate_with_actions.rs`

Version note: most examples in this repository depend on older
`ephemeral-rollups-sdk` versions that do not expose this pattern. The relevant
Rust helpers are present in newer SDK/delegation-program API code, notably
`dlp_api::instruction_builder::delegate_with_actions` and
`ephemeral_rollups_sdk::cpi::delegate_account_with_actions`.

## Mental Model

`delegate_with_actions` does not execute the action instructions during the
base-layer transaction. The base-layer delegation program validates the action
envelope and stores it after the normal `DelegationRecord` bytes in the
delegation record account.

When the delegated account is later cloned/fetched by the validator it was
delegated to, the validator reads the delegation record, parses the appended
`PostDelegationActions`, decrypts any encrypted parts with the validator
keypair, reconstructs normal Solana instructions, and executes them on the ER.

This means:

- The base-layer transaction must include the delegation and the action signer
  signatures.
- The action instructions must be valid against ER-visible accounts when they
  are executed.
- If nobody fetches/clones the delegated account, action execution may not be
  observed immediately.
- Actions encrypted for validator A are ignored by validator B.

## Client-Side Builder Pattern

For externally owned or system-owned accounts, use the delegation program API
builder:

```rust
use dlp_api::{
    args::DelegateArgs,
    instruction_builder::{
        delegate_with_actions, Encryptable, PostDelegationInstruction,
    },
};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
};

let validator: Pubkey = /* closest validator identity */;
let payer = Keypair::new();
let delegated_account = Keypair::new();
let action_authority = Keypair::new();

let action_ix: Instruction = Instruction {
    program_id: action_program,
    accounts: vec![
        AccountMeta::new(action_state, false),
        AccountMeta::new_readonly(action_authority.pubkey(), true),
    ],
    data: action_data,
};
let post_actions: Vec<PostDelegationInstruction> = vec![
    action_ix.cleartext(),
];

let delegate_ix = delegate_with_actions(
    payer.pubkey(),
    delegated_account.pubkey(),
    None, // owner program; None means system program
    DelegateArgs {
        commit_frequency_ms: u32::MAX,
        seeds: vec![],
        validator: Some(validator),
    },
    post_actions,
);

// The transaction needs the normal delegation signers plus every action signer.
// For the example above: payer, delegated_account, action_authority.
```

Use `.cleartext()` for public actions, `.encrypted()` for fully private actions,
or build `PostDelegationInstruction` manually when only part of the action
should be encrypted.

## On-Chain CPI Pattern

For PDA delegation from your program, prefer the Rust SDK CPI helper:

```rust
use ephemeral_rollups_sdk::cpi::{
    delegate_account_with_actions, DelegateAccounts, DelegateConfig,
};
use dlp_api::compact::ClearText;

let post_actions = vec![action_ix_a, action_ix_b].cleartext();

delegate_account_with_actions(
    DelegateAccounts {
        payer: &ctx.accounts.payer.to_account_info(),
        pda: &ctx.accounts.pda.to_account_info(),
        owner_program: &ctx.accounts.owner_program.to_account_info(),
        buffer: &ctx.accounts.delegation_buffer.to_account_info(),
        delegation_record: &ctx.accounts.delegation_record.to_account_info(),
        delegation_metadata: &ctx.accounts.delegation_metadata.to_account_info(),
        delegation_program: &ctx.accounts.delegation_program.to_account_info(),
        system_program: &ctx.accounts.system_program.to_account_info(),
    },
    &[b"your", b"pda", b"seeds"],
    DelegateConfig {
        validator: Some(validator),
        ..DelegateConfig::default()
    },
    post_actions,
    &[&ctx.accounts.action_authority.to_account_info()],
)?;
```

`action_signer_infos` must contain account infos for every unique signer used by
the post-delegation actions. The SDK adds them as readonly signer remaining
accounts to the delegation CPI.

## Building Actions

### Public actions

For a list of normal `Instruction`s:

```rust
use dlp_api::compact::ClearText;

let actions = vec![ix_a, ix_b].cleartext();
```

The helper compacts the instructions into:

- `signers`: all unique signer pubkeys used by the action instructions.
- `non_signers`: all unique non-signer pubkeys plus each action program id.
- `instructions`: compact program/account indices plus instruction data.

### Encrypted actions

For off-chain construction:

```rust
use dlp_api::instruction_builder::{Encryptable, EncryptableFrom, PostDelegationInstruction};

let action = PostDelegationInstruction {
    program_id: program_id.cleartext(),
    accounts: vec![
        AccountMeta::new(source, false).cleartext(),
        AccountMeta::new(destination, false).encrypted(),
        AccountMeta::new_readonly(authority, true).cleartext(),
    ],
    data: raw_ix_data.encrypted_from(1),
};
```

Important encryption constraints:

- Signers cannot be encrypted. The builder asserts this because the base-layer
  delegation transaction must prove their signatures.
- The `validator` field is required when using the builder because encrypted
  fields are encrypted to that validator's key.
- `encrypted_from(offset)` leaves `data[..offset]` public and encrypts the
  suffix. This is useful when the discriminator must remain public but the
  payload should be private.

### Merging caller-provided encrypted actions with on-chain actions

`ephemeral-spl-token` uses `cleartext_with_insertable` to insert an externally
provided encrypted action into an on-chain action list:

```rust
use dlp_api::compact::ClearTextWithInsertable;

let merged = vec![
    merge_shuttle_ix,
    fee_ix,
    undelegate_and_close_ix,
]
.cleartext_with_insertable(private_transfer_action, 1);
```

This is advanced. It preserves the encrypted action's existing key indices by
placing its keys first in the conceptual lookup table, then appending the new
cleartext keys. The implementation only supports one merge/insert level:
`insertable.inserted_signers` and `insertable.inserted_non_signers` must both be
zero before merging.

## Account And Signer Constraints

### Required delegation accounts

`delegate_with_actions` uses the same first seven accounts as normal delegation:

1. `payer`: writable signer.
2. `delegated_account`: writable signer.
3. `owner_program`: readonly.
4. `delegate_buffer`: writable PDA derived from delegated account and owner.
5. `delegation_record`: writable PDA derived from delegated account.
6. `delegation_metadata`: writable PDA derived from delegated account.
7. `system_program`: readonly.

Then it appends every unique action signer as a readonly signer remaining
account.

### Signer rules

Every pubkey in `PostDelegationActions.signers` must appear among the remaining
accounts and must be a signer in the base-layer transaction/CPI. The delegation
program checks this before storing the actions.

That signer proof is what authorizes the later ER execution. The action does
not require a separate ER transaction signed by the same keypair. When the
validator reconstructs the scheduled instruction, any account meta that was a
validated action signer is reconstructed with `is_signer: true`, so normal
program checks such as `AccountInfo::is_signer` / Anchor `Signer<'info>` see it
as signed on the ER action.

This is still not arbitrary signature forgery:

- Signer pubkeys cannot be encrypted.
- Every action signer must have signed the base-layer delegation transaction, or
  must have been marked signer by a valid CPI signer path.
- Encrypted account metas are decrypted and validated by the delegated
  validator before execution.
- If a target program verifies an ed25519 signature inside instruction data,
  that is a separate application-level signature and still needs to be present.

If an account is used as a signer in one action and as a non-signer in another,
the compaction helpers keep it in the signer table and OR the writable flag.

### Compact key table limit

The compact format packs the account index into six bits, so a post-delegation
action bundle can reference at most 64 unique pubkeys total:

```text
signers.len() + non_signers.len() <= 64
```

Program ids count too because each action program id is included in the compact
pubkey table.

### Signer/non-signer index validation

Cleartext account metas are checked on base layer:

- Program id index must be in range.
- Account meta index must be in range.
- A cleartext meta marked signer must point at a signer-table index.

Encrypted account metas can only be fully validated after the validator
decrypts them.

### PDA seed validation

For off-curve delegated accounts, the delegation program validates the provided
seeds. The current processor accepts up to eight seed slices. If the owner is
the system program, PDA validation is done against the delegation program,
allowing delegation of delegation-owned/system-style escrow accounts.

For on-chain CPI, the SDK helper derives/signs with the PDA seeds you pass, so
those seeds must exactly match the delegated PDA.

### Validator targeting

Always set `DelegateArgs.validator` or `DelegateConfig.validator` when using
post-delegation actions. It controls:

- Which validator receives the delegated account.
- Which public key encrypted action fields are encrypted for.

The validator only parses/decrypts actions for records delegated to itself.

## Funding And Runtime Constraints

Post-delegation actions do not use the Magic Actions base-layer escrow pattern.
There is no `escrow_authority`/`escrow_account` pair to derive, include, and
pre-fund for action execution.

Instead, make sure the ER-side action transaction can actually run:

- Any fee payer/signing authority required by the action must be included as an
  action signer in the delegation transaction.
- Any account created or funded by the action needs enough lamports/tokens
  available in the ER-visible state.
- Any account the action touches must be available to the ER validator. If it is
  not already present, the validator must be able to clone/fetch it.
- Writable action accounts do not all have to be delegated just to execute the
  action on the ER. They do need to be present and writable in the ER runtime.
  If their changes must persist back to base layer, they need an appropriate
  delegation/commit path; otherwise the changes are ER-local state.
- If an action depends on a freshly delegated account's state, remember the
  delegated account's cloned state comes from the delegation buffer copied
  during delegation.

`ephemeral-spl-token` handles funding by sponsoring setup with a rent PDA before
delegation, then scheduling post-delegation actions that run on the ER. For
example, sponsored lamports transfer creates/funds a temporary lamports PDA on
base, delegates it with actions, then schedules:

1. Transfer lamports from the delegated lamports PDA to the destination.
2. Undelegate/close the temporary lamports PDA.

## Difference From Magic Actions

Magic Actions need escrow setup because they schedule base-layer instructions
from an ER transaction. The base-layer action runner needs a fee/payment source,
so the action path has gotchas around `escrow_authority`, `escrow_account`,
derivation, inclusion, and prefunding.

Post-delegation actions are different:

- They are stored in the delegation record during the base-layer delegation.
- They execute on the ER when the delegated account is cloned/fetched.
- Required signer pubkeys are included as remaining accounts on the base-layer
  delegation instruction.
- Encrypted parts are encrypted to the validator selected in the delegate args.
- They do not require the Magic Actions escrow PDA pair.

## Failure Checklist

If a post-delegation action does not execute, check:

- Did the delegate transaction use `delegate_with_actions`, not plain
  `delegate`?
- Is `validator` set, and is it the validator that will clone/fetch the account?
- Did the base-layer transaction include every action signer?
- Is every action signer passed in `action_signer_infos` for CPI use?
- Does the compact key table have at most 64 unique pubkeys, including program
  ids?
- Are encrypted fields encrypted for the same validator in `DelegateArgs`?
- Are all cleartext signer flags consistent with the signer table?
- Are PDA seeds correct and no more than eight slices?
- Has the delegated account actually been fetched/cloned on the ER?
- Are all action accounts available/fetchable on the ER?
- For every writable account, is ER-local mutation enough, or does it need a
  delegation/commit path back to base layer?
- Does the action have enough lamports/tokens/funding on the ER side?
- If using `cleartext_with_insertable`, is this the first and only merge?
