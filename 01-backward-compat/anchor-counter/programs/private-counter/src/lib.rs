use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CommitAndUndelegatePermissionCpiBuilder, CreatePermissionCpiBuilder,
    DelegatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs, PERMISSION_SEED};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("7Y2rYVGqRY31m7ogMHjmtdRMUjeWakoJ6iVx12i6voCY");

pub const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod private_counter {

    use super::*;

    /// Initialize the counter.
    /// ANYONE can invoke_signed, may want to set checks/guards
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Increment the counter.
    /// ANYONE can invoke_signed, may want to set checks/guards
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        if counter.count > 1000 {
            counter.count = 0;
        }
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Delegate the account to the delegation program
    /// ANYONE can invoke_signed, may want to set checks/guards
    pub fn delegate(
        ctx: Context<DelegateCounterPrivately>,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        // Optionally set a specific validator from the accounts struct
        let validator = ctx.accounts.validator.as_ref();
        // 1. Create / Update the permission account BEFORE delegating (skip if already exists).
        if ctx.accounts.permission.data_is_empty() {
            CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
                .permissioned_account(&ctx.accounts.counter.to_account_info())
                .permission(&ctx.accounts.permission.to_account_info())
                .payer(&ctx.accounts.payer.to_account_info())
                .system_program(&ctx.accounts.system_program.to_account_info())
                .args(MembersArgs { members })
                .invoke_signed(&[&[COUNTER_SEED, &[ctx.bumps.counter]]])?;
        } else {
            UpdatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .authority(&ctx.accounts.payer.to_account_info(), true)
                .permissioned_account(&ctx.accounts.counter.to_account_info(), true)
                .permission(&ctx.accounts.permission.to_account_info())
                .args(MembersArgs { members })
                .invoke_signed(&[&[COUNTER_SEED, &[ctx.bumps.counter]]])?;
        }
        // 2. Register permission delegation BEFORE delegating the counter (skip if already delegated).
        if ctx.accounts.permission.owner != &ephemeral_rollups_sdk::id() {
            DelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .permissioned_account(&ctx.accounts.counter.to_account_info(), true)
                .permission(&ctx.accounts.permission.to_account_info())
                .payer(&ctx.accounts.payer.to_account_info())
                .authority(&ctx.accounts.counter.to_account_info(), false)
                .system_program(&ctx.accounts.system_program.to_account_info())
                .owner_program(&ctx.accounts.permission_program.to_account_info())
                .delegation_buffer(&ctx.accounts.buffer_permission.to_account_info())
                .delegation_metadata(
                    &ctx.accounts
                        .delegation_metadata_permission
                        .to_account_info(),
                )
                .delegation_record(&ctx.accounts.delegation_record_permission.to_account_info())
                .delegation_program(&ctx.accounts.delegation_program.to_account_info())
                .validator(validator)
                .invoke_signed(&[&[COUNTER_SEED, &[ctx.bumps.counter]]])?;
        }
        // 3. Delegate the counter (skip if already delegated).
        if ctx.accounts.counter.owner != &ephemeral_rollups_sdk::id() {
            ctx.accounts.delegate_counter(
                &ctx.accounts.payer,
                &[COUNTER_SEED],
                DelegateConfig {
                    validator: validator.map(|v| v.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    /// Manual commit the account in the ER.
    /// ANYONE can invoke_signed, may want to set checks/guards
    pub fn commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        // ANYONE can commit through invoke_signed, may want to set checks/guards
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Commit and undelegate BOTH the permission account and the counter in one
    /// atomic ER transaction.
    ///
    /// Step 1 releases the permission account via the Permission Program.
    /// Step 2 commits + undelegates the counter via the ephemeral rollups SDK.
    /// Both intents are scheduled on `magic_context` and applied together when
    /// the ER transaction is sealed back to the base layer.
    pub fn undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
        // 1. Commit and undelegate the permission account
        CommitAndUndelegatePermissionCpiBuilder::new(
            &ctx.accounts.permission_program.to_account_info(),
        )
        .authority(&ctx.accounts.payer.to_account_info(), true)
        .permissioned_account(&ctx.accounts.counter.to_account_info(), true)
        .permission(&ctx.accounts.permission.to_account_info())
        .magic_context(&ctx.accounts.magic_context.to_account_info())
        .magic_program(&ctx.accounts.magic_program.to_account_info())
        .invoke_signed(&[&[COUNTER_SEED, &[ctx.bumps.counter]]])?;

        // 2. Commit and undelegate the counter
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Increment the counter + manual commit the account in the ER.
    /// ANYONE can invoke_signed, may want to set checks/guards
    pub fn increment_and_commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        counter.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Increment the counter + commit and undelegate both the permission account
    /// and the counter in one atomic ER transaction.
    pub fn increment_and_undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        // Serialize the Anchor counter account before the commit+undelegate CPIs
        counter.exit(&crate::ID)?;

        // 1. Commit and undelegate the permission account
        CommitAndUndelegatePermissionCpiBuilder::new(
            &ctx.accounts.permission_program.to_account_info(),
        )
        .authority(&ctx.accounts.payer.to_account_info(), true)
        .permissioned_account(&ctx.accounts.counter.to_account_info(), true)
        .permission(&ctx.accounts.permission.to_account_info())
        .magic_context(&ctx.accounts.magic_context.to_account_info())
        .magic_program(&ctx.accounts.magic_program.to_account_info())
        .invoke_signed(&[&[COUNTER_SEED, &[ctx.bumps.counter]]])?;

        // 2. Commit and undelegate the counter
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Add delegate function to the context
#[delegate]
#[derive(Accounts)]
pub struct DelegateCounterPrivately<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The PDA to delegate
    #[account(mut, del, seeds = [COUNTER_SEED], bump)]
    pub counter: AccountInfo<'info>,
    /// CHECK: Permission account for the counter PDA
    #[account(mut, seeds = [PERMISSION_SEED, counter.key().as_ref()], bump, seeds::program = permission_program.key())]
    pub permission: AccountInfo<'info>,
    /// CHECK: Buffer for permission delegation
    #[account(mut, seeds = [ephemeral_rollups_sdk::pda::DELEGATE_BUFFER_TAG, permission.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub buffer_permission: AccountInfo<'info>,
    /// CHECK: Delegation record for permission
    #[account(mut, seeds = [ephemeral_rollups_sdk::pda::DELEGATION_RECORD_TAG, permission.key().as_ref()], bump, seeds::program = ephemeral_rollups_sdk::id())]
    pub delegation_record_permission: AccountInfo<'info>,
    /// CHECK: Delegation metadata for permission
    #[account(mut, seeds = [ephemeral_rollups_sdk::pda::DELEGATION_METADATA_TAG, permission.key().as_ref()], bump, seeds::program = ephemeral_rollups_sdk::id())]
    pub delegation_metadata_permission: AccountInfo<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
}

/// Account for the increment instruction.
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

/// Account context for commit-only operations (commit, increment_and_commit).
#[commit]
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

/// Account context for combined undelegate operations.
/// Includes the permission account + Permission Program so the single
/// instruction can release both the permission and the counter atomically.
#[commit]
#[derive(Accounts)]
pub struct UndelegateCounter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    /// CHECK: Checked by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, counter.key().as_ref()], bump, seeds::program = permission_program.key())]
    pub permission: AccountInfo<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

#[account]
pub struct Counter {
    pub count: u64,
}
