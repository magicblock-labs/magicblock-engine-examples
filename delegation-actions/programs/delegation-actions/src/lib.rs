use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::InstructionData;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::{delegate_account_with_actions, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::dlp_api::compact::ClearText;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("7utsCSeoSCMkFPXESmKPrAHrVqTaeTepfhXerSf8DWEh");

pub const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod delegation_actions {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        msg!("Counter Initialized!");
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Delegate the counter to the Ephemeral Rollup AND attach a post-delegation
    /// action. The action is stored in the delegation record on the base layer
    /// and executed automatically by the ER validator inside the rollup, right
    /// after the account is delegated — no extra transaction required.
    ///
    /// Here the action is a self-CPI back into `increment`, so the counter lands
    /// in the ER already incremented to 1.
    pub fn delegate_with_actions(ctx: Context<DelegateCounter>) -> Result<()> {
        let counter_key = ctx.accounts.pda.key();

        // The instruction the ER validator runs post-delegation, inside the rollup.
        let increment_action = Instruction {
            program_id: crate::ID,
            accounts: vec![AccountMeta::new(counter_key, false)],
            data: crate::instruction::Increment {}.data(),
        };

        // Convert to the compact, cleartext post-delegation actions payload.
        // (Use `cleartext` for public actions; encrypted actions are built
        // off-chain by a client that holds the validator key.)
        let actions = vec![increment_action].cleartext();

        let payer = ctx.accounts.payer.to_account_info();
        let pda = ctx.accounts.pda.to_account_info();
        let delegate_accounts = DelegateAccounts {
            payer: &payer,
            pda: &pda,
            owner_program: &ctx.accounts.owner_program,
            buffer: &ctx.accounts.buffer_pda,
            delegation_record: &ctx.accounts.delegation_record_pda,
            delegation_metadata: &ctx.accounts.delegation_metadata_pda,
            delegation_program: &ctx.accounts.delegation_program,
            system_program: &ctx.accounts.system_program,
        };

        delegate_account_with_actions(
            delegate_accounts,
            &[COUNTER_SEED],
            DelegateConfig {
                // Optionally set a specific validator from the first remaining account
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
            actions,
            // No extra signers are required by the increment action.
            &[],
        )?;
        Ok(())
    }

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
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCounter<'info> {
    pub payer: Signer<'info>,
    #[account(mut, del)]
    /// CHECK: the counter pda
    pub pda: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateCounter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub count: u64,
}
