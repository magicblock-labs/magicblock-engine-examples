use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, Create};
use anchor_spl::metadata::mpl_token_metadata;

use crate::constants::REWARD_DISTRIBUTOR_SEED;
use crate::TransferRewardProgrammableNft;

pub fn transfer_reward_programmable_nft(
    ctx: Context<TransferRewardProgrammableNft>,
    amount: u64,
) -> Result<()> {
    msg!(
        "Transferring programmable NFT token reward: {} token(s) to user {:?}",
        amount,
        ctx.accounts.user.key()
    );

    let super_admin: Pubkey = ctx.accounts.reward_distributor.super_admin.key();
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

    mpl_token_metadata::instructions::TransferCpiBuilder::new(
        &ctx.accounts.token_metadata_program.to_account_info(),
    )
    .token(&ctx.accounts.source_token_account.to_account_info())
    .token_owner(&ctx.accounts.reward_distributor.to_account_info())
    .destination_token(&ctx.accounts.destination_token_account.to_account_info())
    .destination_owner(&ctx.accounts.user.to_account_info())
    .mint(&ctx.accounts.mint.to_account_info())
    .metadata(&ctx.accounts.metadata.to_account_info())
    .edition(Some(&ctx.accounts.edition.to_account_info()))
    .token_record(Some(&ctx.accounts.source_token_record.to_account_info()))
    .destination_token_record(Some(
        &ctx.accounts.destination_token_record.to_account_info(),
    ))
    .authority(&ctx.accounts.reward_distributor.to_account_info())
    .payer(&ctx.accounts.escrow.to_account_info())
    .system_program(&ctx.accounts.system_program.to_account_info())
    .sysvar_instructions(&ctx.accounts.sysvar_instruction_program.to_account_info())
    .spl_token_program(&ctx.accounts.token_program.to_account_info())
    .spl_ata_program(&ctx.accounts.associated_token_program.to_account_info())
    .authorization_rules_program(Some(&ctx.accounts.auth_rule_program.to_account_info()))
    .authorization_rules(Some(&ctx.accounts.auth_rule.to_account_info()))
    .invoke_signed(cpi_signer_seeds)?;

    msg!(
        "Successfully transferred {} {:?} NFT to user",
        amount,
        ctx.accounts.mint
    );
    Ok(())
}
