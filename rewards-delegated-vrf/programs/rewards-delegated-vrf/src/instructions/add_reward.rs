use anchor_lang::prelude::*;
use anchor_spl::metadata::mpl_token_metadata;

use crate::errors::RewardError;
use crate::helpers::validate_reward;
use crate::state::{Reward, RewardType};
use crate::token_detection::detect_reward_type;
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
    msg!(
        "Processing mint {} for reward '{}' in reward list: {:?}",
        mint.key(),
        reward_name,
        reward_list.key()
    );

    let metadata = parse_metadata(&ctx.accounts.metadata)?;
    let detected_type = detect_reward_type(mint, &metadata)?;
    msg!("Detected reward type: {:?}", detected_type);

    if let Some(reward) = reward_list.rewards.iter_mut().find(|r| r.name == reward_name) {
        require!(
            reward.reward_type == detected_type,
            RewardError::RewardTypeMismatch
        );

        match detected_type {
            RewardType::SplToken | RewardType::SplToken2022 => {
                match redemption_limit {
                    Some(new_limit) => {
                        if let Some(new_amount) = reward_amount {
                            if reward.reward_amount != new_amount {
                                msg!(
                                    "Token reward '{}' already exists with amount {}. Cannot change to {}",
                                    reward_name,
                                    reward.reward_amount,
                                    new_amount
                                );
                                return Err(RewardError::TokenCannotBeAdded.into());
                            }
                        }

                        let ranges_match = match (draw_range_min, draw_range_max) {
                            (Some(new_min), Some(new_max)) => {
                                new_min == reward.draw_range_min && new_max == reward.draw_range_max
                            }
                            (None, None) => true,
                            _ => false,
                        };

                        if !ranges_match {
                            msg!(
                                "Token reward '{}' draw range mismatch. Existing: {} - {}, Provided: {} - {}",
                                reward_name,
                                reward.draw_range_min,
                                reward.draw_range_max,
                                draw_range_min.unwrap_or(0),
                                draw_range_max.unwrap_or(0)
                            );
                            return Err(RewardError::TokenCannotBeAdded.into());
                        }

                        let old_limit = reward.redemption_limit;
                        reward.redemption_limit = old_limit + new_limit;
                        msg!(
                            "Updated redemption_limit for token reward '{}': {} -> {}",
                            reward_name,
                            old_limit,
                            reward.redemption_limit
                        );
                    }
                    None => {
                        msg!(
                            "Token reward '{}' already exists. Must specify redemption_limit to update",
                            reward_name
                        );
                        return Err(RewardError::TokenCannotBeAdded.into());
                    }
                }
                return Ok(());
            }
            RewardType::LegacyNft | RewardType::ProgrammableNft => {
                if reward.reward_mints.contains(&mint.key()) {
                    msg!("Mint {} already part of reward '{}'", mint.key(), reward_name);
                    return Ok(());
                } else {
                    reward.reward_mints.push(mint.key());
                    reward.redemption_limit = reward.reward_mints.len() as u64;
                }

                if detected_type == RewardType::ProgrammableNft {
                    if let Some(metadata) = metadata.as_ref() {
                        if let Some(new_ruleset) = metadata.programmable_config.as_ref().and_then(|pc| {
                            if let mpl_token_metadata::types::ProgrammableConfig::V1 {
                                rule_set: Some(rule_set),
                                ..
                            } = pc
                            {
                                Some(*rule_set)
                            } else {
                                None
                            }
                        }) {
                            if !reward.additional_pubkeys.is_empty() {
                                require!(
                                    reward.additional_pubkeys[0] == new_ruleset,
                                    RewardError::RulesetMismatch
                                );
                            } else {
                                reward.additional_pubkeys.push(new_ruleset);
                            }
                        }
                    } else {
                        return Err(RewardError::MissingMetadataForProgrammableNft.into());
                    }
                }

                msg!(
                    "Successfully added mint {} to existing reward '{}' with new redemption limit {}",
                    mint.key(),
                    reward_name,
                    reward.redemption_limit
                );
            }
            _ => {
                msg!("Unsupported reward type: {:?}", detected_type);
                return Err(RewardError::UnsupportedAssetType.into());
            }
        }
    } else {
        let min = draw_range_min.ok_or(RewardError::MissingDrawRangeMin)?;
        let max = draw_range_max.ok_or(RewardError::MissingDrawRangeMax)?;

        let (amount, limit) = if detected_type == RewardType::LegacyNft
            || detected_type == RewardType::ProgrammableNft
        {
            msg!("NFT reward: amount set to 1, limit set to 1");
            (1u64, 1u64)
        } else {
            let provided_amount = reward_amount.ok_or(RewardError::MissingRewardAmount)?;
            let provided_limit = redemption_limit.ok_or(RewardError::MissingRedemptionLimit)?;
            (provided_amount, provided_limit)
        };

        let mut additional_pubkeys = Vec::new();
        if detected_type == RewardType::ProgrammableNft {
            if let Some(metadata) = metadata.as_ref() {
                if let Some(ruleset) = metadata.programmable_config.as_ref().and_then(|pc| {
                    if let mpl_token_metadata::types::ProgrammableConfig::V1 {
                        rule_set: Some(rule_set),
                        ..
                    } = pc
                    {
                        Some(*rule_set)
                    } else {
                        None
                    }
                }) {
                    additional_pubkeys.push(ruleset);
                    msg!(
                        "Extracted ruleset PDA: {} for new ProgrammableNft reward",
                        ruleset
                    );
                }
            } else {
                return Err(RewardError::MissingMetadataForProgrammableNft.into());
            }
        }

        let new_reward = Reward {
            name: reward_name.clone(),
            draw_range_min: min,
            draw_range_max: max,
            reward_type: detected_type,
            reward_mints: vec![mint.key()],
            reward_amount: amount,
            redemption_count: 0,
            redemption_limit: limit,
            additional_pubkeys,
        };

        reward_list.rewards.push(new_reward);
        msg!("Created new reward '{}' with mint {}", reward_name, mint.key());
    }

    validate_reward(reward_list)?;

    Ok(())
}
