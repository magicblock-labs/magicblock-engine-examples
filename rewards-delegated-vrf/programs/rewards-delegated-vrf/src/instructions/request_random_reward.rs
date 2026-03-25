use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::instruction;
use crate::ID;
use crate::RequestRandomReward;

pub fn request_random_reward(ctx: Context<RequestRandomReward>, client_seed: u8) -> Result<()> {
    msg!("Requesting randomness for reward...");

    let reward_list = &ctx.accounts.reward_list;
    let current_timestamp = Clock::get()?.unix_timestamp;

    if current_timestamp < reward_list.start_timestamp {
        msg!(
            "Reward distribution not started yet. Current: {}, Start: {}",
            current_timestamp,
            reward_list.start_timestamp
        );
        return Ok(());
    }

    if current_timestamp > reward_list.end_timestamp {
        msg!(
            "Reward distribution has ended. Current: {}, End: {}",
            current_timestamp,
            reward_list.end_timestamp
        );
        return Ok(());
    }

    let ix = create_request_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.admin.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: ID,
        callback_discriminator: instruction::ConsumeRandomReward::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.user.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.reward_distributor.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.reward_list.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.transfer_lookup_table.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: MAGIC_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: MAGIC_CONTEXT_ID,
                is_signer: false,
                is_writable: true,
            },
        ]),
        ..Default::default()
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.admin.to_account_info(), &ix)?;
    msg!(
        "VRF randomness request successfully triggered for user: {:?}",
        ctx.accounts.user.key()
    );
    Ok(())
}
