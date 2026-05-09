use anchor_lang::prelude::*;

use crate::constants;
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

    // Build PDA signer seeds for reward_list — it is now the payer for the intent bundle
    let reward_list_bump = ctx.bumps.reward_list;
    let reward_distributor_key = ctx.accounts.reward_distributor.key();
    let reward_list_seeds: &[&[u8]] = &[
        constants::REWARD_LIST_SEED,
        reward_distributor_key.as_ref(),
        &[reward_list_bump],
    ];
    let payer_seeds = &[reward_list_seeds];

    {
        let reward_list = &mut ctx.accounts.reward_list;
        // Log the raw randomness proof as hex for auditability
        msg!("Randomness proof: {:?}", randomness.map(|b| b));
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
                                let mint_count = reward.reward_mints.len();
                                // Use a different slice of randomness to pick which mint
                                // to send — avoids correlation with the reward selection.
                                let mut rnd_bytes = [0u8; 32];
                                rnd_bytes.copy_from_slice(&randomness);
                                rnd_bytes.rotate_left(4);
                                let rnd_mint = ephemeral_vrf_sdk::rnd::random_u32(&rnd_bytes);
                                let mint_index = (rnd_mint as usize) % mint_count;
                                reward.reward_mints.remove(mint_index)
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
                            ctx.accounts.reward_list.to_account_info(),
                            user.clone(),
                            ctx.accounts.magic_fee_vault.to_account_info(),
                            payer_seeds,
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
