use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

declare_id!("D74Ho1cWBHgZNpVG4FnBBA4JtjX4HFZ5QqqRXXVKA8gM");

pub const REWARD_DISTRIBUTOR_SEED: &[u8] = b"reward_distributor";
pub const REWARD_METADATA_SEED: &[u8] = b"reward_metadata";

#[ephemeral]
#[program]
pub mod random_dice_delegated {
    use super::*;

    pub fn initialize_reward_distributor(
        ctx: Context<InitializeRewardDistributor>,
        start_timestamp: i64,
        end_timestamp: i64,
        min_roll: u32,
        max_roll: u32,
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
        reward_distributor.start_timestamp = start_timestamp;
        reward_distributor.end_timestamp = end_timestamp;
        reward_distributor.min_roll = min_roll;
        reward_distributor.max_roll = max_roll;
        let mut all_admins = vec![super_admin];
        all_admins.extend(admins.into_iter().filter(|k| *k != super_admin));
        reward_distributor.admins = all_admins;
        Ok(())
    }

    pub fn initialize_reward_metadata(
        ctx: Context<InitializeRewardMetadata>,
        reward_name: String,
        reward_type: RewardType,
        limit: u32,
        asset_accounts: Vec<Pubkey>,
        ix_accounts: Vec<Pubkey>,
    ) -> Result<()> {
        msg!(
            "Initializing reward metadata: {:?}",
            ctx.accounts.reward_metadata.key()
        );
        let reward_metadata = &mut ctx.accounts.reward_metadata;
        if reward_metadata.reward_distributor != Pubkey::default() {
            return Ok(());
        }
        reward_metadata.reward_name = reward_name;
        reward_metadata.bump = ctx.bumps.reward_metadata;
        reward_metadata.reward_distributor = ctx.accounts.reward_distributor.key();
        reward_metadata.reward_type = reward_type;
        reward_metadata.limit = limit;
        reward_metadata.count = 0;
        reward_metadata.draws = vec![];
        reward_metadata.asset_accounts = asset_accounts;
        reward_metadata.ix_accounts = ix_accounts;
        Ok(())
    }

    pub fn delegate_reward_metadata(
        ctx: Context<DelegateRewardMetadata>,
        reward_name: String,
    ) -> Result<()> {
        msg!(
            "Delegating reward metadata: {:?}",
            ctx.accounts.reward_metadata.key()
        );
        ctx.accounts.delegate_reward_metadata(
            &ctx.accounts.admin,
            &[
                REWARD_METADATA_SEED,
                ctx.accounts.reward_distributor.key().to_bytes().as_slice(),
                reward_name.as_bytes(),
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
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.user.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::ConsumeRandomReward::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta {
                    pubkey: ctx.accounts.reward_metadata.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.reward_metadata.key(),
                    is_signer: false,
                    is_writable: true,
                },
            ]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.user.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn consume_random_reward(
        ctx: Context<ConsumeRandomReward>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let reward_metadata = &mut ctx.accounts.reward_metadata;
        // Consume the randomness to update the reward metadata and trigger the reward distribution logic
        // For example, you can use the randomness to determine the reward tier and update the count of rewards distributed
        let rnd_u32 = ephemeral_vrf_sdk::rnd::random_u32(&randomness);
        msg!("Consuming random number for reward: {:?}", rnd_u32);

        reward_metadata.count = reward_metadata.count.saturating_add(1);
        reward_metadata.draws.push(rnd_u32);
        Ok(())
    }

    pub fn transfer_random_reward(ctx: Context<TransferRandomReward>) -> Result<()> {
        let reward_metadata = &ctx.accounts.reward_metadata;
        let reward_distributor = &ctx.accounts.reward_distributor;
        // Implement the logic to transfer the reward from the reward distributor to the user based on the reward metadata and the randomness consumed
        // For example, you can check the reward tier based on the last random number and transfer a specific SPL token or NFT to the user
        msg!("Transferring reward to user based on reward metadata and randomness...");
        Ok(())
    }

    pub fn undelegate_reward_metadata(
        ctx: Context<UndelegateRewardMetadata>,
        reward_name: String,
    ) -> Result<()> {
        msg!(
            "Undelegating reward metadata: {:?}",
            ctx.accounts.reward_metadata.key()
        );
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.reward_metadata.to_account_info()],
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
    #[account(init_if_needed, payer = initializer, space = 8 + 32 + 1 + 8 + 8 + 4 + 4 + 4 + 32 * 5, seeds = [REWARD_DISTRIBUTOR_SEED, initializer.key().as_ref()], bump)]
    pub reward_distributor: Account<'info, RewardDistributor>,
    pub system_program: Program<'info, System>,
}

// Admin initializes the reward metadata for a specific reward under a reward distributor with the rules of the reward (reward type, limit, etc)
#[derive(Accounts)]
#[instruction(reward_name: String)]
pub struct InitializeRewardMetadata<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init_if_needed, payer = admin, space = 8 + 36 + 1 + 32 + 1 + 4 + 4 + 4 + 4 + 4, seeds = [REWARD_METADATA_SEED, reward_distributor.key().as_ref(), reward_name.as_bytes()], bump)]
    pub reward_metadata: Account<'info, RewardMetadata>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    pub system_program: Program<'info, System>,
}

// Admin delegated the reward metadata account to a specific validator on ER to allow them to consume the randomness and distribute the rewards based on the rules defined in the reward metadata and reward distributor accounts
#[delegate]
#[derive(Accounts)]
#[instruction(reward_name: String)]
pub struct DelegateRewardMetadata<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK The pda to delegate
    #[account(mut, del, seeds = [REWARD_METADATA_SEED, reward_distributor.key().as_ref(), reward_name.as_bytes()], bump)]
    pub reward_metadata: Account<'info, RewardMetadata>,
    pub reward_distributor: Account<'info, RewardDistributor>,
}

// Admin undelegates the reward metadata account
#[commit]
#[derive(Accounts)]
#[instruction(reward_name: String)]
pub struct UndelegateRewardMetadata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [REWARD_METADATA_SEED, reward_distributor.key().as_ref(), reward_name.as_bytes()], bump)]
    pub reward_metadata: Account<'info, RewardMetadata>,
    pub reward_distributor: Account<'info, RewardDistributor>,
}

/// USER FLOW

// 1. User request randomness on ER
#[vrf]
#[derive(Accounts)]
pub struct RequestRandomReward<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub reward_metadata: Account<'info, RewardMetadata>,
    pub reward_distributor: Account<'info, RewardDistributor>,
    /// CHECK: Validated by address constraint against the known VRF oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

// 2. Callback from VRF Oracle with proof of randomness on ER that would initiate the reward transfer to the user as Magic Action
#[derive(Accounts)]
pub struct ConsumeRandomReward<'info> {
    /// This check ensure that the vrf_program_identity (which is a PDA) is a singer
    /// enforcing the callback is executed by the VRF program trough CPI
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub reward_metadata: Account<'info, RewardMetadata>,
    pub reward_distributor: Account<'info, RewardDistributor>,
}

// 3. Magic Action on Solana to transfer the reward from the reward distributor to the user after consuming the randomness
#[derive(Accounts)]
pub struct TransferRandomReward<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub reward_metadata: Account<'info, RewardMetadata>,
    pub reward_distributor: Account<'info, RewardDistributor>,
}

#[account]
pub struct RewardDistributor {
    pub super_admin: Pubkey,
    pub bump: u8,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub min_roll: u32,
    pub max_roll: u32,
    pub admins: Vec<Pubkey>,
}

#[account]
pub struct RewardMetadata {
    pub reward_name: String,
    pub bump: u8,
    pub reward_distributor: Pubkey,
    pub reward_type: RewardType,
    pub limit: u32,
    pub count: u32,
    pub draws: Vec<u32>,
    pub asset_accounts: Vec<Pubkey>,
    pub ix_accounts: Vec<Pubkey>,
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
*/
#[account]
pub struct RewardTransferLookupAccounts {
    pub reward_type: RewardType,
    pub readable_accounts: Vec<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum RewardType {
    SplToken,
    Nft,
}

impl RewardType {
    pub fn ix_accounts_len(&self) -> u8 {
        match self {
            RewardType::SplToken => 4,
            RewardType::Nft => 17,
        }
    }
}
