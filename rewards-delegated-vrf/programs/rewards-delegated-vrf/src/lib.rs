#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use ephemeral_rollups_sdk::anchor::{action, commit, delegate, ephemeral};
use ephemeral_vrf_sdk::anchor::vrf;

pub mod constants;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod state;

declare_id!("rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y");

#[ephemeral]
#[program]
pub mod rewards_delegated_vrf {

    use super::*;

    pub fn initialize_reward_distributor(
        ctx: Context<InitializeRewardDistributor>,
        admins: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::initialize_reward_distributor::initialize_reward_distributor(ctx, admins)
    }

    pub fn set_admins(ctx: Context<SetAdmins>, admins: Vec<Pubkey>) -> Result<()> {
        instructions::set_admins::set_admins(ctx, admins)
    }

    pub fn set_whitelist(ctx: Context<SetWhitelist>, whitelist: Vec<Pubkey>) -> Result<()> {
        instructions::set_whitelist::set_whitelist(ctx, whitelist)
    }

    pub fn set_reward_list(
        ctx: Context<SetRewardList>,
        start_timestamp: Option<i64>,
        end_timestamp: Option<i64>,
        global_range_min: Option<u32>,
        global_range_max: Option<u32>,
    ) -> Result<()> {
        instructions::set_reward_list::set_reward_list(
            ctx,
            start_timestamp,
            end_timestamp,
            global_range_min,
            global_range_max,
        )
    }

    pub fn initialize_transfer_lookup_table(
        ctx: Context<InitializeTransferLookupTable>,
        lookup_accounts: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::initialize_transfer_lookup_table::initialize_transfer_lookup_table(
            ctx,
            lookup_accounts,
        )
    }

    pub fn delegate_reward_list(ctx: Context<DelegateRewardList>) -> Result<()> {
        instructions::delegate_reward_list::delegate_reward_list(ctx)
    }

    pub fn request_random_reward(ctx: Context<RequestRandomReward>, client_seed: u8) -> Result<()> {
        instructions::request_random_reward::request_random_reward(ctx, client_seed)
    }

    pub fn consume_random_reward(
        ctx: Context<ConsumeRandomReward>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::consume_random_reward::consume_random_reward(ctx, randomness)
    }

    pub fn transfer_reward_spl_token(
        ctx: Context<TransferRewardSplToken>,
        amount: u64,
    ) -> Result<()> {
        instructions::transfer_reward_spl_token::transfer_reward_spl_token(ctx, amount)
    }

    pub fn transfer_reward_programmable_nft(
        ctx: Context<TransferRewardProgrammableNft>,
        amount: u64,
    ) -> Result<()> {
        instructions::transfer_reward_programmable_nft::transfer_reward_programmable_nft(
            ctx, amount,
        )
    }

    pub fn undelegate_reward_list(ctx: Context<UndelegateRewardList>) -> Result<()> {
        instructions::undelegate_reward_list::undelegate_reward_list(ctx)
    }

    pub fn add_reward(
        ctx: Context<AddReward>,
        reward_name: String,
        reward_amount: Option<u64>,
        draw_range_min: Option<u32>,
        draw_range_max: Option<u32>,
        redemption_limit: Option<u64>,
    ) -> Result<()> {
        instructions::add_reward::add_reward(
            ctx,
            reward_name,
            reward_amount,
            draw_range_min,
            draw_range_max,
            redemption_limit,
        )
    }

    pub fn remove_reward(
        ctx: Context<RemoveReward>,
        reward_name: String,
        mint_to_remove: Option<Pubkey>,
        redemption_amount: Option<u64>,
    ) -> Result<()> {
        instructions::remove_reward::remove_reward(
            ctx,
            reward_name,
            mint_to_remove,
            redemption_amount,
        )
    }

    pub fn update_reward(
        ctx: Context<UpdateReward>,
        current_reward_name: String,
        updated_reward_name: Option<String>,
        reward_amount: Option<u64>,
        draw_range_min: Option<u32>,
        draw_range_max: Option<u32>,
    ) -> Result<()> {
        instructions::update_reward::update_reward(
            ctx,
            current_reward_name,
            updated_reward_name,
            reward_amount,
            draw_range_min,
            draw_range_max,
        )
    }
}

#[derive(Accounts)]
pub struct InitializeRewardDistributor<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(init_if_needed, payer = initializer, space = 8 + 32 + 1 + 4 + (32 * 10) + 4 + (32 * 10), seeds = [constants::REWARD_DISTRIBUTOR_SEED, initializer.key().as_ref()], bump)]
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAdmins<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub reward_distributor: Account<'info, state::RewardDistributor>,
}

#[derive(Accounts)]
pub struct SetWhitelist<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub reward_distributor: Account<'info, state::RewardDistributor>,
}

#[derive(Accounts)]
pub struct SetRewardList<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(init_if_needed, payer = admin, space = constants::REWARD_LIST_SPACE, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeTransferLookupTable<'info> {
    #[account(mut, constraint = authority.key() == program_data.upgrade_authority_address.ok_or(ProgramError::InvalidArgument)?)]
    pub authority: Signer<'info>,
    /// CHECK: Program data account to verify upgrade authority
    pub program_data: Account<'info, ProgramData>,
    #[account(init_if_needed, payer = authority, space = 8 + 1 + 4 + 32 * 33, seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRewardList<'info> {
    #[account(mut, constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    /// CHECK: The pda to delegate
    #[account(mut, del, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomReward<'info> {
    /// CHECK: User/destination
    pub user: AccountInfo<'info>,
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()) || reward_distributor.whitelist.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    /// CHECK: Validated by address constraint against the known VRF oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct ConsumeRandomReward<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// CHECK: The user account is passed from the request_random_reward and used for the reward destination
    pub user: AccountInfo<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
}

#[derive(Accounts)]
pub struct AddReward<'info> {
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        constraint = token_account.owner == reward_distributor.key() @errors::RewardError::TokenNotOwnedByDistributor,
        constraint = token_account.mint == mint.key() @errors::RewardError::InvalidTokenAccount
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Optional Metaplex metadata PDA. It may be absent or uninitialized for fungible tokens.
    pub metadata: Option<UncheckedAccount<'info>>,
}

#[commit]
#[derive(Accounts)]
pub struct RemoveReward<'info> {
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    /// CHECK: destination of the removed reward
    pub destination: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdateReward<'info> {
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    pub mint: Option<InterfaceAccount<'info, Mint>>,
    pub token_account: Option<InterfaceAccount<'info, TokenAccount>>,
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
    pub reward_distributor: Account<'info, state::RewardDistributor>,
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
    pub reward_distributor: Account<'info, state::RewardDistributor>,
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

#[commit]
#[derive(Accounts)]
pub struct UndelegateRewardList<'info> {
    #[account(mut, constraint = payer.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&payer.key()))]
    pub payer: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
}
