use crate::consts;
use crate::types::{RequestRandomness, SerializableAccountMeta};
use ::solana_program::{pubkey, pubkey::Pubkey};

const SYSTEM_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");

/// Parameters for creating a request randomness instruction
#[derive(Default)]
pub struct RequestRandomnessParams {
    pub payer: Pubkey,
    pub oracle_queue: Pubkey,
    pub callback_program_id: Pubkey,
    pub callback_discriminator: Vec<u8>,
    pub accounts_metas: Option<Vec<SerializableAccountMeta>>,
    pub caller_seed: [u8; 32],
    pub callback_args: Option<Vec<u8>>,
}

pub fn create_request_randomness_ix(
    params: RequestRandomnessParams,
) -> solana_program::instruction::Instruction {
    solana_program::instruction::Instruction {
        program_id: consts::VRF_PROGRAM_ID,
        accounts: vec![
            solana_program::instruction::AccountMeta::new(params.payer, true),
            solana_program::instruction::AccountMeta::new_readonly(
                ::solana_program::pubkey::Pubkey::find_program_address(
                    &[consts::IDENTITY],
                    &params.callback_program_id,
                )
                .0,
                true,
            ),
            solana_program::instruction::AccountMeta::new(params.oracle_queue, false),
            solana_program::instruction::AccountMeta::new_readonly(
                SYSTEM_PROGRAM_ID,
                false,
            ),
            solana_program::instruction::AccountMeta::new_readonly(
                solana_program::sysvar::slot_hashes::ID,
                false,
            ),
        ],
        data: RequestRandomness {
            caller_seed: params.caller_seed,
            callback_program_id: params.callback_program_id,
            callback_discriminator: params.callback_discriminator,
            callback_accounts_metas: params.accounts_metas.unwrap_or_default(),
            callback_args: params.callback_args.unwrap_or_default(),
        }
        .to_bytes(),
    }
}
