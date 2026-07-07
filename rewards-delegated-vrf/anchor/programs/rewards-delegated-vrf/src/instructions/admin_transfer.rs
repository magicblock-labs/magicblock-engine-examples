use anchor_lang::prelude::*;

use crate::errors::RewardError;
use crate::helpers::total_required_inventory_for_mint;
use crate::instructions::shared::{schedule_transfer_action, TransferSource};
use crate::state::RewardType;
use crate::AdminTransfer;

/// Admin-triggered transfer from the distributor's ATA to a user's ATA. Runs
/// on ER (so it can read the delegated `reward_list`), verifies the amount
/// being sent does not eat into the assets committed to outstanding reward
/// redemptions, then schedules the same post-commit transfer action the
/// VRF/consume flow uses.
///
/// Does not mutate `redemption_count` — this is not a reward redemption.
///
/// `amount` is in UI units (matches `transfer_spl_token` convention). The
/// action handler multiplies by 10^decimals when executing the SPL transfer.
pub fn admin_transfer(ctx: Context<AdminTransfer>, amount: u64) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let decimals = ctx.accounts.mint.decimals;

    msg!(
        "Admin transfer of mint: {:?} | amount: {} | destination: {:?}",
        mint_key,
        amount,
        ctx.accounts.user.key()
    );

    // Look up the reward_type for this mint in reward_list. If the mint isn't
    // tracked (e.g. an external mint the distributor holds for payouts),
    // default to SplToken — total_required_inventory_for_mint returns 0 in
    // that case, so the full ATA balance is available.
    let reward_match = ctx
        .accounts
        .reward_list
        .rewards
        .iter()
        .find(|r| r.reward_mints.contains(&mint_key));
    let (reward_type, ruleset_pda) = match reward_match {
        Some(r) => (r.reward_type.clone(), r.additional_pubkeys.first().copied()),
        None => (RewardType::SplToken, None),
    };

    // Convert the request to base units for the availability check.
    let multiplier = 10u64
        .checked_pow(decimals as u32)
        .ok_or(RewardError::ArithmeticOverflow)?;
    let amount_in_base_units = amount
        .checked_mul(multiplier)
        .ok_or(RewardError::ArithmeticOverflow)?;

    // Committed = base-unit amount reserved across all reward_list entries
    // using this mint. For mints not in reward_list, this returns 0.
    let committed =
        total_required_inventory_for_mint(&ctx.accounts.reward_list.rewards, mint_key, decimals)?;

    let total_needed = amount_in_base_units
        .checked_add(committed)
        .ok_or(RewardError::ArithmeticOverflow)?;

    msg!(
        "Availability check for mint {}: total_held={}, committed={}, requested={}, total_needed={}",
        mint_key,
        ctx.accounts.source_token_account.amount,
        committed,
        amount_in_base_units,
        total_needed
    );

    require!(
        ctx.accounts.source_token_account.amount >= total_needed,
        RewardError::InsufficientTokenBalanceForReward
    );

    // Verify magic_fee_vault is the one derived from the validator that owns
    // the reward_list delegation (same pattern as remove_reward).
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

    // Build PDA signer seeds for the Magic schedule CPI:
    //   - reward_list: bundle payer (delegated, holds ER lamports)
    //   - reward_distributor: escrow_authority (Magic requires it to sign)
    let reward_list_bump = ctx.bumps.reward_list;
    let reward_distributor_key = ctx.accounts.reward_distributor.key();
    let reward_list_seeds: &[&[u8]] = &[
        crate::constants::REWARD_LIST_SEED,
        reward_distributor_key.as_ref(),
        &[reward_list_bump],
    ];
    let super_admin = ctx.accounts.reward_distributor.super_admin;
    let reward_distributor_bump = ctx.accounts.reward_distributor.bump;
    let reward_distributor_seeds: &[&[u8]] = &[
        crate::constants::REWARD_DISTRIBUTOR_SEED,
        super_admin.as_ref(),
        &[reward_distributor_bump],
    ];
    let payer_seeds: &[&[&[u8]]] = &[reward_list_seeds, reward_distributor_seeds];

    schedule_transfer_action(
        TransferSource::RewardDistributor {
            authority: ctx.accounts.reward_distributor.to_account_info(),
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
