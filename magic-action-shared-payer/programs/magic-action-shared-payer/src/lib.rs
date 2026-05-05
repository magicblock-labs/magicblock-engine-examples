use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::anchor::{action, commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::ephem::{CallHandler, CommitType, MagicAction, MagicInstructionBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::solana_program::program::invoke_signed;

declare_id!("FBbFnb2LLyLomrSg3QMfMUMAQ8K4fsDUigpnwyjcLPnZ");

pub const COUNTER_SEED: &[u8] = b"counter";
pub const LEADERBOARD_SEED: &[u8] = b"leaderboard";
pub const GLOBAL_SIGNER_SEED: &[u8] = b"global_signer";

#[ephemeral]
#[program]
pub mod magic_action_shared_payer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        let leaderboard = &mut ctx.accounts.leaderboard;
        leaderboard.high_score = 0;
        msg!("Counter and Leaderboard initialized!");
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    pub fn update_leaderboard(ctx: Context<UpdateLeaderboard>) -> Result<()> {
        let leaderboard = &mut ctx.accounts.leaderboard;
        let counter_info = &mut ctx.accounts.counter.to_account_info();
        let mut data: &[u8] = &counter_info.try_borrow_data()?;
        let counter = Counter::try_deserialize(&mut data)?;

        if counter.count > leaderboard.high_score {
            leaderboard.high_score = counter.count;
        }

        msg!("Leaderboard updated! High score: {}", leaderboard.high_score);
        Ok(())
    }

    pub fn delegate(ctx: Context<DelegateCounter>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[COUNTER_SEED],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    pub fn commit_and_update_leaderboard(ctx: Context<CommitAndUpdateLeaderboard>) -> Result<()> {
        let instruction_data =
            anchor_lang::InstructionData::data(&crate::instruction::UpdateLeaderboard {});
        let action_args = ActionArgs::new(instruction_data);
        let action_accounts = vec![
            ShortAccountMeta {
                pubkey: ctx.accounts.leaderboard.key(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.counter.key(),
                is_writable: false,
            },
        ];
        let action = CallHandler {
            destination_program: crate::ID,
            accounts: action_accounts,
            args: action_args,
            escrow_authority: ctx.accounts.global_signer.to_account_info(),
            compute_units: 200_000,
        };

        let magic_action = MagicInstructionBuilder {
            payer: ctx.accounts.payer.to_account_info(),
            magic_context: ctx.accounts.magic_context.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            magic_action: MagicAction::Commit(CommitType::WithHandler {
                commited_accounts: vec![ctx.accounts.counter.to_account_info()],
                call_handlers: vec![action],
            }),
        };

        let bump = ctx.bumps.global_signer;
        let signer_seeds: &[&[&[u8]]] = &[&[GLOBAL_SIGNER_SEED, &[bump]]];
        let global_signer_key = ctx.accounts.global_signer.key();
        let (accounts, mut ix) = magic_action.build();
        // Mark global_signer as signer in the instruction so the MagicProgram CPI accepts it.
        // invoke_signed with the PDA seeds then authorizes it at the runtime level.
        for meta in ix.accounts.iter_mut() {
            if meta.pubkey == global_signer_key {
                meta.is_signer = true;
            }
        }
        invoke_signed(&ix, &accounts, signer_seeds)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[action]
#[derive(Accounts)]
pub struct UpdateLeaderboard<'info> {
    #[account(mut, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
    /// CHECK: owner varies (delegation program when delegated, this program when not); address locked by seeds
    #[account(seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCounter<'info> {
    pub payer: Signer<'info>,
    #[account(mut, del)]
    /// CHECK: the correct pda
    pub pda: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateCounter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitAndUpdateLeaderboard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,

    /// CHECK: Leaderboard PDA - not mut here, writable set in handler
    #[account(seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: UncheckedAccount<'info>,

    /// CHECK: System-owned global signer PDA — signing authority for escrow, never initialized
    #[account(seeds = [GLOBAL_SIGNER_SEED], bump)]
    pub global_signer: UncheckedAccount<'info>,

    /// CHECK: Your program ID
    pub program_id: AccountInfo<'info>,
}

#[account]
pub struct Counter {
    pub count: u64,
}

#[account]
pub struct Leaderboard {
    pub high_score: u64,
}
