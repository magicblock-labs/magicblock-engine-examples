use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, Create};
use anchor_spl::metadata::mpl_token_metadata;

use crate::constants::{REWARD_DISTRIBUTOR_SEED, WHITELIST_DISTRIBUTOR_SEED};
use crate::instructions::transfer_spl_token::read_seed_payload;
use crate::state::SourceKind;
use crate::TransferProgrammableNft;

/// Post-commit handler for programmable-NFT transfers. Unified for both
/// reward and whitelist sources — see `transfer_spl_token.rs` for the
/// design rationale. Seed components are read from `source_authority`'s
/// on-chain account data.
pub fn transfer_programmable_nft(
    ctx: Context<TransferProgrammableNft>,
    amount: u64,
    source: SourceKind,
) -> Result<()> {
    msg!(
        "Transferring programmable NFT: {} token(s) to user {:?} (source: {:?})",
        amount,
        ctx.accounts.user.key(),
        source
    );

    let (second_seed, bump) = read_seed_payload(&ctx.accounts.source_authority)?;
    let prefix: &[u8] = match source {
        SourceKind::RewardDistributor => REWARD_DISTRIBUTOR_SEED,
        SourceKind::WhitelistDistributor => WHITELIST_DISTRIBUTOR_SEED,
    };
    let bump_arr = [bump];
    let seeds: [&[u8]; 3] = [prefix, second_seed.as_ref(), &bump_arr];
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
    let cpi_ata_ctx = CpiContext::new(cpi_ata_program.key(), cpi_ata_accounts);
    create_idempotent(cpi_ata_ctx)?;

    mpl_token_metadata::instructions::TransferCpiBuilder::new(
        &ctx.accounts.token_metadata_program.to_account_info(),
    )
    .token(&ctx.accounts.source_token_account.to_account_info())
    .token_owner(&ctx.accounts.source_authority.to_account_info())
    .destination_token(&ctx.accounts.destination_token_account.to_account_info())
    .destination_owner(&ctx.accounts.user.to_account_info())
    .mint(&ctx.accounts.mint.to_account_info())
    .metadata(&ctx.accounts.metadata.to_account_info())
    .edition(Some(&ctx.accounts.edition.to_account_info()))
    .token_record(Some(&ctx.accounts.source_token_record.to_account_info()))
    .destination_token_record(Some(
        &ctx.accounts.destination_token_record.to_account_info(),
    ))
    .authority(&ctx.accounts.source_authority.to_account_info())
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
