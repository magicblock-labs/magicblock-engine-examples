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
        RewardType::LegacyNft | RewardType::ProgrammableNft => 1,
        _ => reward_amount,
    };

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
        ctx.accounts.admin.to_account_info(),
        ctx.accounts.destination.to_account_info(),
    )?;

    Ok(())
}
