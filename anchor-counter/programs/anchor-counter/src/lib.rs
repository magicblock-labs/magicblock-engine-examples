use anchor_lang::prelude::*;
use delegation_program_sdk::{delegate, delegate_account, trigger_commit};

declare_id!("852a53jomx7dGmkpbFPGXNJymRxywo3WsH1vusNASJRr");

pub const TEST_PDA_SEED: &[u8] = b"test-pda";

#[delegate]
#[program]
pub mod anchor_counter {
    use super::*;

    /// Initialize the counter.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        Ok(())
    }

    /// Increment the counter.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        Ok(())
    }

    /// Increment the counter + manual commit the account in the ER.
    pub fn increment_and_commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        trigger_commit(
            &ctx.accounts.payer,
            &ctx.accounts.counter.to_account_info(),
            &ctx.accounts.magic_program)?;
        Ok(())
    }

    /// Allow undelegation if the counter is greater than 0.
    pub fn allow_undelegation(ctx: Context<AllowUndelegation>) -> Result<()> {
        let counter =
            Counter::try_deserialize_unchecked(&mut (&**ctx.accounts.counter.try_borrow_data()?))?;
        if counter.count > 0 {
            msg!("Counter is greater than 0, undelegation is allowed");
            delegation_program_sdk::allow_undelegation(
                &ctx.accounts.counter,
                &ctx.accounts.delegation_record,
                &ctx.accounts.delegation_metadata,
                &ctx.accounts.buffer,
                &ctx.accounts.delegation_program,
                &id(),
            )?;
        }
        Ok(())
    }

    /// Delegate the account to the delegation program
    pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
        let pda_seeds: &[&[u8]] = &[TEST_PDA_SEED];

        delegate_account(
            &ctx.accounts.payer,
            &ctx.accounts.pda,
            &ctx.accounts.owner_program,
            &ctx.accounts.buffer,
            &ctx.accounts.delegation_record,
            &ctx.accounts.delegation_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            pda_seeds,
            0,
            30000,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + 8, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK The pda to delegate
    #[account(mut)]
    pub pda: AccountInfo<'info>,
    /// CHECK: The program that owns the pda
    pub owner_program: AccountInfo<'info>,
    /// CHECK The temporary buffer account used during delegation
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: The delegation record account
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: The seeds to create the delegate account
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: The delegation program ID
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: The system program
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AllowUndelegation<'info> {
    #[account(seeds = [TEST_PDA_SEED], bump)]
    /// CHECK: The counter pda
    pub counter: AccountInfo<'info>,
    #[account()]
    /// CHECK: delegation record
    pub delegation_record: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: delegation metadata
    pub delegation_metadata: AccountInfo<'info>,
    #[account()]
    /// CHECK: singer buffer to enforce CPI
    pub buffer: AccountInfo<'info>,
    #[account()]
    /// CHECK:`
    pub delegation_program: AccountInfo<'info>,
}

/// Account for the increment instruction.
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

/// Account for the increment instruction + manual commit.
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
    /// CHECK:`
    pub magic_program: AccountInfo<'info>,
}

#[account]
pub struct Counter {
    pub count: u64,
}
