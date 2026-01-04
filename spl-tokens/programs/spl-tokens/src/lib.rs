use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as SplTransfer};

use ephemeral_rollups_sdk::anchor::ephemeral;

declare_id!("FgvEeit1djLPPjozq9zW9R8Ahu5JpijcdWQxqL4P887");

#[ephemeral]
#[program]
pub mod spl_tokens {
    use super::*;

    /// Transfer `amount` of SPL tokens from `from` to `to`.
    pub fn transfer(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // CPI into the SPL Token Program
        let cpi_accounts = SplTransfer {
            from: ctx.accounts.from.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = from.owner == payer.key() @ ErrorCode::InvalidTokenOwner,
        constraint = from.mint == to.mint @ ErrorCode::MintMismatch
    )]
    pub from: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("amount must be > 0")]
    InvalidAmount,
    #[msg("from token account is not owned by payer")]
    InvalidTokenOwner,
    #[msg("from and to token accounts must have the same mint")]
    MintMismatch,
}
