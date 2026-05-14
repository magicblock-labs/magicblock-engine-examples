use anchor_lang::prelude::*;

use crate::errors::RewardError;
use crate::helpers::validate_reward;
use crate::instructions::shared::execute_reward_transfer;
use crate::state::RewardType;
use crate::RemoveReward;

pub fn remove_reward(
    ctx: Context<RemoveReward>,
    reward_name: String,
    mint_to_remove: Option<Pubkey>,
    redemption_amount: Option<u64>,
) -> Result<()> {
    let reward_list = &mut ctx.accounts.reward_list;
    msg!(
        "Processing reward removal '{}' in reward list: {:?}",
        reward_name,
        reward_list.key()
    );

    let reward_index = reward_list
        .rewards
        .iter()
        .position(|r| r.name == reward_name)
        .ok_or(RewardError::RewardNotFound)?;

    let reward = &mut reward_list.rewards[reward_index];
    if reward.redemption_count >= reward.redemption_limit {
        msg!("Reward {} fully redeemed, removing from list.", reward.name);
        reward_list.rewards.remove(reward_index);
        return Ok(());
    }

    let mint = mint_to_remove.ok_or(RewardError::MissingMint)?;
    let (reward_type, reward_amount, ruleset_pda) = {
        match reward.reward_type {
            RewardType::LegacyNft | RewardType::ProgrammableNft => {
                let mint_position = reward
                    .reward_mints
                    .iter()
                    .position(|m| *m == mint)
                    .ok_or(RewardError::MintNotFoundInReward)?;

                reward.reward_mints.remove(mint_position);
                reward.redemption_limit =
                    reward.redemption_count + reward.reward_mints.len() as u64;

                msg!(
                    "Removed mint {} from NFT reward '{}'. New redemption limit: {}",
                    mint,
                    reward_name,
                    reward.redemption_limit
                );
            }
            RewardType::SplToken => {
                let amount_to_remove = redemption_amount.ok_or(RewardError::MissingRedemptionLimit)?;

                if reward.redemption_limit < amount_to_remove {
                    msg!(
                        "Token reward '{}' does not have enough redemption limit to remove. Existing limit: {}, Trying to remove: {}",
                        reward_name,
                        reward.redemption_limit,
                        amount_to_remove
                    );
                    return Err(RewardError::InsufficientRedemptionLimit.into());
                }

                reward.redemption_limit = reward.redemption_limit.saturating_sub(amount_to_remove);

                msg!(
                    "Removed {} from token reward '{}'. New redemption limit: {}",
                    amount_to_remove,
                    reward_name,
                    reward.redemption_limit
                );
            }
            _ => {
                msg!(
                    "Unsupported reward type for removal: {:?}",
                    reward.reward_type
                );
                return Err(RewardError::UnsupportedAssetType.into());
            }
        }

        (
            reward.reward_type.clone(),
            reward.reward_amount,
            reward.additional_pubkeys.first().copied(),
        )
    };

    validate_reward(&ctx.accounts.reward_list)?;

    let amount = match reward_type {
        RewardType::LegacyNft | RewardType::ProgrammableNft => redemption_amount.unwrap_or(1),
        _ => reward_amount * redemption_amount.unwrap_or(1),
    };

    let reward_list_bump = ctx.bumps.reward_list;
    let reward_distributor_key = ctx.accounts.reward_distributor.key();
    let reward_list_seeds: &[&[u8]] = &[
        crate::constants::REWARD_LIST_SEED,
        reward_distributor_key.as_ref(),
        &[reward_list_bump],
    ];
    let payer_seeds = &[reward_list_seeds];

    // DelegationRecord layout: [8 discriminator][32 authority = validator][...]
    let delegation_record_data = ctx.accounts.delegation_record_reward_list.try_borrow_data()?;
    require!(delegation_record_data.len() >= 40, crate::errors::RewardError::InvalidDelegationRecord);
    let validator = Pubkey::try_from(&delegation_record_data[8..40])
        .map_err(|_| error!(crate::errors::RewardError::InvalidDelegationRecord))?;
    drop(delegation_record_data);
    let (expected_fee_vault, _) = Pubkey::find_program_address(
        &[b"magic-fee-vault", validator.as_ref()],
        &ephemeral_rollups_sdk::id(),
    );
    require_keys_eq!(
        ctx.accounts.magic_fee_vault.key(),
        expected_fee_vault,
        crate::errors::RewardError::InvalidDelegationRecord
    );

    execute_reward_transfer(
        &ctx.accounts.reward_distributor,
        &ctx.accounts.transfer_lookup_table,
        &ctx.accounts.reward_list.to_account_info(),
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
        mint,
        reward_type,
        ruleset_pda,
        amount,
        ctx.accounts.reward_list.to_account_info(),
        ctx.accounts.destination.to_account_info(),
        ctx.accounts.magic_fee_vault.to_account_info(),
        payer_seeds,
    )?;

    Ok(())
}
