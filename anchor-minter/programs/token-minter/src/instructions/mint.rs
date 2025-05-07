use crate::Counter;
use {
    anchor_lang::prelude::*,
    anchor_spl::{
        associated_token::AssociatedToken,
        token::{mint_to, Mint, MintTo, Token, TokenAccount},
    },
};

#[derive(Accounts)]
pub struct MintToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK:`counter` is the account that holds the counter data
    #[account()]
    pub counter: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"mint"],
        bump
    )]
    pub mint_account: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_account,
        associated_token::authority = payer,
    )]
    pub associated_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn mint_token(ctx: Context<MintToken>, amount: u64) -> Result<()> {
    let counter_data =
        Counter::try_deserialize_unchecked(&mut &*(*ctx.accounts.counter.data.borrow()).as_ref())
            .map_err(Into::<Error>::into)?;

    msg!("Counter: {:?}", counter_data.count);

    let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint_account]]];
    mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint_account.to_account_info(),
                to: ctx.accounts.associated_token_account.to_account_info(),
                authority: ctx.accounts.mint_account.to_account_info(),
            },
        )
        .with_signer(signer_seeds), // using PDA to sign
        amount * 10u64.pow(ctx.accounts.mint_account.decimals as u32),
    )?;

    Ok(())
}
