use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};

declare_id!("6avjV8kWVhVf2NX6ZeE7SaqyqjRnCD6JDwhiUH6yFymz");

pub const COUNTER_SEED: &[u8] = b"counter";

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ScheduleIncrementArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64,
    pub iterations: i64,
}

#[ephemeral]
#[program]
pub mod anchor_counter {
    use super::*;

    /// Initialize the counter.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Increment the counter.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        if counter.count > 1000 {
            counter.count = 0;
        }
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    // Schedules crank for increment counter
    pub fn schedule_increment<'info>(
        ctx: Context<'info, ScheduleIncrement<'info>>,
        args: ScheduleIncrementArgs,
    ) -> Result<()> {
        let increment_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![AccountMeta::new(ctx.accounts.counter.key(), false)],
            data: anchor_lang::InstructionData::data(&crate::instruction::Increment {}),
        };

        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &&ctx.accounts.magic_program,
            instruction_accounts: &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.counter.to_account_info(),
            ],
            args: ScheduleTaskArgs {
                task_id: args.task_id,
                execution_interval_millis: args.execution_interval_millis,
                iterations: args.iterations,
                instructions: vec![increment_ix],
            },
        }
        .invoke()?;

        Ok(())
    }

    /// Delegate the account to the delegation program
    /// Set specific validator based on ER, see https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/local-setup
    pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[COUNTER_SEED],
            DelegateConfig {
                // Optionally set a specific validator from the first remaining account
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Undelegate the account from the delegation program
    pub fn undelegate(ctx: Context<UndelegateInput>) -> Result<()> {
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
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK The pda to delegate
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
}

/// Account for the increment instruction.
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

/// Account for the increment instruction + manual commit.
#[commit]
#[derive(Accounts)]
pub struct UndelegateInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub count: u64,
}

#[derive(Accounts)]
pub struct ScheduleIncrement<'info> {
    /// CHECK: used for CPI
    #[account()]
    pub magic_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Passed to CPI - using UncheckedAccount to avoid Anchor re-serializing stale data after CPI
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
    /// CHECK: used for CPI
    pub program: UncheckedAccount<'info>,
}
