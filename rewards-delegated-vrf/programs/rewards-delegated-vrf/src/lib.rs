use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, get_associated_token_address, Create};
use anchor_spl::metadata::{mpl_token_metadata, MetadataAccount};
use anchor_spl::token;
use anchor_spl::token_interface;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use ephemeral_rollups_sdk::anchor::{action, commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::{ephem::CallHandler, ActionArgs, ShortAccountMeta};
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

pub mod constants;
pub mod errors;
pub mod helpers;
pub mod state;
pub mod token_detection;

use constants::*;
use errors::RewardError;
use helpers::validate_reward_ranges;
use state::{Reward, RewardDistributor, RewardType, RewardsList, TransferLookupTable};
use token_detection::detect_reward_type;

declare_id!("6e7VampziFfZf3nDB5pA3QhQKB8xmCQuJxFh7oLgSUjg");

#[ephemeral]
#[program]
pub mod rewards_delegated_vrf {

    use super::*;

    pub fn initialize_reward_distributor(
        ctx: Context<InitializeRewardDistributor>,
        admins: Vec<Pubkey>,
    ) -> Result<()> {
        msg!(
            "Initializing reward distributor: {:?}",
            ctx.accounts.reward_distributor.key()
        );
        let reward_distributor = &mut ctx.accounts.reward_distributor;
        if reward_distributor.super_admin != Pubkey::default() {
            return Ok(());
        }
        let super_admin = ctx.accounts.initializer.key();
        reward_distributor.super_admin = super_admin;
        reward_distributor.bump = ctx.bumps.reward_distributor;
        let mut all_admins = vec![super_admin];
        all_admins.extend(admins.into_iter().filter(|k| *k != super_admin));
        reward_distributor.admins = all_admins;
        Ok(())
    }

    pub fn set_whitelist(ctx: Context<SetWhitelist>, whitelist: Vec<Pubkey>) -> Result<()> {
        msg!("Setting whitelist for reward distributor");
        let reward_distributor = &mut ctx.accounts.reward_distributor;
        reward_distributor.whitelist = whitelist;
        Ok(())
    }

    pub fn set_reward_list(
        ctx: Context<SetRewardList>,
        rewards: Vec<Reward>,
        start_timestamp: i64,
        end_timestamp: i64,
        global_range_min: u32,
        global_range_max: u32,
    ) -> Result<()> {
        msg!("Setting reward list: {:?}", ctx.accounts.reward_list.key());

        let reward_list = &mut ctx.accounts.reward_list;
        reward_list.reward_distributor = ctx.accounts.reward_distributor.key();
        reward_list.bump = ctx.bumps.reward_list;
        reward_list.rewards = rewards;
        reward_list.start_timestamp = start_timestamp;
        reward_list.end_timestamp = end_timestamp;
        reward_list.global_range_min = global_range_min;
        reward_list.global_range_max = global_range_max;

        // Validate reward ranges after setting
        validate_reward_ranges(reward_list)?;

        Ok(())
    }

    pub fn initialize_transfer_lookup_table(
        ctx: Context<InitializeTransferLookupTable>,
        lookup_accounts: Vec<Pubkey>,
    ) -> Result<()> {
        msg!(
            "Initializing transfer lookup table: {:?}",
            ctx.accounts.transfer_lookup_table.key()
        );
        let table = &mut ctx.accounts.transfer_lookup_table;
        table.bump = ctx.bumps.transfer_lookup_table;
        table.lookup_accounts = lookup_accounts;
        msg!(
            "Initialized {} reward type lookup accounts",
            table.lookup_accounts.len()
        );
        Ok(())
    }

    pub fn delegate_reward_list(ctx: Context<DelegateRewardList>) -> Result<()> {
        msg!(
            "Delegating reward list: {:?}",
            ctx.accounts.reward_list.key()
        );
        ctx.accounts.delegate_reward_list(
            &ctx.accounts.admin,
            &[
                REWARD_LIST_SEED,
                ctx.accounts.reward_distributor.key().as_ref(),
            ],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn request_random_reward(ctx: Context<RequestRandomReward>, client_seed: u8) -> Result<()> {
        msg!("Requesting randomness for reward...");

        let reward_list = &ctx.accounts.reward_list;
        let current_timestamp = Clock::get()?.unix_timestamp;

        // Check if current time is within reward distribution window
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
                    pubkey: ctx.accounts.user.key(), // User account passed for VRF callback to identify reward destination
                    is_signer: false,
                    is_writable: false,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.reward_distributor.key(), // Reward Distributor PDA
                    is_signer: false,
                    is_writable: false,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.reward_list.key(), // Reward List PDA
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.transfer_lookup_table.key(), // Transfer Lookup Table
                    is_signer: false,
                    is_writable: false,
                },
                SerializableAccountMeta {
                    pubkey: MAGIC_PROGRAM_ID, // Magic Program
                    is_signer: false,
                    is_writable: false,
                },
                SerializableAccountMeta {
                    pubkey: MAGIC_CONTEXT_ID, // Magic Context
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

    pub fn consume_random_reward(
        ctx: Context<ConsumeRandomReward>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let reward_distributor = &ctx.accounts.reward_distributor;
        let user = &ctx.accounts.user;
        let reward_list = &mut ctx.accounts.reward_list;
        let transfer_lookup_table = &ctx.accounts.transfer_lookup_table;
        let rnd_u32 = ephemeral_vrf_sdk::rnd::random_u32(&randomness);
        let range = (reward_list.global_range_max as u64)
            .checked_sub(reward_list.global_range_min as u64)
            .unwrap()
            + 1;
        let result = reward_list.global_range_min + (rnd_u32 % range as u32);
        msg!("Random result: {:?} for user: {:?}", result, user.key());

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

                    // Use the lookup accounts directly
                    if !transfer_lookup_table.lookup_accounts.is_empty() {
                        msg!("Transfer Lookup Accounts for {:?}:", reward.reward_type);
                        msg!(
                            "Account count: {}",
                            transfer_lookup_table.lookup_accounts.len()
                        );
                        for (index, account) in
                            transfer_lookup_table.lookup_accounts.iter().enumerate()
                        {
                            msg!("  {}. {}", index + 1, account);
                        }
                        let mint = reward.reward_mints[0];
                        let token_program = transfer_lookup_table.lookup_accounts[0]; // Token Program
                        let ata_program = transfer_lookup_table.lookup_accounts[1]; // ATA Program
                        let system_program = transfer_lookup_table.lookup_accounts[2]; // System Program
                        let token_metadata_program = transfer_lookup_table.lookup_accounts[3]; // Token Metadata Program
                        let sysvar_instructions_program = transfer_lookup_table.lookup_accounts[4]; // Sysvar Instructions Program
                        let auth_rule_program = transfer_lookup_table.lookup_accounts[5]; // Authorization Rule Program

                        // Handle different reward types
                        match reward.reward_type {
                            RewardType::SplToken | RewardType::LegacyNft => {
                                // SPL TOKEN / LEGACY NFT: COMMIT AND ACTION
                                // LegacyNft-specific: remove the mint from the reward mints
                                if reward.reward_type == RewardType::LegacyNft {
                                    reward.reward_mints.retain(|m| m != &mint);
                                }
                                // Create action instruction
                                let instruction_data = anchor_lang::InstructionData::data(
                                    &crate::instruction::TransferRewardSplToken {
                                        amount: reward.reward_amount,
                                    },
                                );
                                // Calculate the associated token account address for source (Reward Distributor)
                                let source_token_address = get_associated_token_address(
                                    &reward_distributor.key(), // owner
                                    &mint,                     // mint
                                );
                                // Calculate the associated token account address for destination
                                let destination_token_address = get_associated_token_address(
                                    &user.key(), // owner
                                    &mint,       // mint
                                );

                                let action_args = ActionArgs::new(instruction_data);
                                let action_accounts = vec![
                                    ShortAccountMeta {
                                        pubkey: token_program, // Token Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: source_token_address.key(), // Sender Token Account
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: mint, // Mint
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: destination_token_address, // Destination Token Account
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: reward_distributor.key(), // Owner of Sender Token Account (Reward Distributor) & Fee Payer Signer
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: user.key(), // destination
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: ata_program, // Associated Token Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: system_program, // System Program
                                        is_writable: false,
                                    },
                                ];
                                let action = CallHandler {
                                    destination_program: crate::ID,
                                    accounts: action_accounts,
                                    args: action_args,
                                    escrow_authority: ctx
                                        .accounts
                                        .vrf_program_identity
                                        .to_account_info(), // Signer authorized to pay transaction fees for action from escrow PDA
                                    compute_units: 200_000,
                                };

                                // let (magic_action_account_infos, magic_action_instruction) =
                                MagicIntentBundleBuilder::new(
                                    ctx.accounts.vrf_program_identity.to_account_info(), // Signer and fee payer for the entire bundle
                                    ctx.accounts.magic_context.to_account_info(),
                                    ctx.accounts.magic_program.to_account_info(),
                                )
                                .commit(&[ctx.accounts.reward_list.to_account_info()]) // Commit the updated reward list state
                                .add_post_commit_actions([action])
                                .build_and_invoke()?;
                            }
                            RewardType::ProgrammableNft => {
                                // ProgrammableNFT TOKEN: COMMIT AND ACTION
                                reward.reward_mints.retain(|m| m != &mint);
                                // Create action instruction
                                let instruction_data = anchor_lang::InstructionData::data(
                                    &crate::instruction::TransferRewardSplToken {
                                        amount: reward.reward_amount,
                                    },
                                );
                                // Calculate the associated token account address for source (Reward Distributor)
                                let source_token_address = get_associated_token_address(
                                    &reward_distributor.key(), // owner
                                    &mint,                     // mint
                                );
                                // Calculate the associated token account address for destination
                                let destination_token_address = get_associated_token_address(
                                    &user.key(), // owner
                                    &mint,       // mint
                                );

                                // Derive Metaplex PDAs for Programmable NFT
                                let (metadata_pda, _) =
                                    mpl_token_metadata::accounts::Metadata::find_pda(&mint);

                                let (edition_pda, _) =
                                    mpl_token_metadata::accounts::MasterEdition::find_pda(&mint);

                                let (source_token_record_pda, _) =
                                    mpl_token_metadata::accounts::TokenRecord::find_pda(
                                        &mint,
                                        &source_token_address,
                                    );
                                let (destination_token_record_pda, _) =
                                    mpl_token_metadata::accounts::TokenRecord::find_pda(
                                        &mint,
                                        &destination_token_address,
                                    );

                                // Extract rule set pubkey from additional_pubkey
                                let auth_rule_pda = reward
                                    .additional_pubkeys
                                    .first()
                                    .copied()
                                    .ok_or(RewardError::InvalidRewardType)?;

                                let action_args = ActionArgs::new(instruction_data);
                                let action_accounts = vec![
                                    ShortAccountMeta {
                                        pubkey: token_program, // Token Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: source_token_address.key(), // Sender Token Account
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: mint, // Mint
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: destination_token_address, // Destination Token Account
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: reward_distributor.key(), // Owner of Sender Token Account (Reward Distributor) & Fee Payer Signer
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: user.key(), // destination
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: ata_program, // Associated Token Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: system_program, // System Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: token_metadata_program, // Token Metadata Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: sysvar_instructions_program, // Sysvar Instructions Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: auth_rule_program, // Authorization Rule Program
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: metadata_pda, // Metadata PDA
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: edition_pda, // Edition PDA
                                        is_writable: false,
                                    },
                                    ShortAccountMeta {
                                        pubkey: source_token_record_pda, // Source Token Record PDA
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: destination_token_record_pda, // Destination Token Record PDA
                                        is_writable: true,
                                    },
                                    ShortAccountMeta {
                                        pubkey: auth_rule_pda, // Auth Rules PDA
                                        is_writable: false,
                                    },
                                ];
                                let action = CallHandler {
                                    destination_program: crate::ID,
                                    accounts: action_accounts,
                                    args: action_args,
                                    escrow_authority: ctx
                                        .accounts
                                        .vrf_program_identity
                                        .to_account_info(), // Signer authorized to pay transaction fees for action from escrow PDA
                                    compute_units: 200_000,
                                };

                                // let (magic_action_account_infos, magic_action_instruction) =
                                MagicIntentBundleBuilder::new(
                                    ctx.accounts.vrf_program_identity.to_account_info(), // Signer and fee payer for the entire bundle
                                    ctx.accounts.magic_context.to_account_info(),
                                    ctx.accounts.magic_program.to_account_info(),
                                )
                                .commit(&[ctx.accounts.reward_list.to_account_info()]) // Commit the updated reward list state
                                .add_post_commit_actions([action])
                                .build_and_invoke()?;
                            }
                            RewardType::SplToken2022 => {
                                // TODO: Implement SPL Token 2022 transfer
                                msg!("SPL Token 2022 transfer not yet implemented");
                            }
                            RewardType::CompressedNft => {
                                // TODO: Implement Compressed NFT transfer
                                msg!("Compressed NFT transfer not yet implemented");
                            }
                        }
                        break;
                    } else {
                        msg!(
                            "Warning: No lookup accounts found for reward type {:?}",
                            reward.reward_type
                        );
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

        Ok(())
    }

    pub fn transfer_reward_spl_token(
        ctx: Context<TransferRewardSplToken>,
        amount: u64,
    ) -> Result<()> {
        msg!(
            "Transferring SPL token reward: {} tokens to user {:?}",
            amount,
            ctx.accounts.user.key()
        );

        let super_admin = ctx.accounts.reward_distributor.super_admin.key();
        let seeds = [
            REWARD_DISTRIBUTOR_SEED,
            super_admin.as_ref(),
            &[ctx.accounts.reward_distributor.bump],
        ];
        let cpi_signer_seeds = &[seeds.as_slice()];

        // Use anchor_spl CPI to create_idempotent associated token account for destination
        let cpi_ata_accounts = Create {
            payer: ctx.accounts.escrow.to_account_info(),
            associated_token: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ata_program = ctx.accounts.token_program.to_account_info();
        let cpi_ata_ctx = CpiContext::new(cpi_ata_program, cpi_ata_accounts);
        create_idempotent(cpi_ata_ctx)?;

        // Use anchor_spl CPI to transfer_checked
        let cpi_transfer_accounts = TransferChecked {
            from: ctx.accounts.source_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.reward_distributor.to_account_info(),
        };
        let cpi_transfer_program = ctx.accounts.token_program.to_account_info();
        let cpi_transfer_ctx = CpiContext::new_with_signer(
            cpi_transfer_program,
            cpi_transfer_accounts,
            cpi_signer_seeds,
        );
        transfer_checked(
            cpi_transfer_ctx,
            amount * (10u64.pow(ctx.accounts.mint.decimals as u32)),
            ctx.accounts.mint.decimals,
        )?;

        msg!(
            "Successfully transferred {} {:?} token(s) to user",
            amount,
            ctx.accounts.mint
        );
        Ok(())
    }

    pub fn transfer_reward_programmable_nft(
        ctx: Context<TransferRewardProgrammableNft>,
        amount: u64,
    ) -> Result<()> {
        msg!(
            "Transferring programmable NFT token reward: {} token(s) to user {:?}",
            amount,
            ctx.accounts.user.key()
        );

        // Create CPI seeds
        let super_admin: Pubkey = ctx.accounts.reward_distributor.super_admin.key();
        let seeds = [
            REWARD_DISTRIBUTOR_SEED,
            super_admin.as_ref(),
            &[ctx.accounts.reward_distributor.bump],
        ];
        let cpi_signer_seeds = &[seeds.as_slice()];

        // Use anchor_spl CPI to create_idempotent associated token account for destination
        let cpi_ata_accounts = Create {
            payer: ctx.accounts.escrow.to_account_info(),
            associated_token: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ata_program = ctx.accounts.token_program.to_account_info();
        let cpi_ata_ctx = CpiContext::new(cpi_ata_program, cpi_ata_accounts);
        create_idempotent(cpi_ata_ctx)?;

        // Invoke CPI for NFT Transfer
        mpl_token_metadata::instructions::TransferCpiBuilder::new(
            &ctx.accounts.token_metadata_program.to_account_info(),
        )
        .token(&ctx.accounts.source_token_account.to_account_info())
        .token_owner(&ctx.accounts.reward_distributor.to_account_info())
        .destination_token(&ctx.accounts.destination_token_account.to_account_info())
        .destination_owner(&ctx.accounts.user.to_account_info())
        .mint(&ctx.accounts.mint.to_account_info())
        .metadata(&ctx.accounts.metadata.to_account_info())
        .edition(Some(&ctx.accounts.edition.to_account_info()))
        .token_record(Some(&ctx.accounts.source_token_record.to_account_info()))
        .destination_token_record(Some(
            &ctx.accounts.destination_token_record.to_account_info(),
        ))
        .authority(&ctx.accounts.reward_distributor.to_account_info())
        .payer(&ctx.accounts.escrow.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .sysvar_instructions(&ctx.accounts.sysvar_instruction_program.to_account_info())
        .spl_token_program(&ctx.accounts.token_program.to_account_info())
        .spl_ata_program(&ctx.accounts.associated_token_program.to_account_info())
        .authorization_rules_program(Some(&ctx.accounts.auth_rule_program.to_account_info()))
        .authorization_rules(Some(&ctx.accounts.auth_rule.to_account_info()))
        .invoke_signed(cpi_signer_seeds)?;

        msg!(
            "Successfully transferred {} {:?} NFT to user",
            amount,
            ctx.accounts.mint
        );
        Ok(())
    }

    pub fn undelegate_reward_list(ctx: Context<UndelegateRewardList>) -> Result<()> {
        msg!(
            "Undelegating reward list: {:?}",
            ctx.accounts.reward_list.key()
        );
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.reward_list.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
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

        // Detect the reward type based on mint and metadata
        let detected_type = detect_reward_type(&mint, &ctx.accounts.metadata)?;

        msg!("Detected reward type: {:?}", detected_type);

        // Check if reward already exists
        if let Some(reward) = reward_list
            .rewards
            .iter_mut()
            .find(|r| r.name == reward_name)
        {
            // Reward exists - verify type match
            require!(
                reward.reward_type == detected_type,
                RewardError::RewardTypeMismatch
            );

            // Handle existing reward based on type
            match detected_type {
                RewardType::SplToken | RewardType::SplToken2022 => {
                    // For token rewards, check if the new parameters match existing ones
                    match redemption_limit {
                        Some(new_limit) => {
                            // Check if amount matches (if provided)
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
                            // If amount not provided, assume it matches
                            // Check if draw ranges match (if provided)
                            let ranges_match = match (draw_range_min, draw_range_max) {
                                (Some(new_min), Some(new_max)) => {
                                    new_min == reward.draw_range_min
                                        && new_max == reward.draw_range_max
                                }
                                (None, None) => true, // Ranges not specified, assume match
                                _ => false,           // One specified, one not - mismatch
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

                            // All parameters match - allow updating redemption_limit
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
                            msg!("Token reward '{}' already exists. Must specify redemption_limit to update", reward_name);
                            return Err(RewardError::TokenCannotBeAdded.into());
                        }
                    }
                    return Ok(());
                }
                RewardType::LegacyNft | RewardType::ProgrammableNft => {
                    // For NFT rewards, add mint if not already present
                    if reward.reward_mints.contains(&mint.key()) {
                        msg!(
                            "Mint {} already part of reward '{}'",
                            mint.key(),
                            reward_name
                        );
                        return Ok(());
                    } else {
                        // Add the NFT mint and set NFT redemption_limit to the number of mints
                        reward.reward_mints.push(mint.key());
                        reward.redemption_limit = reward.reward_mints.len() as u64;
                    }

                    // For ProgrammableNft, check ruleset PDA match and add PDA if not exist
                    if detected_type == RewardType::ProgrammableNft {
                        if let Some(metadata) = &ctx.accounts.metadata {
                            if let Some(new_ruleset) =
                                metadata.programmable_config.as_ref().and_then(|pc| {
                                    if let mpl_token_metadata::types::ProgrammableConfig::V1 {
                                        rule_set: Some(rule_set),
                                        ..
                                    } = pc
                                    {
                                        Some(*rule_set)
                                    } else {
                                        None
                                    }
                                })
                            {
                                // Check if new ruleset matches existing rulesets in additional_pubkeys
                                if !reward.additional_pubkeys.is_empty() {
                                    require!(
                                        reward.additional_pubkeys[0] == new_ruleset,
                                        RewardError::RulesetMismatch
                                    );
                                } else {
                                    // First ProgrammableNft, store the ruleset
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
            // CASE 1B: Reward doesn't exist - create new reward
            let min = draw_range_min.ok_or(RewardError::MissingDrawRangeMin)?;
            let max = draw_range_max.ok_or(RewardError::MissingDrawRangeMax)?;

            // For NFT rewards, amount and limit are automatically set
            let (amount, limit) = if detected_type == RewardType::LegacyNft
                || detected_type == RewardType::ProgrammableNft
            {
                msg!("NFT reward: amount set to 1, limit set to 1");
                (1u64, 1u64)
            } else {
                // For token rewards, require amount and limit
                let provided_amount = reward_amount.ok_or(RewardError::MissingRewardAmount)?;
                let provided_limit = redemption_limit.ok_or(RewardError::MissingRedemptionLimit)?;
                (provided_amount, provided_limit)
            };

            // For ProgrammableNft, metadata is required to extract ruleset
            let mut additional_pubkeys = Vec::new();
            if detected_type == RewardType::ProgrammableNft {
                if let Some(metadata) = &ctx.accounts.metadata {
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

            // Create new reward
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
            msg!(
                "Created new reward '{}' with mint {}",
                reward_name,
                mint.key()
            );
        }

        // Validate reward ranges after adding
        validate_reward_ranges(reward_list)?;

        Ok(())
    }
}

// ============================================================================
// ACCOUNT CONTEXTS
// ============================================================================

/// ADMIN FLOW

#[derive(Accounts)]
pub struct InitializeRewardDistributor<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(init_if_needed, payer = initializer, space = 8 + 32 + 1 + 4 + (32 * 10) + 4 + (32 * 10), seeds = [REWARD_DISTRIBUTOR_SEED, initializer.key().as_ref()], bump)]
    pub reward_distributor: Account<'info, RewardDistributor>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetWhitelist<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub reward_distributor: Account<'info, RewardDistributor>,
}

#[derive(Accounts)]
pub struct SetRewardList<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    #[account(init_if_needed, payer = admin, space = REWARD_LIST_SPACE, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeTransferLookupTable<'info> {
    #[account(mut, constraint = authority.key() == program_data.upgrade_authority_address.ok_or(ProgramError::InvalidArgument)?)]
    pub authority: Signer<'info>,
    /// CHECK: Program data account to verify upgrade authority
    pub program_data: Account<'info, ProgramData>,
    #[account(init_if_needed, payer = authority, space = 8 + 1 + 4 + 32 * 33, seeds = [TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, TransferLookupTable>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRewardList<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    /// CHECK: The pda to delegate
    #[account(mut, del, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateRewardList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    #[account(mut, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
}

#[derive(Accounts)]
pub struct AddReward<'info> {
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()) || reward_distributor.whitelist.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    #[account(mut, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        constraint = token_account.owner == reward_distributor.key() @RewardError::TokenNotOwnedByDistributor,
        constraint = token_account.mint == mint.key() @RewardError::InvalidTokenAccount
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    pub metadata: Option<Account<'info, MetadataAccount>>,
}

/// USER FLOW

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomReward<'info> {
    pub user: Signer<'info>,
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()) || reward_distributor.whitelist.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    pub reward_list: Account<'info, RewardsList>,
    #[account(seeds = [TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, TransferLookupTable>,
    /// CHECK: Validated by address constraint against the known VRF oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct ConsumeRandomReward<'info> {
    /// This check ensure that the vrf_program_identity (which is a PDA) is a signer
    /// enforcing the callback is executed by the VRF program through CPI
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// CHECK: The user account is passed from the request_random_reward and used for the reward destination
    pub user: AccountInfo<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    #[account(mut, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
    #[account(seeds = [TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, TransferLookupTable>,
}

#[action]
#[derive(Accounts)]
pub struct TransferRewardSplToken<'info> {
    pub token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    /// CHECK: destination Token Account
    pub destination_token_account: UncheckedAccount<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    /// CHECK: User/destination
    pub user: AccountInfo<'info>,
    /// CHECK: Associated Token Program
    pub associated_token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Source program
    #[account(address = crate::ID)]
    pub source_program: AccountInfo<'info>,
    /// CHECK: Escrow Authority
    pub escrow_auth: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Escrow
    pub escrow: UncheckedAccount<'info>,
}

#[action]
#[derive(Accounts)]
pub struct TransferRewardProgrammableNft<'info> {
    pub token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    /// CHECK: destination Token Account
    pub destination_token_account: UncheckedAccount<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    /// CHECK: User/destination
    pub user: AccountInfo<'info>,
    /// CHECK: Associated Token Program
    pub associated_token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Token Metadata Program
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK: Sysvar Instruction Program
    pub sysvar_instruction_program: UncheckedAccount<'info>,
    /// CHECK: Auth Rule Program
    pub auth_rule_program: UncheckedAccount<'info>,
    /// CHECK: Metadata PDA
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: Edition PDA
    pub edition: UncheckedAccount<'info>,
    /// CHECK: Source Token Record PDA
    pub source_token_record: UncheckedAccount<'info>,
    /// CHECK: Destination Token Record PDA
    pub destination_token_record: UncheckedAccount<'info>,
    /// CHECK: Auth Rule PDA
    pub auth_rule: UncheckedAccount<'info>,
    /// CHECK: Source program
    #[account(address = crate::ID)]
    pub source_program: AccountInfo<'info>,
    /// CHECK: Escrow Authority
    pub escrow_auth: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Escrow
    pub escrow: UncheckedAccount<'info>,
}
