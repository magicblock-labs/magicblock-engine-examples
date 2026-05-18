use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::errors::ChatError;
use crate::state::Profile;

pub fn top_up_profile(ctx: Context<TopUpProfile>, lamports: u64) -> Result<()> {
    require!(lamports > 0, ChatError::InvalidTopUpAmount);

    let transfer_accounts = Transfer {
        from: ctx.accounts.authority.to_account_info(),
        to: ctx.accounts.profile.to_account_info(),
    };

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_accounts,
        ),
        lamports,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct TopUpProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"profile", profile.handle.as_bytes()],
        bump = profile.bump,
        has_one = authority
    )]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}
