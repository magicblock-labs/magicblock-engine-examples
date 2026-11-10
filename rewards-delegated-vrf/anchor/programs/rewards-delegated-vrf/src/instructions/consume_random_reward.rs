use anchor_lang::prelude::*;

use crate::constants;
use crate::errors::RewardError;
use crate::instructions::shared::{schedule_transfer_action, TransferSource};
use crate::state::RewardType;
use crate::ConsumeRandomReward;

pub fn consume_random_reward(
    ctx: Context<ConsumeRandomReward>,
    randomness: [u8; 32],
) -> Result<()> {
    let reward_distributor = &ctx.accounts.reward_distributor;
    let user = &ctx.accounts.user;
    let transfer_lookup_table = &ctx.accounts.transfer_lookup_table;

    // Build PDA signer seeds. Two PDAs must sign the Magic schedule CPI:
    //   - reward_list: payer for the intent bundle (delegated, holds ER lamports)
    //   - reward_distributor: escrow_authority (Magic enforces that the
    //     escrow_authority signs the schedule tx; see BaseAction::try_from_args)
    let reward_list_bump = ctx.bumps.reward_list;
    let reward_distributor_key = ctx.accounts.reward_distributor.key();
    let reward_list_seeds: &[&[u8]] = &[
        constants::REWARD_LIST_SEED,
        reward_distributor_key.as_ref(),
        &[reward_list_bump],
    ];
    let super_admin = ctx.accounts.reward_distributor.super_admin;
    let reward_distributor_bump = ctx.accounts.reward_distributor.bump;
    let reward_distributor_seeds: &[&[u8]] = &[
        constants::REWARD_DISTRIBUTOR_SEED,
        super_admin.as_ref(),
        &[reward_distributor_bump],
    ];
    let payer_seeds: &[&[&[u8]]] = &[reward_list_seeds, reward_distributor_seeds];

    {
        let reward_list = &mut ctx.accounts.reward_list;
        // Log the raw randomness proof as hex for auditability
        msg!("Randomness proof: {:?}", randomness.map(|b| b));
        let rnd_u32 = ephemeral_rollups_sdk::vrf::rnd::random_u32(&randomness);
        // Width of [min, max] inclusive. Kept in u64: a full u32 range (0..=u32::MAX)
        // has 2^32 values, which would wrap to 0 as u32 and panic on `% 0`.
        let range = (reward_list.global_range_max as u64)
            .checked_sub(reward_list.global_range_min as u64)
            .ok_or(RewardError::InvalidDrawRange)?
            + 1;
        // `offset < range <= 2^32`, and `min + offset <= max`, so both casts are lossless.
        let result = reward_list.global_range_min + ((rnd_u32 as u64) % range) as u32;
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
                if reward.reward_mints.is_empty() {
                    // Checked before counting a redemption, and avoids `% 0` on mint selection.
                    msg!("Reward '{}' has no mints left to distribute", reward.name);
                } else if reward.redemption_count < reward.redemption_limit {
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
                                let rnd_mint = ephemeral_rollups_sdk::vrf::rnd::random_u32(&rnd_bytes);
                                let mint_index = (rnd_mint as usize) % mint_count;
                                reward.reward_mints.remove(mint_index)
                            }
                            _ => reward.reward_mints[0],
                        };
                        let amount = reward.reward_amount;
                        let ruleset_pda = reward.additional_pubkeys.first().copied();

                        schedule_transfer_action(
                            TransferSource::RewardDistributor {
                                authority: reward_distributor.to_account_info(),
                            },
                            transfer_lookup_table,
                            &ctx.accounts.reward_list.to_account_info(),
                            &ctx.accounts.magic_context.to_account_info(),
                            &ctx.accounts.magic_program.to_account_info(),
                            mint,
                            reward_type,
                            ruleset_pda,
                            amount,
                            ctx.accounts.reward_list.to_account_info(),
                            user.to_account_info(),
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
