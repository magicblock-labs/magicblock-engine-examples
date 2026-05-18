use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{
            CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi,
        },
        structs::{EphemeralMembersArgs, EphemeralPermission, Member},
    },
    anchor::{commit, delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
};

declare_id!("CwhbYN9Pkn8QeVtpV5sEs1jMMmRs64nRus34zCUWNqzh");

pub const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod private_counter {

    use ephemeral_rollups_sdk::access_control::structs::{
        TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
    };

    use super::*;

    /// Initialize the counter.
    /// ANYONE can invoke_signed, may want to set checks/guards
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Transfer the rent for the permission
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.counter.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
        )?;

        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        counter.authority = ctx.accounts.authority.key();

        msg!(
            "PDA {} count: {} authority: {}",
            counter.key(),
            counter.count,
            counter.authority
        );
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
    pub fn delegate(ctx: Context<DelegateCounterPrivately>) -> Result<()> {
        // Optionally set a specific validator from the accounts struct
        let validator = ctx.accounts.validator.as_ref();

        if ctx.accounts.counter.owner != &ephemeral_rollups_sdk::id() {
            ctx.accounts.delegate_counter(
                &ctx.accounts.authority,
                &[COUNTER_SEED, ctx.accounts.authority.key().as_ref()],
                DelegateConfig {
                    validator: validator.map(|v| v.key()),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }

    /// Initialize the permission account.
    pub fn initialize_permission(ctx: Context<PermissionContext>) -> Result<()> {
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        Ok(CreateEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member {
                    flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
                    pubkey: ctx.accounts.counter.authority,
                }],
            },
        }
        .invoke_signed(&[&signers])?)
    }

    /// Update the permission account.
    pub fn update_permission(ctx: Context<PermissionContext>, new_member: Pubkey) -> Result<()> {
        msg!(
            "Updating permission for member: {:?}",
            EphemeralPermission::from_bytes(&ctx.accounts.permission.data.borrow())?.members
        );
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        Ok(UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.counter.to_account_info(),
            authority_is_signer: false, // The PDA is signing
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member {
                    flags: 0,
                    pubkey: new_member,
                }],
            },
        }
        .invoke_signed(&[&signers])?)
    }

    /// Update the permission account.
    pub fn close_permission(ctx: Context<PermissionContext>) -> Result<()> {
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        Ok(CloseEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.counter.to_account_info(),
            authority_is_signer: false, // The PDA is signing
        }
        .invoke_signed(&[&signers])?)
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

    /// Commit and undelegate the counter in one atomic ER transaction.
    pub fn undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
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
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + core::mem::size_of::<Counter>(),
        seeds = [COUNTER_SEED, authority.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Add delegate function to the context
#[delegate]
#[derive(Accounts)]
pub struct DelegateCounterPrivately<'info> {
    pub authority: Signer<'info>,
    /// CHECK: The PDA to delegate
    #[account(mut, del, seeds = [COUNTER_SEED, authority.key().as_ref()], bump)]
    pub counter: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
}

/// Account for the increment instruction.
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.as_ref()], bump)]
    pub counter: Account<'info, Counter>,
}

#[derive(Accounts)]
pub struct PermissionContext<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [COUNTER_SEED, counter.authority.as_ref()],
        has_one = authority,
        bump
    )]
    pub counter: Account<'info, Counter>,
    /// CHECK: verified by permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by permission program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: verified by permission program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Account context for commit-only operations (commit, increment_and_commit).
#[commit]
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.as_ref()], bump)]
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
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.as_ref()], bump)]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub count: u64,
    pub authority: Pubkey,
}
