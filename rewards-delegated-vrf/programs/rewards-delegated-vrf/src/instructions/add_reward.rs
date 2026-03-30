use anchor_lang::prelude::*;
use anchor_spl::metadata::mpl_token_metadata;

use crate::errors::RewardError;
use crate::helpers::{detect_reward_type, validate_reward, validate_reward_inventory};
use crate::state::{Reward, RewardType};
use crate::AddReward;

fn parse_metadata(
    metadata_account: &Option<UncheckedAccount<'_>>,
) -> Result<Option<mpl_token_metadata::accounts::Metadata>> {
    let Some(metadata_account) = metadata_account else {
        return Ok(None);
    };

    let account_info = metadata_account.to_account_info();
    if account_info.owner != &mpl_token_metadata::ID {
        return Ok(None);
    }

    let data = account_info.try_borrow_data()?;
    if data.is_empty() {
        return Ok(None);
    }

    match mpl_token_metadata::accounts::Metadata::safe_deserialize(&data) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(_) => Ok(None),
    }
}

fn parse_programmable_ruleset(
    metadata: &Option<mpl_token_metadata::accounts::Metadata>,
) -> Result<Pubkey> {
    let metadata = metadata
        .as_ref()
        .ok_or(RewardError::MissingMetadataForProgrammableNft)?;

    metadata
        .programmable_config
        .as_ref()
        .and_then(|config| {
            if let mpl_token_metadata::types::ProgrammableConfig::V1 {
                rule_set: Some(rule_set),
                ..
            } = config
            {
                Some(*rule_set)
            } else {
                None
            }
        })
        .ok_or(RewardError::MissingMetadataForProgrammableNft.into())
}

pub fn add_reward(
    ctx: Context<AddReward>,
    reward_name: String,
    reward_amount: Option<u64>,
    draw_range_min: Option<u32>,
    draw_range_max: Option<u32>,
    redemption_limit: Option<u64>,
) -> Result<()> {
    let reward_list = &mut ctx.accounts.reward_list;
    let mint = &ctx.accounts.mint;
    let token_account = &ctx.accounts.token_account;

    let metadata = parse_metadata(&ctx.accounts.metadata)?;
    let detected_type = detect_reward_type(mint, &metadata)?;
    let existing_reward_index = reward_list
        .rewards
        .iter()
        .position(|r| r.name == reward_name);

    match (existing_reward_index, &detected_type) {
        (Some(reward_index), RewardType::SplToken | RewardType::SplToken2022) => {
            let existing_reward = &reward_list.rewards[reward_index];
            require!(
                existing_reward.reward_type == detected_type,
                RewardError::RewardTypeMismatch
            );

            let redemptions_added =
                redemption_limit.ok_or(RewardError::MissingRedemptionsAdded)?;
            let old_limit = existing_reward.redemption_limit;
            let updated_limit = old_limit
                .checked_add(redemptions_added)
                .ok_or(RewardError::ArithmeticOverflow)?;

            // Existing fungible rewards only grow their redeemable inventory.
            reward_list.rewards[reward_index].redemption_limit = updated_limit;
        }
        (Some(reward_index), RewardType::LegacyNft | RewardType::ProgrammableNft) => {
            let existing_reward = &reward_list.rewards[reward_index];
            require!(
                existing_reward.reward_type == detected_type,
                RewardError::RewardTypeMismatch
            );

            require!(
                !existing_reward.reward_mints.contains(&mint.key()),
                RewardError::MintAlreadyInReward
            );

            let reward = &mut reward_list.rewards[reward_index];
            // NFT rewards extend by appending another concrete mint into the
            // remaining reward pool.
            reward.reward_mints.push(mint.key());
            reward.redemption_limit = reward.redemption_count + reward.reward_mints.len() as u64;

            if detected_type == RewardType::ProgrammableNft {
                let new_ruleset = parse_programmable_ruleset(&metadata)?;
                if !reward.additional_pubkeys.is_empty() {
                    require!(
                        reward.additional_pubkeys[0] == new_ruleset,
                        RewardError::RulesetMismatch
                    );
                } else {
                    reward.additional_pubkeys.push(new_ruleset);
                }
            }
        }
        (Some(_), _) => {
            return Err(RewardError::UnsupportedAssetType.into());
        }
        (None, RewardType::SplToken | RewardType::SplToken2022) => {
            let amount = reward_amount.ok_or(RewardError::MissingRewardAmount)?;
            let limit = redemption_limit.ok_or(RewardError::MissingRedemptionLimit)?;

            reward_list.rewards.push(Reward {
                name: reward_name.clone(),
                draw_range_min: draw_range_min.ok_or(RewardError::MissingDrawRangeMin)?,
                draw_range_max: draw_range_max.ok_or(RewardError::MissingDrawRangeMax)?,
                reward_type: detected_type.clone(),
                reward_mints: vec![mint.key()],
                reward_amount: amount,
                redemption_count: 0,
                redemption_limit: limit,
                additional_pubkeys: Vec::new(),
            });
        }
        (None, RewardType::LegacyNft | RewardType::ProgrammableNft) => {
            let mut additional_pubkeys = Vec::new();
            if detected_type == RewardType::ProgrammableNft {
                additional_pubkeys.push(parse_programmable_ruleset(&metadata)?);
            }

            reward_list.rewards.push(Reward {
                name: reward_name.clone(),
                draw_range_min: draw_range_min.ok_or(RewardError::MissingDrawRangeMin)?,
                draw_range_max: draw_range_max.ok_or(RewardError::MissingDrawRangeMax)?,
                reward_type: detected_type.clone(),
                reward_mints: vec![mint.key()],
                reward_amount: 1,
                redemption_count: 0,
                redemption_limit: 1,
                additional_pubkeys,
            });
        }
        (None, _) => {
            return Err(RewardError::UnsupportedAssetType.into());
        }
    }

    // Final validation happens after the reward list has been updated so the
    // helper can reason about the actual post-change state.
    validate_reward(reward_list)?;
    if matches!(
        detected_type,
        RewardType::SplToken
            | RewardType::SplToken2022
            | RewardType::LegacyNft
            | RewardType::ProgrammableNft
    ) {
        validate_reward_inventory(reward_list, Some(mint), Some(token_account))?;
    }

    Ok(())
}
