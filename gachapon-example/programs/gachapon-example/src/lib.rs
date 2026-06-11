use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar,
};
use mpl_core::instructions::CreateV2CpiBuilder;
use mpl_core::types::{Attribute, Attributes, Plugin, PluginAuthority, PluginAuthorityPair};

declare_id!("H7J1Ec8qibE13iajhAEK5jjRvgFxnZCUes7UjQqFiirj");

pub const MACHINE_SEED: &[u8] = b"machine";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const UPDATE_AUTHORITY_SEED: &[u8] = b"update_authority";
pub const VRF_IDENTITY_SEED: &[u8] = b"identity";
pub const PULL_SEED: &[u8] = b"pull";
pub const ASSET_SEED: &[u8] = b"asset";
pub const REWARD_COUNT: usize = 4;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_URI_LEN: usize = 160;
pub const TREASURY_TOP_UP_LAMPORTS: u64 = 50_000_000;
pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const VRF_PROGRAM_ID: Pubkey = pubkey!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
pub const DEFAULT_VRF_QUEUE: Pubkey = pubkey!("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
pub const VRF_PROGRAM_IDENTITY: Pubkey = pubkey!("9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw");

#[program]
pub mod gachapon_example {
    use super::*;

    pub fn init(ctx: Context<Init>, machine_id: u64) -> Result<()> {
        let machine = &mut ctx.accounts.machine;
        machine.authority = ctx.accounts.authority.key();
        machine.machine_id = machine_id;
        machine.bump = ctx.bumps.machine;
        machine.treasury_bump = ctx.bumps.treasury;
        machine.update_authority_bump = ctx.bumps.update_authority;
        machine.total_weight = 0;
        machine.pull_count = 0;
        machine.rewards = std::array::from_fn(|_| RewardTemplate::default());

        fund_treasury(
            &ctx.accounts.authority.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            TREASURY_TOP_UP_LAMPORTS,
        )?;

        msg!("Initialized gachapon machine {}", machine_id);
        Ok(())
    }

    pub fn upload_config(
        ctx: Context<UploadConfig>,
        rewards: [RewardTemplateInput; REWARD_COUNT],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.machine.authority,
            GachaponError::Unauthorized
        );

        let mut total_weight = 0u32;
        let mut templates: [RewardTemplate; REWARD_COUNT] =
            std::array::from_fn(|_| RewardTemplate::default());

        for (index, reward) in rewards.iter().enumerate() {
            require!(reward.weight > 0, GachaponError::InvalidWeight);
            require!(
                reward.name.as_bytes().len() <= MAX_NAME_LEN,
                GachaponError::NameTooLong
            );
            require!(
                reward.uri.as_bytes().len() <= MAX_URI_LEN,
                GachaponError::UriTooLong
            );

            total_weight = total_weight
                .checked_add(reward.weight)
                .ok_or(GachaponError::InvalidWeight)?;

            templates[index] = RewardTemplate {
                reward_id: index as u8,
                weight: reward.weight,
                minted_count: 0,
                name: reward.name.clone(),
                uri: reward.uri.clone(),
            };
        }

        let machine = &mut ctx.accounts.machine;
        machine.rewards = templates;
        machine.total_weight = total_weight;

        msg!(
            "Uploaded gachapon config with total weight {}",
            total_weight
        );
        Ok(())
    }

    pub fn pull(ctx: Context<Pull>, pull_id: u64, client_seed: u8) -> Result<()> {
        require!(
            ctx.accounts.machine.total_weight > 0,
            GachaponError::ConfigNotSet
        );
        require!(
            ctx.accounts.pending_pull.status == PullStatus::Pending as u8,
            GachaponError::PullAlreadySettled
        );

        let pending_pull = &mut ctx.accounts.pending_pull;
        pending_pull.machine = ctx.accounts.machine.key();
        pending_pull.player = ctx.accounts.player.key();
        pending_pull.asset = ctx.accounts.asset.key();
        pending_pull.pull_id = pull_id;
        pending_pull.reward_id = u8::MAX;
        pending_pull.status = PullStatus::Pending as u8;
        pending_pull.bump = ctx.bumps.pending_pull;
        pending_pull.asset_bump = ctx.bumps.asset;

        fund_treasury(
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            TREASURY_TOP_UP_LAMPORTS,
        )?;

        let callback_accounts = vec![
            SerializableAccountMeta {
                pubkey: ctx.accounts.player.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.machine.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.pending_pull.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.asset.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.treasury.key(),
                is_signer: false,
                is_writable: true,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.update_authority.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.system_program.key(),
                is_signer: false,
                is_writable: false,
            },
            SerializableAccountMeta {
                pubkey: ctx.accounts.mpl_core_program.key(),
                is_signer: false,
                is_writable: false,
            },
        ];

        let callback_identity_seeds: &[&[u8]] =
            &[VRF_IDENTITY_SEED, &[ctx.bumps.callback_identity]];
        let signer_seeds: &[&[&[u8]]] = &[callback_identity_seeds];

        let ix = create_request_randomness_ix(RawRequestRandomnessParams {
            payer: ctx.accounts.player.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::ConsumePull::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(callback_accounts),
            callback_args: Some(pull_id.to_le_bytes().to_vec()),
            ..Default::default()
        });

        invoke_signed(
            &ix,
            &[
                ctx.accounts.player.to_account_info(),
                ctx.accounts.callback_identity.to_account_info(),
                ctx.accounts.oracle_queue.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.slot_hashes.to_account_info(),
                ctx.accounts.vrf_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        msg!(
            "Requested gachapon pull {} for player {}",
            pull_id,
            ctx.accounts.player.key()
        );
        Ok(())
    }

    pub fn consume_pull(
        ctx: Context<ConsumePull>,
        randomness: [u8; 32],
        pull_id: u64,
    ) -> Result<()> {
        settle_pull(ctx, randomness, pull_id)
    }
}

fn settle_pull(ctx: Context<ConsumePull>, randomness: [u8; 32], pull_id: u64) -> Result<()> {
    require!(
        ctx.accounts.pending_pull.status == PullStatus::Pending as u8,
        GachaponError::PullAlreadySettled
    );
    require_eq!(
        ctx.accounts.pending_pull.pull_id,
        pull_id,
        GachaponError::InvalidPull
    );
    require_keys_eq!(
        ctx.accounts.pending_pull.machine,
        ctx.accounts.machine.key(),
        GachaponError::InvalidPull
    );
    require_keys_eq!(
        ctx.accounts.pending_pull.player,
        ctx.accounts.player.key(),
        GachaponError::InvalidPull
    );
    require_keys_eq!(
        ctx.accounts.pending_pull.asset,
        ctx.accounts.asset.key(),
        GachaponError::InvalidPull
    );
    require!(
        ctx.accounts.machine.total_weight > 0,
        GachaponError::ConfigNotSet
    );

    let reward_index = select_reward(&ctx.accounts.machine, &randomness)?;
    let reward = ctx.accounts.machine.rewards[reward_index].clone();

    let machine_key = ctx.accounts.machine.key();
    let player_key = ctx.accounts.player.key();
    let pull_id_bytes = pull_id.to_le_bytes();
    let asset_seeds: &[&[u8]] = &[
        ASSET_SEED,
        machine_key.as_ref(),
        player_key.as_ref(),
        pull_id_bytes.as_ref(),
        &[ctx.accounts.pending_pull.asset_bump],
    ];
    let treasury_seeds: &[&[u8]] = &[
        TREASURY_SEED,
        machine_key.as_ref(),
        &[ctx.accounts.machine.treasury_bump],
    ];
    let update_authority_seeds: &[&[u8]] = &[
        UPDATE_AUTHORITY_SEED,
        machine_key.as_ref(),
        &[ctx.accounts.machine.update_authority_bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[asset_seeds, treasury_seeds, update_authority_seeds];

    let attributes = vec![
        Attribute {
            key: "machine".to_string(),
            value: machine_key.to_string(),
        },
        Attribute {
            key: "pull_id".to_string(),
            value: pull_id.to_string(),
        },
        Attribute {
            key: "reward_id".to_string(),
            value: reward.reward_id.to_string(),
        },
    ];

    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .authority(Some(&ctx.accounts.update_authority.to_account_info()))
        .payer(&ctx.accounts.treasury.to_account_info())
        .owner(Some(&ctx.accounts.player.to_account_info()))
        .update_authority(Some(&ctx.accounts.update_authority.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(reward.name.clone())
        .uri(reward.uri.clone())
        .plugins(vec![PluginAuthorityPair {
            plugin: Plugin::Attributes(Attributes {
                attribute_list: attributes,
            }),
            authority: Some(PluginAuthority::UpdateAuthority),
        }])
        .invoke_signed(signer_seeds)?;

    let machine = &mut ctx.accounts.machine;
    machine.rewards[reward_index].minted_count =
        machine.rewards[reward_index].minted_count.saturating_add(1);
    machine.pull_count = machine.pull_count.saturating_add(1);

    let pending_pull = &mut ctx.accounts.pending_pull;
    pending_pull.reward_id = reward.reward_id;
    pending_pull.status = PullStatus::Settled as u8;

    msg!(
        "Settled pull {} with reward {} ({}) into asset {}",
        pull_id,
        reward.reward_id,
        reward.name,
        ctx.accounts.asset.key()
    );

    Ok(())
}

fn select_reward(machine: &Machine, randomness: &[u8; 32]) -> Result<usize> {
    let rnd = random_u32(randomness);
    let mut cursor = rnd % machine.total_weight;

    for (index, reward) in machine.rewards.iter().enumerate() {
        if cursor < reward.weight {
            return Ok(index);
        }
        cursor = cursor.saturating_sub(reward.weight);
    }

    err!(GachaponError::ConfigNotSet)
}

fn fund_treasury<'info>(
    from: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    anchor_lang::system_program::transfer(
        CpiContext::new(
            system_program.clone(),
            anchor_lang::system_program::Transfer {
                from: from.clone(),
                to: treasury.clone(),
            },
        ),
        lamports,
    )
}

#[derive(Accounts)]
#[instruction(machine_id: u64)]
pub struct Init<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Machine::INIT_SPACE,
        seeds = [MACHINE_SEED, authority.key().as_ref(), machine_id.to_le_bytes().as_ref()],
        bump
    )]
    pub machine: Account<'info, Machine>,
    /// CHECK: System-owned PDA funded by users and used as callback payer.
    #[account(mut, seeds = [TREASURY_SEED, machine.key().as_ref()], bump)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: PDA used as Metaplex Core update authority.
    #[account(seeds = [UPDATE_AUTHORITY_SEED, machine.key().as_ref()], bump)]
    pub update_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UploadConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub machine: Account<'info, Machine>,
}

#[derive(Accounts)]
#[instruction(pull_id: u64)]
pub struct Pull<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub machine: Account<'info, Machine>,
    #[account(
        init,
        payer = player,
        space = 8 + PendingPull::INIT_SPACE,
        seeds = [
            PULL_SEED,
            machine.key().as_ref(),
            player.key().as_ref(),
            pull_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_pull: Account<'info, PendingPull>,
    /// CHECK: Deterministic Metaplex Core asset PDA created during callback.
    #[account(
        mut,
        seeds = [
            ASSET_SEED,
            machine.key().as_ref(),
            player.key().as_ref(),
            pull_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: System-owned PDA funded by users and used as callback payer.
    #[account(mut, seeds = [TREASURY_SEED, machine.key().as_ref()], bump = machine.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: PDA used as Metaplex Core update authority.
    #[account(seeds = [UPDATE_AUTHORITY_SEED, machine.key().as_ref()], bump = machine.update_authority_bump)]
    pub update_authority: UncheckedAccount<'info>,
    /// CHECK: PDA that authorizes this program as the VRF callback target.
    #[account(seeds = [VRF_IDENTITY_SEED], bump)]
    pub callback_identity: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint against the known VRF queue.
    #[account(mut, address = DEFAULT_VRF_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: VRF program.
    #[account(address = VRF_PROGRAM_ID)]
    pub vrf_program: UncheckedAccount<'info>,
    /// CHECK: Slot hashes sysvar required by the VRF program.
    #[account(address = sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Validated by address constraint.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(randomness: [u8; 32], pull_id: u64)]
pub struct ConsumePull<'info> {
    #[account(address = VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    /// CHECK: Player receives the minted Core asset.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub machine: Account<'info, Machine>,
    #[account(
        mut,
        seeds = [
            PULL_SEED,
            machine.key().as_ref(),
            player.key().as_ref(),
            pull_id.to_le_bytes().as_ref()
        ],
        bump = pending_pull.bump
    )]
    pub pending_pull: Account<'info, PendingPull>,
    /// CHECK: Deterministic Metaplex Core asset PDA created by this callback.
    #[account(
        mut,
        seeds = [
            ASSET_SEED,
            machine.key().as_ref(),
            player.key().as_ref(),
            pull_id.to_le_bytes().as_ref()
        ],
        bump = pending_pull.asset_bump
    )]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: System-owned PDA funded by users and used as callback payer.
    #[account(mut, seeds = [TREASURY_SEED, machine.key().as_ref()], bump = machine.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: PDA used as Metaplex Core update authority.
    #[account(seeds = [UPDATE_AUTHORITY_SEED, machine.key().as_ref()], bump = machine.update_authority_bump)]
    pub update_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Validated by address constraint.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Machine {
    pub authority: Pubkey,
    pub machine_id: u64,
    pub bump: u8,
    pub treasury_bump: u8,
    pub update_authority_bump: u8,
    pub total_weight: u32,
    pub pull_count: u64,
    pub rewards: [RewardTemplate; REWARD_COUNT],
}

#[account]
#[derive(InitSpace)]
pub struct PendingPull {
    pub machine: Pubkey,
    pub player: Pubkey,
    pub asset: Pubkey,
    pub pull_id: u64,
    pub reward_id: u8,
    pub status: u8,
    pub bump: u8,
    pub asset_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct RewardTemplate {
    pub reward_id: u8,
    pub weight: u32,
    pub minted_count: u64,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_URI_LEN)]
    pub uri: String,
}

impl Default for RewardTemplate {
    fn default() -> Self {
        Self {
            reward_id: 0,
            weight: 0,
            minted_count: 0,
            name: String::new(),
            uri: String::new(),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RewardTemplateInput {
    pub weight: u32,
    pub name: String,
    pub uri: String,
}

#[repr(u8)]
pub enum PullStatus {
    Pending = 0,
    Settled = 1,
}

#[error_code]
pub enum GachaponError {
    #[msg("Only the machine authority may perform this action")]
    Unauthorized,
    #[msg("Reward weights must be positive and fit in u32")]
    InvalidWeight,
    #[msg("Reward name is too long")]
    NameTooLong,
    #[msg("Reward URI is too long")]
    UriTooLong,
    #[msg("Machine reward config has not been uploaded")]
    ConfigNotSet,
    #[msg("Pull is invalid")]
    InvalidPull,
    #[msg("Pull has already been settled")]
    PullAlreadySettled,
}

#[derive(Default)]
pub struct RawRequestRandomnessParams {
    pub payer: Pubkey,
    pub oracle_queue: Pubkey,
    pub callback_program_id: Pubkey,
    pub callback_discriminator: Vec<u8>,
    pub accounts_metas: Option<Vec<SerializableAccountMeta>>,
    pub caller_seed: [u8; 32],
    pub callback_args: Option<Vec<u8>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, PartialEq, Default)]
pub struct RequestRandomness {
    pub caller_seed: [u8; 32],
    pub callback_program_id: Pubkey,
    pub callback_discriminator: Vec<u8>,
    pub callback_accounts_metas: Vec<SerializableAccountMeta>,
    pub callback_args: Vec<u8>,
}

impl RequestRandomness {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = vec![3, 0, 0, 0, 0, 0, 0, 0];
        self.serialize(&mut bytes).unwrap();
        bytes
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, PartialEq, Default, Clone)]
pub struct SerializableAccountMeta {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

pub fn create_request_randomness_ix(params: RawRequestRandomnessParams) -> Instruction {
    Instruction {
        program_id: VRF_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(params.payer, true),
            AccountMeta::new_readonly(
                Pubkey::find_program_address(&[VRF_IDENTITY_SEED], &params.callback_program_id).0,
                true,
            ),
            AccountMeta::new(params.oracle_queue, false),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(sysvar::slot_hashes::ID, false),
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

pub fn random_u32(bytes: &[u8; 32]) -> u32 {
    u32::from_le_bytes([bytes[28], bytes[29], bytes[30], bytes[31]])
}
