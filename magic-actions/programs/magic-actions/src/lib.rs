use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::ephem::{MagicInstructionBuilder, MagicAction, CallHandler, CommitType};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::consts::EXTERNAL_CALL_HANDLER_DISCRIMINATOR;

declare_id!("27bYc6G5sNWxKGwj7A9cgKwLp3kfkWbViKT9M4JZXCxw");

pub const TEST_PDA_SEED: &[u8] = b"test-pda";
pub const LEADERBOARD_SEED: &[u8] = b"leaderboard";

#[ephemeral]
#[program]
pub mod magic_actions {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        let leaderboard = &mut ctx.accounts.leaderboard;
        leaderboard.high_score = 0;

        msg!("Counter Initialized!");
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    // Since this is an unchecked account, we need to manually deserialize the counter account.
    #[instruction(discriminator = &EXTERNAL_CALL_HANDLER_DISCRIMINATOR)]
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
            &[TEST_PDA_SEED],
            DelegateConfig {
                commit_frequency_ms: 30_000,
                validator: Some(pubkey!("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57")),
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
        let instruction_data = anchor_lang::InstructionData::data(
            &crate::instruction::UpdateLeaderboard {}
        );

        let action_args = ActionArgs {
            escrow_index: 1,
            data: instruction_data,
        };
        
        let accounts = vec![
            ShortAccountMeta {
                pubkey: ctx.accounts.leaderboard.key(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.counter.key(),
                is_writable: false,
            },
        ];

        let call_handler = CallHandler {
            args: action_args,
            compute_units: 200_000,
            escrow_authority: ctx.accounts.payer.to_account_info(),
            destination_program: crate::ID,
            accounts,
        };
    
        let magic_builder = MagicInstructionBuilder {
            payer: ctx.accounts.payer.to_account_info(),
            magic_context: ctx.accounts.magic_context.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            magic_action: MagicAction::Commit(CommitType::WithHandler {
                commited_accounts: vec![ctx.accounts.counter.to_account_info()],
                call_handlers: vec![call_handler],
            }),
        };
    
        magic_builder.build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[derive(Accounts)]
pub struct UpdateLeaderboard<'info> {
    #[account(mut)]
    /// CHECK: the correct pda - this will be moved to the end in the future, meaning you can omit this unless needed
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: the correct pda - this will be moved to the end in the future, meaning you can omit this unless needed
    pub escrow_auth: UncheckedAccount<'info>,
    #[account(mut, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
    /// CHECK: Your program ID
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
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitAndUpdateLeaderboard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,

    /// CHECK: Leaderboard PDA - not mut here, writable set in handler
    #[account(seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: UncheckedAccount<'info>,

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