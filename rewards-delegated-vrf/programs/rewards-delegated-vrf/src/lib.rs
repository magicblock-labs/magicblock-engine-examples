use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create_idempotent, get_associated_token_address, Create};
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use ephemeral_rollups_sdk::anchor::{action, commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::{ephem::CallHandler, ActionArgs, ShortAccountMeta};
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

declare_id!("4XUU89RHJTUwdyMJcUHqzoyGsfbBfvnT1GDGufcsDst4");

pub const REWARD_DISTRIBUTOR_SEED: &[u8] = b"reward_distributor";
pub const REWARD_LIST_SEED: &[u8] = b"reward_list";
pub const TRANSFER_LOOKUP_TABLE_SEED: &[u8] = b"transfer_lookup_table";

#[ephemeral]
#[program]
pub mod rewards_delegated_vrf {

    use anchor_lang::prelude::program::invoke_signed;
    use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};

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
        Ok(())
    }

    pub fn initialize_transfer_lookup_table(
        ctx: Context<InitializeTransferLookupTable>,
        lookup_accounts: Vec<RewardTypeLookupAccounts>,
    ) -> Result<()> {
        msg!(
            "Initializing transfer lookup table: {:?}",
            ctx.accounts.transfer_lookup_table.key()
        );
        let table = &mut ctx.accounts.transfer_lookup_table;
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
                    pubkey: ctx.accounts.user.key(), // User account passed for VRF callback to identify reward recipient
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

                    // Find the lookup accounts for this reward type
                    if let Some(reward_lookup) = transfer_lookup_table
                        .lookup_accounts
                        .iter()
                        .find(|r| r.reward_type == reward.reward_type)
                    {
                        msg!("Transfer Lookup Accounts for {:?}:", reward.reward_type);
                        msg!("Account count: {}", reward_lookup.accounts.len());
                        for (index, account) in reward_lookup.accounts.iter().enumerate() {
                            msg!("  {}. {}", index + 1, account);
                        }

                        // COMMIT AND ACTION
                        let mint = reward.reward_mints[0];
                        let token_program = transfer_lookup_table
                            .lookup_accounts
                            .iter()
                            .find(|r| r.reward_type == reward.reward_type)
                            .unwrap()
                            .accounts[0]; // Token Program

                        let ata_program = transfer_lookup_table
                            .lookup_accounts
                            .iter()
                            .find(|r| r.reward_type == reward.reward_type)
                            .unwrap()
                            .accounts[1]; // ATA Program

                        let system_program = transfer_lookup_table
                            .lookup_accounts
                            .iter()
                            .find(|r| r.reward_type == reward.reward_type)
                            .unwrap()
                            .accounts[2]; // System Program

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
                        // Calculate the associated token account address for recipient
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
                                pubkey: user.key(), // Recipient
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
                            escrow_authority: ctx.accounts.vrf_program_identity.to_account_info(), // Signer authorized to pay transaction fees for action from escrow PDA
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

                        // invoke_signed(
                        //     &magic_action_instruction,
                        //     &magic_action_account_infos,
                        //     &[&[
                        //         REWARD_DISTRIBUTOR_SEED,
                        //         ctx.accounts.distributor_super_admin.key().as_ref(),
                        //         ctx.accounts.reward_distributor.bump.to_le_bytes().as_ref(),
                        //     ]],
                        // )?;

                        break;
                    } else {
                        msg!(
                            "Warning: No lookup accounts found for reward type {:?}",
                            reward.reward_type
                        );
                    }
                    break;
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

        // // Instruction to create associated token account for recipient
        // let create_destination_ata_idempotent_instruction =
        //     spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        //         &ctx.accounts.reward_distributor.key(), // funding address
        //         &ctx.accounts.user.key(),               // wallet address
        //         &ctx.accounts.mint.key(),               // mint address
        //         &ctx.accounts.token_program.key(),      // program id
        //     );

        // Use anchor_spl CPI to create_idempotent associated token account for recipient
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

        msg!("Successfully transferred {} tokens to user", amount);
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
}

/// ADMIN FLOW

// Admin initializes the reward distributor with the rules of the reward distribution (start/end time, min/max roll, etc)
#[derive(Accounts)]
pub struct InitializeRewardDistributor<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(init_if_needed, payer = initializer, space = 8 + 32 + 1 + 4 + (32 * 10) + 4 + (32 * 10), seeds = [REWARD_DISTRIBUTOR_SEED, initializer.key().as_ref()], bump)]
    pub reward_distributor: Account<'info, RewardDistributor>,
    pub system_program: Program<'info, System>,
}

// Admin sets the whitelist for a reward distributor
#[derive(Accounts)]
pub struct SetWhitelist<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub reward_distributor: Account<'info, RewardDistributor>,
}

// Admin sets the reward list for a reward distributor with all reward tiers
#[derive(Accounts)]
pub struct SetRewardList<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    #[account(init_if_needed, payer = admin, space = 8 + RewardsList::MAX_SIZE + 10 * Reward::MAX_SIZE, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
    pub system_program: Program<'info, System>,
}

// Only the program upgrade authority can initialize the transfer lookup table
#[derive(Accounts)]
pub struct InitializeTransferLookupTable<'info> {
    #[account(mut, constraint = authority.key() == program_data.upgrade_authority_address.ok_or(ProgramError::InvalidArgument)?)]
    pub authority: Signer<'info>,
    /// CHECK: Program data account to verify upgrade authority
    pub program_data: Account<'info, ProgramData>,
    #[account(init_if_needed, payer = authority, space = 8 + 4 + (1 + 4 + 32 * 3) + (1 + 4 + 32 * 10) + (1 + 4 + 32 * 10) + (1 + 4 + 32 * 10), seeds = [TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, TransferLookupTable>,
    pub system_program: Program<'info, System>,
}

// Admin delegates the reward list to ER
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

// Admin undelegates the reward list
#[commit]
#[derive(Accounts)]
pub struct UndelegateRewardList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    #[account(mut, seeds = [REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, RewardsList>,
}

/// USER FLOW

// 1. User request randomness on ER
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

// 2. Callback from VRF Oracle with proof of randomness on ER
#[commit]
#[derive(Accounts)]
pub struct ConsumeRandomReward<'info> {
    /// This check ensure that the vrf_program_identity (which is a PDA) is a signer
    /// enforcing the callback is executed by the VRF program through CPI
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// CHECK: The user account is passed from the request_random_reward and used for the reward recipient
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
    /// CHECK: Recipient Token Account
    pub destination_token_account: UncheckedAccount<'info>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    /// CHECK: User/recipient
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

#[account]
pub struct RewardDistributor {
    pub super_admin: Pubkey,
    pub bump: u8,
    pub admins: Vec<Pubkey>,
    pub whitelist: Vec<Pubkey>,
}

#[account]
pub struct RewardsList {
    pub reward_distributor: Pubkey,
    pub bump: u8,
    pub rewards: Vec<Reward>,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub global_range_min: u32,
    pub global_range_max: u32,
}

impl RewardsList {
    // Fixed fields: 32 (Pubkey) + 1 (u8) + 4 (vec header) + 8 (i64) + 8 (i64) + 4 (u32) + 4 (u32) = 61
    pub const MAX_SIZE: usize = 32 + 1 + 4 + 8 + 8 + 4 + 4;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Reward {
    pub name: String,
    pub draw_range_min: u32,
    pub draw_range_max: u32,
    pub reward_type: RewardType,
    pub reward_mints: Vec<Pubkey>,
    pub reward_amount: u64,
    pub redemption_count: u64,
    pub redemption_limit: u64,
}

impl Reward {
    // 36 (string) + 4 + 4 + 1 + 4 + (32 * 10) + 8 + 8 + 8 = 191
    // name: 36, draw_range_min: 4, draw_range_max: 4, reward_type: 1, reward_mints vec header: 4, reward_mints (10 max): 320, reward_amount: 8, redemption_count: 8, redemption_limit: 8
    pub const MAX_SIZE: usize = 36 + 4 + 4 + 1 + 4 + (32 * 10) + 8 + 8 + 8;
}

/*
    ATA Program: Create Idempotent `01` (Hex)
        1. Source (Signer and Fee Payer)
        2. ATA Account
        3. Wallet / ATA Account Owner (Reward Distributor)
        4. Mint
        5. System Program: 11111111111111111111111111111111
        6. Token Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

    SPL Token: Transfer `03` (Hex)
        1. Source Token Account (Reward Distributor's Token Account)
        2. Destination Token Account
        3. Source Owner (Reward Distributor) / Signer

    Metaplex Token Metadata: Transfer `31` (Hex)
        1. Token Account (Reward Distributor's Token Account)
        2. Token Owner (Reward Distributor)
        3. Destination Token Account
        4. Destination Owner
        5. Mint Account
        6. Metadata Account - ["metadata", token_metadata_program_id, mint_pubkey]
        7. Edition PDA - ["metadata", token_metadata_program_id, mint_pubkey, "edition"]
        8. Owner Token Record - ["token_record", token_metadata_program_id, mint_pubkey, token_account_pubkey]
        9. Destination Token Record - ["token_record", token_metadata_program_id, mint_pubkey, destination_token_account_pubkey]
        10. Authority Record : Token Owner?
        11. Payer : Validator Signer?
        12. System Program: 11111111111111111111111111111111
        13. Sysvar Instructions: Sysvar1nstructions1111111111111111111111111
        14. SPL Token Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
        15. Associated Token Program: ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
        16. Authorization Rule Program: auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg
        17. Token Authorization Rules: ?

    For SplToken Lookup Table:
        1. Token Program
        2. Associated Token Program
        3. System Program
*/
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RewardTypeLookupAccounts {
    pub reward_type: RewardType,
    pub accounts: Vec<Pubkey>,
}

#[account]
pub struct TransferLookupTable {
    pub lookup_accounts: Vec<RewardTypeLookupAccounts>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Default, Debug)]
pub enum RewardType {
    #[default]
    SplToken,
    Nft,
    SplToken2022,
    CompressedNft,
}

impl RewardType {
    pub fn to_seed(&self) -> u8 {
        match self {
            RewardType::SplToken => 0,
            RewardType::Nft => 1,
            RewardType::SplToken2022 => 2,
            RewardType::CompressedNft => 3,
        }
    }
}
