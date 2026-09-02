#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::Metadata;
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

    pub fn transfer_spl_token(
        ctx: Context<TransferSplToken>,
        amount: u64,
        source: state::SourceKind,
    ) -> Result<()> {
        instructions::transfer_spl_token::transfer_spl_token(ctx, amount, source)
    }

    pub fn transfer_programmable_nft(
        ctx: Context<TransferProgrammableNft>,
        amount: u64,
        source: state::SourceKind,
    ) -> Result<()> {
        instructions::transfer_programmable_nft::transfer_programmable_nft(ctx, amount, source)
    }

    pub fn admin_transfer(ctx: Context<AdminTransfer>, amount: u64) -> Result<()> {
        instructions::admin_transfer::admin_transfer(ctx, amount)
    }

    pub fn whitelist_transfer(ctx: Context<WhitelistTransfer>, amount: u64) -> Result<()> {
        instructions::whitelist_transfer::whitelist_transfer(ctx, amount)
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
    /// Whitelist token bag. `init_if_needed` backfills it for distributors
    /// created before this PDA existed.
    #[account(init_if_needed, payer = initializer, space = 8 + state::WhitelistDistributor::MAX_SIZE, seeds = [constants::WHITELIST_DISTRIBUTOR_SEED, reward_distributor.key().as_ref()], bump)]
    pub whitelist_distributor: Account<'info, state::WhitelistDistributor>,
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
    /// Binds `program_data` to this program; without it any upgradeable
    /// program's ProgramData (and its authority) would satisfy the check.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ errors::RewardError::Unauthorized)]
    pub program: Program<'info, crate::program::RewardsDelegatedVrf>,
    pub program_data: Account<'info, ProgramData>,
    #[account(init_if_needed, payer = authority, space = 8 + 1 + 4 + 32 * 33, seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRewardList<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Reward distributor PDA
    pub reward_distributor: UncheckedAccount<'info>,
    /// CHECK: The pda to delegate
    #[account(mut, del, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomReward<'info> {
    /// CHECK: User/destination
    pub user: UncheckedAccount<'info>,
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()) || reward_distributor.whitelist.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    /// CHECK: Validated by address constraint against the known VRF oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: reward_list delegation record; its validator derives magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct ConsumeRandomReward<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// CHECK: reward recipient, as passed to request_random_reward
    pub user: UncheckedAccount<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    /// CHECK: Magic fee vault, required while reward_list is delegated
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
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
    /// CHECK: optional Metaplex metadata PDA (absent for fungible tokens)
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
    pub destination: UncheckedAccount<'info>,
    /// CHECK: reward_list delegation record; its validator derives magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
    /// CHECK: Magic fee vault of the delegating validator
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

/// Admin transfer of distributor-held assets to a user, outside the VRF flow.
/// Cannot spend assets committed to outstanding reward redemptions.
#[commit]
#[derive(Accounts)]
pub struct AdminTransfer<'info> {
    #[account(constraint = admin.key() == reward_distributor.super_admin || reward_distributor.admins.contains(&admin.key()))]
    pub admin: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        associated_token::mint = mint,
        associated_token::authority = reward_distributor,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: recipient; ATA is created on base by the scheduled action
    pub user: UncheckedAccount<'info>,
    /// CHECK: reward_list delegation record; its validator derives magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
    /// CHECK: Magic fee vault of the delegating validator
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

/// Transfer from the `whitelist_distributor` PDA to a user, callable by
/// super_admin / admins / whitelist members (see `signer` constraint).
/// Same ER + post-commit flow as `admin_transfer`, but the whitelist bag is
/// separate from the reward inventory, so only an ATA-balance check applies.
#[commit]
#[derive(Accounts)]
pub struct WhitelistTransfer<'info> {
    #[account(
        constraint = signer.key() == reward_distributor.super_admin
            || reward_distributor.admins.contains(&signer.key())
            || reward_distributor.whitelist.contains(&signer.key())
            @ errors::RewardError::Unauthorized
    )]
    pub signer: Signer<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(
        seeds = [constants::WHITELIST_DISTRIBUTOR_SEED, reward_distributor.key().as_ref()],
        bump = whitelist_distributor.bump,
        constraint = whitelist_distributor.reward_distributor == reward_distributor.key() @ errors::RewardError::Unauthorized
    )]
    pub whitelist_distributor: Account<'info, state::WhitelistDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        associated_token::mint = mint,
        associated_token::authority = whitelist_distributor,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: recipient; ATA is created on base by the scheduled action
    pub user: UncheckedAccount<'info>,
    /// CHECK: reward_list delegation record; its validator derives magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
    /// CHECK: Magic fee vault of the delegating validator
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
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

/// Escrow index used when scheduling post-commit actions (`ActionArgs::new`
/// default). The escrow PDA is `[b"balance", escrow_auth, index]`, so the
/// action handlers must validate against the same value.
pub const ACTION_ESCROW_INDEX: u8 = 255;

/// Post-commit action for SPL / legacy-NFT transfers.
///
/// `source_authority` is either a RewardDistributor or WhitelistDistributor
/// PDA; both share the `[disc][second_seed][bump]` layout, so one handler
/// reads the seeds from either and `SourceKind` picks the seed prefix.
/// `escrow` (Magic SOL escrow) pays rent and is the only signer the
/// delegation program provides, which is what gates this instruction.
#[action]
#[derive(Accounts)]
pub struct TransferSplToken<'info> {
    pub token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    /// CHECK: destination Token Account
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: RewardDistributor or WhitelistDistributor PDA; must be owned by
    /// this program. The transfer CPI fails if it isn't `source_token_account.owner`.
    #[account(owner = crate::ID)]
    pub source_authority: UncheckedAccount<'info>,
    /// CHECK: User/destination
    pub user: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: Source program
    #[account(address = crate::ID)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: Must equal `source_authority`, which is the only escrow authority
    /// this program schedules actions with — proves the action came from us.
    #[account(address = source_authority.key() @ errors::RewardError::Unauthorized)]
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: Magic SOL escrow PDA (rent payer). Only the delegation program
    /// can sign for it, so `signer` restricts this ix to the post-commit path.
    #[account(
        signer @ errors::RewardError::Unauthorized,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(
            &escrow_auth.key(),
            ACTION_ESCROW_INDEX,
        ) @ errors::RewardError::Unauthorized,
    )]
    pub escrow: UncheckedAccount<'info>,
}

/// Post-commit action for programmable-NFT transfers; see `TransferSplToken`.
#[action]
#[derive(Accounts)]
pub struct TransferProgrammableNft<'info> {
    pub token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    /// CHECK: destination Token Account
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: RewardDistributor or WhitelistDistributor PDA; must be owned by
    /// this program. The transfer CPI fails if it isn't `source_token_account.owner`.
    #[account(owner = crate::ID)]
    pub source_authority: UncheckedAccount<'info>,
    /// CHECK: User/destination
    pub user: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_metadata_program: Program<'info, Metadata>,
    /// CHECK: pinned to the Instructions sysvar
    #[account(address = constants::SYSVAR_INSTRUCTIONS_ID)]
    pub sysvar_instruction_program: UncheckedAccount<'info>,
    /// CHECK: pinned to the Metaplex Token Auth Rules program
    #[account(address = constants::MPL_TOKEN_AUTH_RULES_ID)]
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
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: Must equal `source_authority`, which is the only escrow authority
    /// this program schedules actions with — proves the action came from us.
    #[account(address = source_authority.key() @ errors::RewardError::Unauthorized)]
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: Magic SOL escrow PDA (rent payer). Only the delegation program
    /// can sign for it, so `signer` restricts this ix to the post-commit path.
    #[account(
        signer @ errors::RewardError::Unauthorized,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(
            &escrow_auth.key(),
            ACTION_ESCROW_INDEX,
        ) @ errors::RewardError::Unauthorized,
    )]
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
