use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{MagicIntentBundleBuilder};

use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

declare_id!("DX9zogRDKEpuVVocvXWG9U7RD6RrSqLqdkhwoQVz3MBd");

const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod anchor_counter_session {
    use super::*;

    /// Initialize the counter.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        counter.authority = *ctx.accounts.user.key;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Increment the counter.
    #[session_auth_or(
        ctx.accounts.counter.authority.key() == ctx.accounts.payer.key(),
        SessionError::InvalidToken
    )]
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        if counter.count > 1000 {
            counter.count = 0;
        }
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Delegate the account to the delegation program.
    /// Set specific validator based on ER, see https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/local-setup
    pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
        // Read authority out of the raw account data before the CPI — we use
        // UncheckedAccount on `pda` to avoid Anchor re-serializing stale data
        // after the delegate CPI transfers ownership to the delegation program.
        let authority = {
            let data = ctx.accounts.pda.try_borrow_data()?;
            Counter::try_deserialize(&mut &data[..])?.authority
        };

        // Manual session-or-owner auth check (was previously `#[session_auth_or(...)]`,
        // moved here because UncheckedAccount can't reach `.authority` at constraint time).
        let session_ok = ctx.accounts.session_token.as_ref()
            .map(|t| t.authority == authority)
            .unwrap_or(false);
        require!(
            authority == ctx.accounts.payer.key() || session_ok,
            SessionError::InvalidToken
        );

        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[COUNTER_SEED, authority.as_ref()],
            DelegateConfig {
                // Optionally set a specific validator from the first remaining account
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Manual commit the account in the ER.
    #[session_auth_or(
        ctx.accounts.counter.authority.key() == ctx.accounts.payer.key(),
        SessionError::InvalidToken
    )]
    pub fn commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Undelegate the account from the delegation program
    #[session_auth_or(
        ctx.accounts.counter.authority.key() == ctx.accounts.payer.key(),
        SessionError::InvalidToken
    )]
    pub fn undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
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
    #[session_auth_or(
        ctx.accounts.counter.authority.key() == ctx.accounts.payer.key(),
        SessionError::InvalidToken
    )]
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

    /// Increment the counter + manual commit the account in the ER.
    #[session_auth_or(
        ctx.accounts.counter.authority.key() == ctx.accounts.payer.key(),
        SessionError::InvalidToken
    )]
    pub fn increment_and_undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("PDA {} count: {}", counter.key(), counter.count);
        // Serialize the Anchor counter account, commit and undelegate
        counter.exit(&crate::ID)?;
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
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(init_if_needed, payer = user, space = 8 + 32 + 8, seeds = [ COUNTER_SEED, user.key().as_ref() ], bump)]
    pub counter: Account<'info, Counter>,
    pub system_program: Program<'info, System>,
}

/// Add delegate function to the context
#[delegate]
#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK: deserialized manually in the handler and verified via PDA seeds
    /// in the delegate CPI; UncheckedAccount avoids Anchor re-serializing stale
    /// data after ownership transfers to the delegation program.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    /// CHECK: validated in the handler against the counter's authority field.
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

/// Account for the increment instruction.
#[derive(Accounts, Session)]
pub struct Increment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut, 
        seeds = [ COUNTER_SEED, counter.authority.key().as_ref() ], 
        bump
    )]
    pub counter: Account<'info, Counter>,
    #[session(
        signer = payer,
        authority = counter.authority.key() 
    )]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

/// Account for the increment instruction + manual commit.
#[commit]
#[derive(Accounts, Session)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.key().as_ref()], bump)]
    pub counter: Account<'info, Counter>,
    #[session(
        signer = payer,
        authority = counter.authority.key() 
    )]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[account]
pub struct Counter {
    pub authority: Pubkey,
    pub count: u64,
}
