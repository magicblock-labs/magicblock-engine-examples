use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, Create};
use anchor_spl::token_interface::{transfer_checked, TransferChecked};

use crate::constants::REWARD_DISTRIBUTOR_SEED;
use crate::TransferRewardSplToken;

pub fn transfer_reward_spl_token(
    ctx: Context<TransferRewardSplToken>,
    amount: u64,
) -> Result<()> {
    msg!(
        "Transferring SPL token reward: {} tokens to user {:?}",
        amount,
        ctx.accounts.user.key()
    );

    let super_admin = ctx.accounts.reward_distributor.super_admin.key();
    let seeds = [
        REWARD_DISTRIBUTOR_SEED,
        super_admin.as_ref(),
        &[ctx.accounts.reward_distributor.bump],
    ];
    let cpi_signer_seeds = &[seeds.as_slice()];

    let cpi_ata_accounts = Create {
        payer: ctx.accounts.escrow.to_account_info(),
        associated_token: ctx.accounts.destination_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let cpi_ata_program = ctx.accounts.token_program.to_account_info();
    let cpi_ata_ctx = CpiContext::new(cpi_ata_program, cpi_ata_accounts);
    create_idempotent(cpi_ata_ctx)?;

    let cpi_transfer_accounts = TransferChecked {
        from: ctx.accounts.source_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination_token_account.to_account_info(),
        authority: ctx.accounts.reward_distributor.to_account_info(),
    };
    let cpi_transfer_program = ctx.accounts.token_program.to_account_info();
    let cpi_transfer_ctx = CpiContext::new_with_signer(
        cpi_transfer_program,
        cpi_transfer_accounts,
        cpi_signer_seeds,
    );
    transfer_checked(
        cpi_transfer_ctx,
        amount * (10u64.pow(ctx.accounts.mint.decimals as u32)),
        ctx.accounts.mint.decimals,
    )?;

    msg!(
        "Successfully transferred {} {:?} token(s) to user",
        amount,
        ctx.accounts.mint
    );
    Ok(())
}
