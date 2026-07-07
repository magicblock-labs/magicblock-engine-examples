use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, Create};
use anchor_spl::token_interface::{transfer_checked, TransferChecked};

use crate::constants::{REWARD_DISTRIBUTOR_SEED, WHITELIST_DISTRIBUTOR_SEED};
use crate::errors::RewardError;
use crate::state::SourceKind;
use crate::TransferSplToken;

/// Post-commit handler for SPL/LegacyNFT transfers. Unified for both reward
/// and whitelist sources — the source-authority PDA arrives in
/// `source_authority` and the seed components (second_seed + bump) are
/// read straight from its on-chain account data:
///   `[8 disc][32 second_seed][1 bump][...]`
/// — a layout `RewardDistributor` and `WhitelistDistributor` share. The
/// `SourceKind` ix param picks the matching seed prefix.
///
/// Security: this ix is only reachable through Magic's post-commit machinery
/// for actions scheduled by this program (`source_program == crate::ID`).
/// `source_authority` is constrained to be owned by this program. If the
/// derived signer doesn't match `source_token_account.owner`, the SPL
/// transfer fails — the actual security check is on the CPI itself.
pub fn transfer_spl_token(
    ctx: Context<TransferSplToken>,
    amount: u64,
    source: SourceKind,
) -> Result<()> {
    msg!(
        "Transferring SPL token: {} tokens to user {:?} (source: {:?})",
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

    let cpi_transfer_accounts = TransferChecked {
        from: ctx.accounts.source_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination_token_account.to_account_info(),
        authority: ctx.accounts.source_authority.to_account_info(),
    };
    let cpi_transfer_program = ctx.accounts.token_program.to_account_info();
    let cpi_transfer_ctx = CpiContext::new_with_signer(
        cpi_transfer_program.key(),
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

/// Pull the (second_seed, bump) tuple from a source-authority PDA's account
/// data. Both `RewardDistributor` and `WhitelistDistributor` lay out their
/// first stored field as a 32-byte pubkey followed by the bump:
///   `[8 disc][32 second_seed][1 bump][...]`
/// so we can read them uniformly. Owner check is enforced in the context.
pub(crate) fn read_seed_payload(
    source_authority: &UncheckedAccount<'_>,
) -> Result<(Pubkey, u8)> {
    let data = source_authority.try_borrow_data()?;
    require!(data.len() >= 41, RewardError::InvalidTokenAccountData);
    let second_seed = Pubkey::try_from(&data[8..40])
        .map_err(|_| error!(RewardError::InvalidTokenAccountData))?;
    let bump = data[40];
    Ok((second_seed, bump))
}
