use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use std::io::Write;
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;



declare_id!("5LomaZ9w94qfwvdDa1QhhCe41HYqrQTkdYfP39pX6LqH");


pub const COUNTER_SEED: &[u8] = b"counter";

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

    pub fn schedule_increment(ctx: Context<ScheduleIncrement>) -> Result<()> {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(b"global:increment");
        let hash = hasher.finalize();
        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&hash[..8]);

        let increment_instruction_data =
            anchor_lang::InstructionData::data(&crate::instruction::Increment {});
        
        let increment_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![AccountMeta::new(ctx.accounts.counter.key(), false),
                        ],
            data: discriminator.to_vec(),
        };

        msg!("Schedule increment instruction: {:?}", increment_ix);
        // call increment instruction
        invoke_signed(
            &increment_instruction_data,
            &[
                ctx.accounts.counter.to_account_info(),
                ctx.accounts.program.to_account_info(),
            ],
            &[],
        )?;
        
        let schedule_ix = Instruction {
            program_id: MAGIC_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*ctx.accounts.payer.key, true),
                AccountMeta::new(ctx.accounts.counter.key(), false),
            ],
            data: create_schedule_task_instruction_data(1, 100, 5, vec![increment_ix])?,
        };
        
        invoke_signed(
            &schedule_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.counter.to_account_info(),
                ctx.accounts.program.to_account_info(),
            ],
            &[],
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

    /// Manual commit the account in the ER.
    pub fn commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Undelegate the account from the delegation program
    pub fn undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Increment the counter + manual commit the account in the ER.
    pub fn increment_and_commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        counter.exit(&crate::ID)?;
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    /// Increment the counter + manual commit the account in the ER.
    pub fn increment_and_undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        // Serialize the Anchor counter account, commit and undelegate
        counter.exit(&crate::ID)?;
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
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
    pub pda: AccountInfo<'info>,
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
pub struct IncrementAndCommit<'info> {
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
    /// CHECK: asdf
    #[account()]
    pub magic_program: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    /// CHECK: asdf
    pub program: AccountInfo<'info>,
}

fn create_schedule_task_instruction_data(
    task_id: i64,
    execution_interval_millis: i64,
    iterations: i64,
    instructions: Vec<Instruction>,
) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    data.write_all(&6u32.to_le_bytes())?;
    data.write_all(&task_id.to_le_bytes())?;
    data.write_all(&execution_interval_millis.to_le_bytes())?;
    data.write_all(&iterations.to_le_bytes())?;
    data.write_all(&(instructions.len() as u64).to_le_bytes())?;
    
    for instruction in instructions {
        data.write_all(instruction.program_id.as_ref())?;
        data.write_all(&(instruction.accounts.len() as u64).to_le_bytes())?;
        for account_meta in instruction.accounts {
            data.write_all(account_meta.pubkey.as_ref())?;
            data.push(account_meta.is_signer as u8);
            data.push(account_meta.is_writable as u8);
        }
        data.write_all(&(instruction.data.len() as u64).to_le_bytes())?;
        data.write_all(&instruction.data)?;
    }
    
    Ok(data)
}
