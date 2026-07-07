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

declare_id!("28DbXYgx2bPUhmoGZpU87gtyktzSZgLJ8DcgqtKFCgtC");

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
    /// Whitelist token bag — created alongside reward_distributor so the
    /// two PDAs stay in lockstep. `init_if_needed` backfills the account
    /// on distributors that were created before this PDA existed.
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
    /// CHECK: Program data account to verify upgrade authority
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
    /// CHECK: Delegation record for reward_list — authority field contains the validator, used to derive magic_fee_vault for the callback
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct ConsumeRandomReward<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// CHECK: The user account is passed from the request_random_reward and used for the reward destination
    pub user: UncheckedAccount<'info>,
    pub reward_distributor: Account<'info, state::RewardDistributor>,
    #[account(mut, seeds = [constants::REWARD_LIST_SEED, reward_distributor.key().as_ref()], bump)]
    pub reward_list: Account<'info, state::RewardsList>,
    #[account(seeds = [constants::TRANSFER_LOOKUP_TABLE_SEED], bump)]
    pub transfer_lookup_table: Account<'info, state::TransferLookupTable>,
    /// CHECK: Magic fee vault — required when reward_list payer is delegated
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
    pub destination: UncheckedAccount<'info>,
    /// CHECK: Delegation record for reward_list — authority field contains the validator, used to derive magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
    /// CHECK: Magic fee vault — derived from the validator in the delegation record
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

/// Admin-triggered transfer of distributor-held assets to an arbitrary user,
/// outside the VRF/redemption flow. Enforces that the transfer does not eat
/// into assets committed to outstanding reward redemptions.
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
    /// CHECK: recipient pubkey (ATA is derived + created on base by the scheduled action)
    pub user: UncheckedAccount<'info>,
    /// CHECK: Delegation record for reward_list — authority field contains the validator, used to derive magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
    /// CHECK: Magic fee vault — derived from the validator in the delegation record
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

/// Whitelist-driven transfer from the per-distributor `whitelist_distributor`
/// PDA to a user. Runs on the ER (same Magic intent infrastructure as
/// `admin_transfer`) so the post-commit handler can sign the SPL CPI with
/// the whitelist_distributor PDA's seeds. Authorization (super_admin /
/// admin / whitelist member) is enforced via the `signer` constraint.
///
/// Unlike `admin_transfer`, the on-chain check is just an ATA-balance
/// check — the whitelist bag is intentionally separate from the reward
/// inventory, so there's no committed-amount math.
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
    /// CHECK: recipient pubkey (ATA derived + created on base by the scheduled action)
    pub user: UncheckedAccount<'info>,
    /// CHECK: Delegation record for reward_list — authority field contains the validator, used to derive magic_fee_vault
    #[account(address = ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account(&reward_list.key()))]
    pub delegation_record_reward_list: UncheckedAccount<'info>,
    /// CHECK: Magic fee vault — derived from the validator in the delegation record
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

/// Post-commit action for SPL/LegacyNFT transfers. `source_authority` is
/// the on-chain RewardDistributor OR WhitelistDistributor PDA — both share
/// the same `[8 disc][32 second_seed][1 bump]` prefix in their account
/// data, so a single handler can read the bump + second-seed from either
/// type without needing a typed `Account<T>` field. The `SourceKind` ix
/// param tells the handler which seed prefix to combine those with.
///
/// `escrow` (auto-injected by `#[action]`) is the Magic-managed SOL
/// escrow used to pay for any rent (destination ATA creation). It is
/// NOT the source-authority signer.
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
    /// CHECK: source authority PDA (RewardDistributor or WhitelistDistributor).
    /// Must be owned by this program and the SPL transfer will fail if its
    /// derived PDA doesn't match `source_token_account.owner`.
    #[account(owner = crate::ID)]
    pub source_authority: UncheckedAccount<'info>,
    /// CHECK: User/destination
    pub user: UncheckedAccount<'info>,
    /// CHECK: Associated Token Program
    pub associated_token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Source program
    #[account(address = crate::ID)]
    pub source_program: UncheckedAccount<'info>,
}

/// Post-commit action for programmable-NFT transfers. See
/// `TransferSplToken` for the unified-source rationale.
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
    /// CHECK: source authority PDA (RewardDistributor or WhitelistDistributor).
    /// Must be owned by this program and the Metaplex transfer will fail if
    /// its derived PDA doesn't match `source_token_account.owner`.
    #[account(owner = crate::ID)]
    pub source_authority: UncheckedAccount<'info>,
    /// CHECK: User/destination
    pub user: UncheckedAccount<'info>,
    /// CHECK: Associated Token Program
    pub associated_token_program: UncheckedAccount<'info>,
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
    pub source_program: UncheckedAccount<'info>,
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
