use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use ephemeral_rollups_sdk::anchor::{action, commit, ephemeral};
use ephemeral_rollups_sdk::cpi::{delegate_account_with_actions, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::dlp_api::args::{
    MaybeEncryptedAccountMeta, MaybeEncryptedInstruction, MaybeEncryptedIxData,
    MaybeEncryptedPubkey, PostDelegationActions,
};
use ephemeral_rollups_sdk::dlp_api::compact::AccountMeta as CompactAccountMeta;
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

declare_id!("Bvx67Z5gTY8qcVAfgG3yTS6KSQ7MivNSNYbiN7VNTVKv");

pub const COUNTER_SEED: &[u8] = b"counter";
pub const LEADERBOARD_SEED: &[u8] = b"leaderboard";
pub const GLOBAL_SIGNER_SEED: &[u8] = b"global_signer";

#[ephemeral]
#[program]
pub mod magic_actions_advanced {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.counter.count = 0;
        ctx.accounts.leaderboard.high_score = 0;
        msg!("Counter and Leaderboard initialized!");
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

    pub fn update_leaderboard(ctx: Context<UpdateLeaderboard>) -> Result<()> {
        let leaderboard = &mut ctx.accounts.leaderboard;
        let counter_info = &ctx.accounts.counter.to_account_info();
        let mut data: &[u8] = &counter_info.try_borrow_data()?;
        let counter = Counter::try_deserialize(&mut data)?;
        if counter.count > leaderboard.high_score {
            leaderboard.high_score = counter.count;
        }
        msg!("Leaderboard updated! High score: {}", leaderboard.high_score);
        Ok(())
    }

    /// Delegates the counter PDA and queues an `increment` post-delegation action.
    /// The ER validator fires it automatically when the account is first cloned —
    /// no separate increment transaction needed.
    pub fn delegate(ctx: Context<DelegateCounter>) -> Result<()> {
        let pda_key = ctx.accounts.pda.key();
        let payer_key = ctx.accounts.payer.key();
        let increment_data =
            anchor_lang::InstructionData::data(&crate::instruction::Increment {});

        // Key table: signers=[payer(0)], non_signers=[counter(1), program(2)]
        // payer signed the delegation tx, so the ER treats it as a valid signer
        // for the queued Increment (which requires user: Signer<'info>).
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

        let validator = ctx.remaining_accounts.first().map(|acc| *acc.key);

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
            &[&ctx.accounts.payer],
        )?;
        Ok(())
    }

    pub fn undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Commits the counter PDA and fires `update_leaderboard` on the base layer.
    /// Uses `global_signer` PDA as escrow authority so the protocol pays the
    /// magic-action fee instead of the user's wallet.
    ///
    /// Uses `.build()` + AccountMeta patch + `invoke_signed` because
    /// `build_and_invoke()` calls `invoke()` which cannot sign as a PDA.
    pub fn commit_and_update_leaderboard(ctx: Context<CommitAndUpdateLeaderboard>) -> Result<()> {
        let instruction_data =
            anchor_lang::InstructionData::data(&crate::instruction::UpdateLeaderboard {});
        let action = CallHandler {
            destination_program: crate::ID,
            accounts: vec![
                ShortAccountMeta {
                    pubkey: ctx.accounts.leaderboard.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: ctx.accounts.counter.key(),
                    is_writable: false,
                },
            ],
            args: ActionArgs::new(instruction_data),
            escrow_authority: ctx.accounts.global_signer.to_account_info(),
            compute_units: 200_000,
        };

        let global_signer_key = ctx.accounts.global_signer.key();
        let bump = ctx.bumps.global_signer;
        let signer_seeds: &[&[&[u8]]] = &[&[GLOBAL_SIGNER_SEED, &[bump]]];

        let ephemeral_rollups_sdk::ephem::IntentInstructions {
            schedule_intent_ix: (accounts, mut ix),
            add_callback_ixs,
        } = MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.counter.to_account_info()])
        .add_post_commit_actions([action])
        .build();

        // Mark global_signer as signer so the MagicProgram CPI accepts it.
        // invoke_signed with the PDA seeds authorises it at the runtime level.
        for meta in ix.accounts.iter_mut() {
            if meta.pubkey == global_signer_key {
                meta.is_signer = true;
            }
        }
        invoke_signed(&ix, &accounts, signer_seeds)?;

        // Fire any AddActionCallback instructions (none expected here, but handle gracefully).
        // These CPIs go to the magic program directly — global_signer is not a signer there.
        for (cb_accounts, cb_ix) in add_callback_ixs {
            invoke_signed(&cb_ix, &cb_accounts, &[])?;
        }

        Ok(())
    }
}

// ─── Account structs ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
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

#[action]
#[derive(Accounts)]
pub struct UpdateLeaderboard<'info> {
    #[account(mut, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
    /// CHECK: owner varies (delegation program when delegated, this program when not);
    /// address locked by seeds constraint
    #[account(seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
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

#[commit]
#[derive(Accounts)]
pub struct CommitAndUpdateLeaderboard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,

    /// CHECK: Leaderboard PDA — not mut here, writable set in the CallHandler
    #[account(seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: UncheckedAccount<'info>,

    /// CHECK: System-owned PDA — signing authority for the escrow, never initialised
    #[account(seeds = [GLOBAL_SIGNER_SEED], bump)]
    pub global_signer: UncheckedAccount<'info>,

    /// CHECK: This program's own ID — required by MagicIntentBundleBuilder
    pub program_id: AccountInfo<'info>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
pub struct Counter {
    pub count: u64,
}

#[account]
pub struct Leaderboard {
    pub high_score: u64,
}
