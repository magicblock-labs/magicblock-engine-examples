use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, ephemeral};
use ephemeral_rollups_sdk::cpi::{delegate_account_with_actions, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::dlp_api::args::{
    MaybeEncryptedAccountMeta, MaybeEncryptedInstruction, MaybeEncryptedIxData,
    MaybeEncryptedPubkey, PostDelegationActions,
};
use ephemeral_rollups_sdk::dlp_api::compact::AccountMeta as CompactAccountMeta;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("5rXD6yiNm7TshmEma5riBHQifTZj1whNc9PKJSr2q41B");

pub const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod magic_actions_on_delegation {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.counter.count = 0;
        msg!("Counter initialized!");
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        ctx.accounts.counter.count += 1;
        msg!(
            "PDA {} count: {} (signer: {})",
            ctx.accounts.counter.key(),
            ctx.accounts.counter.count,
            ctx.accounts.user.key(),
        );
        Ok(())
    }

    /// Delegates the counter PDA to the ER and queues an `increment` post-delegation
    /// action. The ER validator fires it automatically when the account is cloned —
    /// no separate increment transaction needed.
    pub fn delegate(ctx: Context<DelegateCounter>) -> Result<()> {
        let pda_key = ctx.accounts.pda.key();
        let increment_data =
            anchor_lang::InstructionData::data(&crate::instruction::Increment {});

        let payer_key = ctx.accounts.payer.key();

        // Key table: signers=[payer(0)], non_signers=[counter(1), program(2)]
        // payer signed the delegation tx, so the ER treats it as a valid signer for queued actions.
        let post_actions = PostDelegationActions {
            inserted_signers: 0,
            inserted_non_signers: 0,
            signers: vec![payer_key.to_bytes()],
            non_signers: vec![
                MaybeEncryptedPubkey::ClearText(pda_key.to_bytes()),
                MaybeEncryptedPubkey::ClearText(crate::ID.to_bytes()),
            ],
            instructions: vec![MaybeEncryptedInstruction {
                program_id: 2, // crate::ID at combined[2]
                accounts: vec![
                    // counter PDA at combined[1]: writable, not a signer
                    MaybeEncryptedAccountMeta::ClearText(CompactAccountMeta::new(1, false)),
                    // payer at combined[0]: read-only signer (user: Signer in Increment)
                    MaybeEncryptedAccountMeta::ClearText(CompactAccountMeta::new_readonly(0, true)),
                ],
                data: MaybeEncryptedIxData {
                    prefix: increment_data,
                    suffix: Default::default(),
                },
            }],
        };

        let validator: Option<Pubkey> = ctx
            .remaining_accounts
            .first()
            .map(|acc| *acc.key);

        delegate_account_with_actions(
            DelegateAccounts {
                payer: &ctx.accounts.payer,
                pda: &ctx.accounts.pda,
                owner_program: &ctx.accounts.owner_program,
                buffer: &ctx.accounts.delegate_buffer,
                delegation_record: &ctx.accounts.delegation_record,
                delegation_metadata: &ctx.accounts.delegation_metadata,
                delegation_program: &ctx.accounts.delegation_program,
                system_program: &ctx.accounts.system_program,
            },
            &[COUNTER_SEED],
            DelegateConfig {
                validator,
                ..Default::default()
            },
            post_actions,
            &[&ctx.accounts.payer], // payer signed the delegation tx; passed so SDK appends it to the CPI accounts
        )?;
        Ok(())
    }

    pub fn undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
            None,
        )?;
        Ok(())
    }
}

// ─── Account structs ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 8,
        seeds = [COUNTER_SEED],
        bump,
    )]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct DelegateCounter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Counter PDA being delegated.
    /// CHECK: key verified by seeds; owner is changed to the delegation program inside this ix
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub pda: AccountInfo<'info>,

    /// This program is recorded as owner_program in the delegation record.
    /// CHECK: always crate::ID
    #[account(address = crate::ID)]
    pub owner_program: AccountInfo<'info>,

    /// Temporary buffer — seeds derived under this program by the SDK.
    /// CHECK: created and closed within this instruction
    #[account(mut, seeds = [b"buffer", pda.key().as_ref()], bump)]
    pub delegate_buffer: AccountInfo<'info>,

    /// CHECK: delegation program validates the address
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,

    /// CHECK: delegation program validates the address
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,

    /// CHECK: address constraint ensures this is the MagicBlock delegation program
    #[account(address = ephemeral_rollups_sdk::id())]
    pub delegation_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateCounter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
pub struct Counter {
    pub count: u64,
}
