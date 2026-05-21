use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::crank::crank_signer_pda;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};

declare_id!("HetkBSVTbemvzJzcmnTS6Ge6LP9KVVXkbtdL6qguG2g9");

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
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Increment the counter.
    pub fn increment_permissioned(ctx: Context<IncrementPermissioned>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    // Schedules crank for increment counter
    pub fn schedule_increment(
        ctx: Context<ScheduleIncrement>,
        args: ScheduleIncrementArgs,
    ) -> Result<()> {
        let increment_ix = Instruction {
            program_id: crate::ID,
            accounts: crate::accounts::Increment {
                counter: *ctx.accounts.counter.key,
            }
            .to_account_metas(None),
            data: anchor_lang::InstructionData::data(&crate::instruction::Increment {}),
        };

        let schedule_ix = Instruction::new_with_bincode(
            MAGIC_PROGRAM_ID,
            &MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
                task_id: args.task_id,
                execution_interval_millis: args.execution_interval_millis,
                iterations: args.iterations,
                instructions: vec![increment_ix],
            }),
            vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.counter.key(), false),
            ],
        );

        invoke_signed(
            &schedule_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.counter.to_account_info(),
            ],
            &[],
        )?;

        Ok(())
    }

    // Schedules permissioned crank for increment counter
    pub fn schedule_increment_permissioned(
        ctx: Context<ScheduleIncrement>,
        args: ScheduleIncrementArgs,
    ) -> Result<()> {
        let increment_ix = Instruction {
            program_id: crate::ID,
            accounts: crate::accounts::IncrementPermissioned {
                counter: *ctx.accounts.counter.key,
                crank_signer: crank_signer_pda(ctx.accounts.counter.key),
            }
            .to_account_metas(None),
            data: anchor_lang::InstructionData::data(&crate::instruction::IncrementPermissioned {}),
        };

        let schedule_ix = Instruction::new_with_bincode(
            MAGIC_PROGRAM_ID,
            &MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
                task_id: args.task_id,
                execution_interval_millis: args.execution_interval_millis,
                iterations: args.iterations,
                instructions: vec![increment_ix],
            }),
            vec![
                AccountMeta::new(ctx.accounts.counter.key(), true), // Counter as authority
                AccountMeta::new(ctx.accounts.counter.key(), false),
            ],
        );

        let signer_seeds = [COUNTER_SEED, &[ctx.bumps.counter]];
        invoke_signed(
            &schedule_ix,
            &[
                ctx.accounts.counter.to_account_info(),
                ctx.accounts.counter.to_account_info(),
            ],
            &[&signer_seeds],
        )?;

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

/// Account for the increment instruction.
#[derive(Accounts)]
pub struct IncrementPermissioned<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(address = crank_signer_pda(&counter.key()))]
    pub crank_signer: Signer<'info>,
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
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Passed to CPI - using AccountInfo to avoid Anchor re-serializing stale data after CPI
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
    /// CHECK: used for CPI
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}
