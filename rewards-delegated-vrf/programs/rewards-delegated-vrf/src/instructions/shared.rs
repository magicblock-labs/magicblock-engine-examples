use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use anchor_spl::metadata::mpl_token_metadata;
use ephemeral_rollups_sdk::{ephem::CallHandler, ActionArgs, ShortAccountMeta};

use crate::errors::RewardError;
use crate::state::{RewardDistributor, RewardType, TransferLookupTable};

pub fn execute_reward_transfer<'info>(
    reward_distributor: &Account<'info, RewardDistributor>,
    transfer_lookup_table: &Account<'info, TransferLookupTable>,
    reward_list: &AccountInfo<'info>,
    magic_context: &AccountInfo<'info>,
    magic_program: &AccountInfo<'info>,
    mint: Pubkey,
    reward_type: RewardType,
    ruleset_pda: Option<Pubkey>,
    amount: u64,
    payer: AccountInfo<'info>,
    destination: AccountInfo<'info>,
) -> Result<()> {
    let token_program = transfer_lookup_table.lookup_accounts[0];
    let ata_program = transfer_lookup_table.lookup_accounts[1];
    let system_program = transfer_lookup_table.lookup_accounts[2];
    let token_metadata_program = transfer_lookup_table.lookup_accounts[3];
    let sysvar_instructions_program = transfer_lookup_table.lookup_accounts[4];
    let auth_rule_program = transfer_lookup_table.lookup_accounts[5];

    match reward_type {
        RewardType::SplToken | RewardType::LegacyNft => {
            let instruction_data =
                anchor_lang::InstructionData::data(&crate::instruction::TransferRewardSplToken {
                    amount,
                });

            let source_token_address = get_associated_token_address(&reward_distributor.key(), &mint);
            let destination_token_address = get_associated_token_address(&destination.key(), &mint);

            let action_args = ActionArgs::new(instruction_data);
            let action_accounts = vec![
                ShortAccountMeta {
                    pubkey: token_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: source_token_address.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: mint,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: destination_token_address,
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: reward_distributor.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: destination.key(),
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: ata_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: system_program,
                    is_writable: false,
                },
            ];

            let action = CallHandler {
                destination_program: crate::ID,
                accounts: action_accounts,
                args: action_args,
                escrow_authority: payer.to_account_info(),
                compute_units: 200_000,
            };

            MagicIntentBundleBuilder::new(
                payer.to_account_info(),
                magic_context.to_account_info(),
                magic_program.to_account_info(),
            )
            .commit(&[reward_list.to_account_info()])
            .add_post_commit_actions([action])
            .build_and_invoke()?;
        }
        RewardType::ProgrammableNft => {
            let instruction_data = anchor_lang::InstructionData::data(
                &crate::instruction::TransferRewardProgrammableNft { amount },
            );

            let source_token_address = get_associated_token_address(&reward_distributor.key(), &mint);
            let destination_token_address = get_associated_token_address(&destination.key(), &mint);

            let (metadata_pda, _) = mpl_token_metadata::accounts::Metadata::find_pda(&mint);
            let (edition_pda, _) = mpl_token_metadata::accounts::MasterEdition::find_pda(&mint);
            let (source_token_record_pda, _) =
                mpl_token_metadata::accounts::TokenRecord::find_pda(&mint, &source_token_address);
            let (destination_token_record_pda, _) =
                mpl_token_metadata::accounts::TokenRecord::find_pda(&mint, &destination_token_address);

            let auth_rule_pda = ruleset_pda.ok_or(RewardError::InvalidRewardType)?;

            let action_args = ActionArgs::new(instruction_data);
            let action_accounts = vec![
                ShortAccountMeta {
                    pubkey: token_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: source_token_address.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: mint,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: destination_token_address,
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: reward_distributor.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: destination.key(),
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: ata_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: system_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: token_metadata_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: sysvar_instructions_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: auth_rule_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: metadata_pda,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: edition_pda,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: source_token_record_pda,
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: destination_token_record_pda,
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: auth_rule_pda,
                    is_writable: false,
                },
            ];

            let action = CallHandler {
                destination_program: crate::ID,
                accounts: action_accounts,
                args: action_args,
                escrow_authority: payer.to_account_info(),
                compute_units: 200_000,
            };

            MagicIntentBundleBuilder::new(
                payer.to_account_info(),
                magic_context.to_account_info(),
                magic_program.to_account_info(),
            )
            .commit(&[reward_list.to_account_info()])
            .add_post_commit_actions([action])
            .build_and_invoke()?;
        }
        _ => return Err(RewardError::UnsupportedAssetType.into()),
    }

    Ok(())
}
