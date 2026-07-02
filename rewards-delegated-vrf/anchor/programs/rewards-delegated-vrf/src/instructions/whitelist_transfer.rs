use anchor_lang::prelude::*;

use crate::errors::RewardError;
use crate::instructions::shared::{schedule_transfer_action, TransferSource};
use crate::state::RewardType;
use crate::WhitelistTransfer;

/// Whitelist-authorized transfer from the per-distributor `whitelist_distributor`
/// PDA to an arbitrary destination. Runs on the ER so it can reuse the
/// same Magic intent infrastructure as `admin_transfer`:
///
///   - `reward_list` (delegated) is the intent payer — Magic requires a
///     delegated payer for the post-commit bundle. `reward_list.rewards`
///     is NOT consulted here; the whitelist bag is separate from the
///     reward inventory and its mints are never tracked in `reward_list`.
///   - `whitelist_distributor` (undelegated, base-layer PDA) is the escrow
///     authority — Magic enforces that this PDA signs the schedule tx, and
///     we satisfy that via the bundled `whitelist_distributor_seeds`.
///   - Post-commit, the unified `transfer_spl_token` handler runs on base
///     and signs the SPL CPI with the whitelist_distributor seeds, picked
///     by `SourceKind::WhitelistDistributor`.
///
/// Authorization is enforced in the account context: signer must be
/// `super_admin`, an `admin`, or a `whitelist` member of the distributor.
/// The bag's ATA balance is the only on-chain constraint on `amount`.
///
/// `amount` is in UI units (matches `transfer_spl_token` convention). The
/// post-commit handler multiplies by 10^decimals when executing the CPI.
pub fn whitelist_transfer(ctx: Context<WhitelistTransfer>, amount: u64) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    msg!(
        "Whitelist transfer of mint: {:?} | amount: {} | destination: {:?}",
        mint_key,
        amount,
        ctx.accounts.user.key()
    );

    // No reward_list inventory lookup here — the whitelist bag is a
    // separate token holding (payout mints like USDC) that's never tracked
    // in `reward_list.rewards`. Hardcode the SPL path; the whitelist bag is
    // for fungible payouts, not programmable NFTs.
    let reward_type = RewardType::SplToken;
    let ruleset_pda: Option<Pubkey> = None;

    // Balance check on the whitelist source ATA — no inventory math, just
    // make sure we hold enough.
    let multiplier = 10u64
        .checked_pow(ctx.accounts.mint.decimals as u32)
        .ok_or(RewardError::ArithmeticOverflow)?;
    let amount_in_base_units = amount
        .checked_mul(multiplier)
        .ok_or(RewardError::ArithmeticOverflow)?;
    require!(
        ctx.accounts.source_token_account.amount >= amount_in_base_units,
        RewardError::InsufficientTokenBalanceForReward
    );

    // Verify magic_fee_vault is the one derived from the validator that owns
    // the reward_list delegation (same pattern as admin_transfer).
    let delegation_record_data = ctx
        .accounts
        .delegation_record_reward_list
        .try_borrow_data()?;
    require!(
        delegation_record_data.len() >= 40,
        RewardError::InvalidDelegationRecord
    );
    let validator = Pubkey::try_from(&delegation_record_data[8..40])
        .map_err(|_| error!(RewardError::InvalidDelegationRecord))?;
    drop(delegation_record_data);
    let (expected_fee_vault, _) = Pubkey::find_program_address(
        &[b"magic-fee-vault", validator.as_ref()],
        &ephemeral_rollups_sdk::id(),
    );
    require_keys_eq!(
        ctx.accounts.magic_fee_vault.key(),
        expected_fee_vault,
        RewardError::InvalidDelegationRecord
    );

    // PDA signer seeds. Two PDAs must sign the Magic schedule CPI:
    //   - reward_list: bundle payer (delegated, holds ER lamports)
    //   - whitelist_distributor: escrow_authority (Magic requires it to sign)
    let reward_list_bump = ctx.bumps.reward_list;
    let reward_distributor_key = ctx.accounts.reward_distributor.key();
    let reward_list_seeds: &[&[u8]] = &[
        crate::constants::REWARD_LIST_SEED,
        reward_distributor_key.as_ref(),
        &[reward_list_bump],
    ];
    let whitelist_distributor_bump = ctx.accounts.whitelist_distributor.bump;
    let whitelist_distributor_seeds: &[&[u8]] = &[
        crate::constants::WHITELIST_DISTRIBUTOR_SEED,
        reward_distributor_key.as_ref(),
        &[whitelist_distributor_bump],
    ];
    let payer_seeds: &[&[&[u8]]] = &[reward_list_seeds, whitelist_distributor_seeds];

    schedule_transfer_action(
        TransferSource::WhitelistDistributor {
            authority: ctx.accounts.whitelist_distributor.to_account_info(),
        },
        &ctx.accounts.transfer_lookup_table,
        &ctx.accounts.reward_list.to_account_info(),
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
        mint_key,
        reward_type,
        ruleset_pda,
        amount,
        ctx.accounts.reward_list.to_account_info(),
        ctx.accounts.user.to_account_info(),
        ctx.accounts.magic_fee_vault.to_account_info(),
        payer_seeds,
    )?;

    Ok(())
}
