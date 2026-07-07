use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use ephemeral_rollups_sdk::anchor::{delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

declare_id!("Fnt7NAnsay3ZPStiVdjwHJxQLoNUGaH7MHMPNSjrdKXV");

/// Ephemeral SPL Token program ("e-token").
pub const EPHEMERAL_SPL_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");

/// e-token instruction discriminator for `undelegate_ephemeral_ata`
/// (matches the SDK's `undelegateIx`, which sends `data = [5]`).
const ETOKEN_UNDELEGATE_IX: u8 = 5;

/// Seed prefix for the authority PDA that owns the ephemeral ATA. The mint is
/// mixed in so each mint gets a fresh authority (keeps the example re-runnable).
pub const AUTHORITY_SEED: &[u8] = b"authority";

#[ephemeral]
#[program]
pub mod eata_pda_undelegate {
    use super::*;

    /// Create the authority PDA as a program-owned account so it can later be
    /// delegated to the ER (making the eATA's owner "a delegated account").
    pub fn init_authority(ctx: Context<InitAuthority>) -> Result<()> {
        ctx.accounts.authority.bump = ctx.bumps.authority;
        Ok(())
    }

    /// Delegate the authority PDA itself to the ER.
    pub fn delegate_authority(ctx: Context<DelegateAuthority>) -> Result<()> {
        let mint_key = ctx.accounts.mint.key();
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[AUTHORITY_SEED, mint_key.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Undelegate an ephemeral ATA whose SPL authority (`owner`) is this
    /// program's (delegated) PDA. Same e-token `undelegate` the SDK builds,
    /// but issued as a CPI so the PDA owner can sign via `invoke_signed`.
    ///
    /// e-token's `undelegate_ephemeral_ata` then calls
    /// `commit_and_undelegate_accounts(.., None /*fee vault*/, None /*seeds*/)`
    /// — the lines under investigation.
    pub fn undelegate_owned_eata(ctx: Context<UndelegateOwnedEata>) -> Result<()> {
        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.authority;

        // e-token `undelegate` (5-account layout, matching commit c7e9fff):
        //   0: owner (signer)  -> our PDA
        //   1: user_ata (writable)
        //   2: ephemeral_ata (readonly)
        //   3: magic_context (writable)
        //   4: magic_program (readonly)
        let ix = Instruction {
            program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(ctx.accounts.authority.key(), true),
                AccountMeta::new(ctx.accounts.user_ata.key(), false),
                AccountMeta::new_readonly(ctx.accounts.ephemeral_ata.key(), false),
                AccountMeta::new(ctx.accounts.magic_context.key(), false),
                AccountMeta::new_readonly(ctx.accounts.magic_program.key(), false),
            ],
            data: vec![ETOKEN_UNDELEGATE_IX],
        };

        invoke_signed(
            &ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.user_ata.to_account_info(),
                ctx.accounts.ephemeral_ata.to_account_info(),
                ctx.accounts.magic_context.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
                ctx.accounts.ephemeral_spl_token_program.to_account_info(),
            ],
            &[&[AUTHORITY_SEED, mint_key.as_ref(), &[bump]]],
        )?;

        Ok(())
    }
}

#[account]
pub struct AuthorityState {
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitAuthority<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 1,
        seeds = [AUTHORITY_SEED, mint.key().as_ref()],
        bump
    )]
    pub authority: Account<'info, AuthorityState>,
    /// CHECK: mint the authority is scoped to; only its key is used as a seed.
    pub mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAuthority<'info> {
    pub payer: Signer<'info>,
    /// CHECK: mint the authority is scoped to; only its key is used as a seed.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: the authority PDA to delegate.
    #[account(mut, del, seeds = [AUTHORITY_SEED, mint.key().as_ref()], bump)]
    pub pda: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UndelegateOwnedEata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: mint the authority is scoped to; only its key is used as a seed.
    pub mint: UncheckedAccount<'info>,

    /// The (delegated) PDA that owns the ephemeral ATA.
    /// CHECK: PDA, validated by seeds; only used to sign the CPI. It is a
    /// delegated account here, so it is NOT deserialized as an owned account.
    #[account(seeds = [AUTHORITY_SEED, mint.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: the user ATA for [mint, authority]; validated by e-token.
    #[account(mut)]
    pub user_ata: UncheckedAccount<'info>,

    /// CHECK: the ephemeral ATA PDA [authority, mint]; validated by e-token.
    pub ephemeral_ata: UncheckedAccount<'info>,

    /// CHECK: magic context; validated by the magic program.
    #[account(mut)]
    pub magic_context: UncheckedAccount<'info>,

    /// CHECK: magic program.
    pub magic_program: UncheckedAccount<'info>,

    /// CHECK: e-token program we CPI into.
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    pub ephemeral_spl_token_program: UncheckedAccount<'info>,
}
