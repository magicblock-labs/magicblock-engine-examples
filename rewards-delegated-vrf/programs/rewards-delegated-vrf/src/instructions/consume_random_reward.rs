use anchor_lang::prelude::*;

use crate::instructions::shared::execute_reward_transfer;
use crate::state::RewardType;
use crate::ConsumeRandomReward;

pub fn consume_random_reward(
    ctx: Context<ConsumeRandomReward>,
    randomness: [u8; 32],
) -> Result<()> {
    let reward_distributor = &ctx.accounts.reward_distributor;
    let user = &ctx.accounts.user;
    let transfer_lookup_table = &ctx.accounts.transfer_lookup_table;

    {
        let reward_list = &mut ctx.accounts.reward_list;
        let rnd_u32 = ephemeral_vrf_sdk::rnd::random_u32(&randomness);
        let range = (reward_list.global_range_max as u64)
            .checked_sub(reward_list.global_range_min as u64)
            .unwrap()
            + 1;
        let result = reward_list.global_range_min + (rnd_u32 % range as u32);
        msg!("Random result: {:?} for user: {:?}", result, user.key());

        for reward in reward_list.rewards.iter() {
            msg!(
                "Reward: {:?} | Win Range: [{:?}, {:?}] | Availability: {:?}/{:?}",
                reward.name,
                reward.draw_range_min,
                reward.draw_range_max,
                reward.redemption_count,
                reward.redemption_limit
            );
        }

        let mut found_reward = false;
        for reward in reward_list.rewards.iter_mut() {
            if result >= reward.draw_range_min && result <= reward.draw_range_max {
                found_reward = true;
                if reward.redemption_count < reward.redemption_limit {
                    reward.redemption_count = reward.redemption_count.saturating_add(1);
                    msg!(
                        "Won reward '{}' (range {}-{})",
                        reward.name,
                        reward.draw_range_min,
                        reward.draw_range_max
                    );

                    if !transfer_lookup_table.lookup_accounts.is_empty() {
                        let reward_type = reward.reward_type.clone();
                        let mint = match reward_type {
                            RewardType::LegacyNft | RewardType::ProgrammableNft => {
                                reward.reward_mints.remove(0)
                            }
                            _ => reward.reward_mints[0],
                        };
                        let amount = reward.reward_amount;
                        let ruleset_pda = reward.additional_pubkeys.first().copied();

                        execute_reward_transfer(
                            reward_distributor,
                            transfer_lookup_table,
                            &ctx.accounts.reward_list.to_account_info(),
                            &ctx.accounts.magic_context.to_account_info(),
                            &ctx.accounts.magic_program.to_account_info(),
                            mint,
                            reward_type,
                            ruleset_pda,
                            amount,
                            ctx.accounts.vrf_program_identity.to_account_info(),
                            user.clone(),
                        )?;
                        break;
                    } else {
                        msg!("Warning: No lookup accounts found for selected reward");
                    }
                } else {
                    msg!(
                        "Reward '{}' is exhausted ({}/{})",
                        reward.name,
                        reward.redemption_count,
                        reward.redemption_limit
                    );
                }
                break;
            }
        }

        if !found_reward {
            msg!("No reward found for result: {:?}", result);
        }
    }

    Ok(())
}
