use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

mod error;
mod state;
mod utils;

use error::ErrorCode;
use state::{Bet, Direction, Pool};
use utils::*;

declare_id!("7HHiv8th2wY24iZp2ReF7QkJyFJHwHWCgZWg7CWrQnnm");

pub const POOL_SEED: &[u8] = b"pool";
pub const BET_SEED: &[u8] = b"bet";

pub const EPHEMERAL_SPL_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
pub const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const MAGIC_PROGRAM_ID: Pubkey = pubkey!("Magic11111111111111111111111111111111111111");
pub const MAGIC_CONTEXT_ID: Pubkey = pubkey!("MagicContext1111111111111111111111111111111");

pub const MAX_PRICE_AGE_SECONDS: u64 = 300;
pub const BASIS_POINTS_DENOMINATOR: u64 = 10_000;

#[ephemeral]
#[program]
pub mod binary_prediction {
    use super::*;

    /// Creates the prediction pool and moves its starting liquidity into ER custody.
    /// The Pool PDA stores market config and owns the pool token account that is
    /// deposited into an EATA and delegated to the ER.
    pub fn initialize(
        ctx: Context<Initialize>,
        price_feed: Pubkey,
        price_feed_id: [u8; 32],
        seed_amount: u64,
        bet_duration_seconds: i64,
        min_stake: u64,
        payout_bps: u64,
    ) -> Result<()> {
        require!(seed_amount > 0, ErrorCode::InvalidAmount);
        require!(bet_duration_seconds > 0, ErrorCode::InvalidPoolConfig);
        require!(min_stake > 0, ErrorCode::InvalidPoolConfig);
        require!(
            payout_bps >= BASIS_POINTS_DENOMINATOR,
            ErrorCode::InvalidPoolConfig
        );

        let pool_key = ctx.accounts.pool.key();
        let pool = &mut ctx.accounts.pool;
        pool.mint = ctx.accounts.mint.key();
        pool.authority = pool_key;
        pool.price_feed = price_feed;
        pool.price_feed_id = price_feed_id;
        pool.bet_duration_seconds = bet_duration_seconds;
        pool.min_stake = min_stake;
        pool.payout_bps = payout_bps;
        pool.bump = ctx.bumps.pool;

        let cpi_accounts = SplTransfer {
            from: ctx.accounts.admin_token_account.to_account_info(),
            to: ctx.accounts.pool_token_account.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
        token::transfer(cpi_ctx, seed_amount)?;

        let validator = ctx.remaining_accounts.first().map(|account| account.key());

        init_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.pool_ephemeral_ata,
            ctx.accounts.pool.to_account_info(),
            &ctx.accounts.mint,
            &ctx.accounts.admin,
            &ctx.accounts.system_program,
        )?;
        init_vault(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.admin,
            &ctx.accounts.vault_ephemeral_ata,
            &ctx.accounts.vault_token_account,
            &ctx.accounts.token_program,
            &ctx.accounts.associated_token_program,
            &ctx.accounts.system_program,
        )?;
        init_associated_token_account(
            &ctx.accounts.associated_token_program,
            &ctx.accounts.admin,
            &ctx.accounts.vault_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.system_program,
            &ctx.accounts.token_program,
        )?;
        delegate_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.admin,
            &ctx.accounts.vault_ephemeral_ata,
            &ctx.accounts.vault_eata_buffer,
            &ctx.accounts.vault_eata_record,
            &ctx.accounts.vault_eata_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            validator,
        )?;
        let mint_key = ctx.accounts.mint.key();
        let pool_bump = [ctx.accounts.pool.bump];
        let pool_seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &pool_bump];
        transfer_to_vault(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.pool_ephemeral_ata,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.pool_token_account,
            &ctx.accounts.vault_token_account,
            ctx.accounts.pool.to_account_info(),
            &ctx.accounts.token_program,
            seed_amount,
            Some(pool_seeds),
        )?;
        delegate_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.admin,
            &ctx.accounts.pool_ephemeral_ata,
            &ctx.accounts.pool_eata_buffer,
            &ctx.accounts.pool_eata_record,
            &ctx.accounts.pool_eata_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            validator,
        )?;

        Ok(())
    }

    /// Creates the user's Bet PDA on the base layer.
    /// Each user has one reusable Bet account; `settle` clears it so the same PDA
    /// can be used again.
    pub fn initialize_bet(ctx: Context<InitializeBet>) -> Result<()> {
        let bet = &mut ctx.accounts.bet;
        require!(!bet.is_open, ErrorCode::BetAlreadyOpen);
        bet.is_open = false;
        bet.stake = 0;
        bet.open_price = 0;
        bet.expiry_ts = 0;
        Ok(())
    }

    /// Delegates the user's Bet PDA to the ER.
    /// After delegation, `place_bet` and `settle` can update the Bet account with
    /// low latency on the ephemeral runtime.
    pub fn delegate_bet(ctx: Context<DelegateBet>) -> Result<()> {
        let validator = ctx.remaining_accounts.first().map(|account| account.key());
        ctx.accounts.delegate_bet(
            &ctx.accounts.payer,
            &[BET_SEED, ctx.accounts.user.key().as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Commits the user's Bet PDA back to the base layer and undelegates it.
    /// This is optional for normal play; users only need it when they want the
    /// account back, for example before closing it to reclaim rent.
    pub fn undelegate_bet(ctx: Context<UndelegateBet>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.bet.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Opens one UP or DOWN prediction on the ER.
    /// The payer spends from the user's token account as either the user signer
    /// or an approved session delegate, records the current oracle price, and
    /// sets the earliest settlement time.
    #[session_auth_or(
        ctx.accounts.user.key() == ctx.accounts.payer.key(),
        SessionError::InvalidToken
    )]
    pub fn place_bet(ctx: Context<PlaceBet>, direction: Direction, stake: u64) -> Result<()> {
        require!(
            stake >= ctx.accounts.pool.min_stake,
            ErrorCode::StakeTooSmall
        );
        require!(!ctx.accounts.bet.is_open, ErrorCode::BetAlreadyOpen);
        require_keys_eq!(
            ctx.accounts.price_update.key(),
            ctx.accounts.pool.price_feed,
            ErrorCode::InvalidPriceFeed
        );

        if ctx.accounts.payer.key() != ctx.accounts.user.key() {
            require_token_delegate(
                &ctx.accounts.user_token_account,
                ctx.accounts.payer.key(),
                stake,
            )?;
        }

        let open_price = read_price(&ctx.accounts.price_update, &ctx.accounts.pool.price_feed_id)?;
        let now = Clock::get()?.unix_timestamp;
        let required_payout = checked_payout(stake, ctx.accounts.pool.payout_bps)?;
        let pool_balance = ctx.accounts.pool_token_account.amount;
        require!(
            pool_balance >= required_payout,
            ErrorCode::InsufficientLiquidity
        );

        signer_transfer(
            ctx.accounts.user_token_account.to_account_info(),
            ctx.accounts.pool_token_account.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            stake,
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.open_price = open_price;
        bet.expiry_ts = now
            .checked_add(ctx.accounts.pool.bet_duration_seconds)
            .ok_or(ErrorCode::MathOverflow)?;
        bet.direction = direction;
        bet.stake = stake;
        bet.is_open = true;

        Ok(())
    }

    /// Settles an expired bet using the latest oracle price.
    /// Winners receive the configured basis-point payout, ties refund the stake,
    /// and losses pay nothing. The Bet account is cleared afterward.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        require!(ctx.accounts.bet.is_open, ErrorCode::BetNotOpen);
        require_keys_eq!(
            ctx.accounts.price_update.key(),
            ctx.accounts.pool.price_feed,
            ErrorCode::InvalidPriceFeed
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.bet.expiry_ts, ErrorCode::BetNotExpired);

        let settle_price =
            read_price(&ctx.accounts.price_update, &ctx.accounts.pool.price_feed_id)?;
        let win_payout = checked_payout(ctx.accounts.bet.stake, ctx.accounts.pool.payout_bps)?;
        let payout = if settle_price == ctx.accounts.bet.open_price {
            ctx.accounts.bet.stake
        } else if ctx.accounts.bet.direction == outcome(settle_price, ctx.accounts.bet.open_price)?
        {
            win_payout
        } else {
            0
        };

        if payout > 0 {
            pool_signed_transfer(
                ctx.accounts.pool_token_account.to_account_info(),
                ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                payout,
                ctx.accounts.pool.mint,
                ctx.accounts.pool.bump,
            )?;
        }

        let bet = &mut ctx.accounts.bet;
        bet.is_open = false;
        bet.stake = 0;
        bet.open_price = 0;
        bet.expiry_ts = 0;

        Ok(())
    }
}

/// Accounts for pool creation and one-time liquidity delegation.
/// The Pool PDA owns the pool token account and its EATA is delegated to the ER.
#[derive(Accounts)]
#[instruction(
    price_feed: Pubkey,
    price_feed_id: [u8; 32],
    seed_amount: u64,
    bet_duration_seconds: i64,
    min_stake: u64,
    payout_bps: u64
)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = 8 + Pool::LEN,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = pool
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = admin_token_account.owner == admin.key() @ ErrorCode::InvalidTokenOwner,
        constraint = admin_token_account.mint == mint.key() @ ErrorCode::MintMismatch
    )]
    pub admin_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = pool_ephemeral_ata.key() == ephemeral_ata_pda(&pool.key(), &mint.key()) @ ErrorCode::InvalidEphemeralAta
    )]
    /// CHECK: created and delegated by the Ephemeral SPL Token program.
    pub pool_ephemeral_ata: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault.key() == vault_pda(&mint.key()) @ ErrorCode::InvalidVault
    )]
    /// CHECK: created by the Ephemeral SPL Token program.
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault_ephemeral_ata.key() == ephemeral_ata_pda(&vault.key(), &mint.key()) @ ErrorCode::InvalidEphemeralAta
    )]
    /// CHECK: created and delegated by the Ephemeral SPL Token program.
    pub vault_ephemeral_ata: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault_token_account.key() == associated_token_pda(&vault.key(), &mint.key()) @ ErrorCode::InvalidVaultAta
    )]
    /// CHECK: token account created idempotently for the e-token vault.
    pub vault_token_account: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = pool_eata_buffer.key() == eata_buffer_address(&pool_ephemeral_ata.key()) @ ErrorCode::InvalidDelegationPda
    )]
    /// CHECK: delegation buffer for the pool EATA.
    pub pool_eata_buffer: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = pool_eata_record.key() == record_pda(&pool_ephemeral_ata.key()) @ ErrorCode::InvalidDelegationPda
    )]
    /// CHECK: delegation record for the pool EATA.
    pub pool_eata_record: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = pool_eata_metadata.key() == metadata_pda(&pool_ephemeral_ata.key()) @ ErrorCode::InvalidDelegationPda
    )]
    /// CHECK: delegation metadata for the pool EATA.
    pub pool_eata_metadata: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault_eata_buffer.key() == eata_buffer_address(&vault_ephemeral_ata.key()) @ ErrorCode::InvalidDelegationPda
    )]
    /// CHECK: delegation buffer for the vault EATA.
    pub vault_eata_buffer: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault_eata_record.key() == record_pda(&vault_ephemeral_ata.key()) @ ErrorCode::InvalidDelegationPda
    )]
    /// CHECK: delegation record for the vault EATA.
    pub vault_eata_record: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = vault_eata_metadata.key() == metadata_pda(&vault_ephemeral_ata.key()) @ ErrorCode::InvalidDelegationPda
    )]
    /// CHECK: delegation metadata for the vault EATA.
    pub vault_eata_metadata: UncheckedAccount<'info>,
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    /// CHECK: fixed Ephemeral SPL Token program id.
    pub ephemeral_token_program: UncheckedAccount<'info>,
    #[account(address = DELEGATION_PROGRAM_ID)]
    /// CHECK: fixed Delegation program id.
    pub delegation_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeBet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: user authority for the bet PDA.
    pub user: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Bet::LEN,
        seeds = [BET_SEED, user.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    pub system_program: Program<'info, System>,
}

/// Accounts for delegating a Bet PDA to the ER.
#[delegate]
#[derive(Accounts)]
pub struct DelegateBet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(mut, del, seeds = [BET_SEED, user.key().as_ref()], bump)]
    /// CHECK: deserialized by delegated instructions after delegation.
    pub bet: UncheckedAccount<'info>,
}

/// Accounts for returning a delegated Bet PDA to the base layer.
#[commit]
#[derive(Accounts)]
pub struct UndelegateBet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(mut, seeds = [BET_SEED, user.key().as_ref()], bump)]
    pub bet: Account<'info, Bet>,
}

/// Accounts for opening a prediction on the ER.
/// A session payer must be approved as delegate for the user's token account.
#[derive(Accounts, Session)]
pub struct PlaceBet<'info> {
    pub payer: Signer<'info>,
    /// CHECK: user authority for the bet and session token.
    pub user: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [BET_SEED, user.key().as_ref()], bump)]
    pub bet: Account<'info, Bet>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == pool.mint @ ErrorCode::MintMismatch
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = pool_token_account.owner == pool.key() @ ErrorCode::InvalidTokenOwner,
        constraint = pool_token_account.mint == pool.mint @ ErrorCode::MintMismatch
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    /// CHECK: external ephemeral-oracle PriceUpdateV2 account; key checked against Pool.price_feed.
    pub price_update: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    #[session(signer = payer, authority = user.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: user authority for the bet.
    pub user: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [BET_SEED, user.key().as_ref()], bump)]
    pub bet: Account<'info, Bet>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == pool.mint @ ErrorCode::MintMismatch
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = pool_token_account.owner == pool.key() @ ErrorCode::InvalidTokenOwner,
        constraint = pool_token_account.mint == pool.mint @ ErrorCode::MintMismatch
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    /// CHECK: external ephemeral-oracle PriceUpdateV2 account; key checked against Pool.price_feed.
    pub price_update: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}
