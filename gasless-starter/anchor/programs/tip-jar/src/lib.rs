use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("DzY7Cgt6NJDSbM2QCjERGbnBSFvab1ZamxRWLatY8Gwm");

pub const JAR_SEED: &[u8] = b"jar";

/// A tip jar that runs on an Ephemeral Rollup.
///
/// Setup (`create_jar`, `delegate_jar`) happens once on the base layer and needs SOL.
/// Everything else runs on the ER, where transactions are free: users sign with a
/// wallet that holds no SOL. Users move USDC in and out of the ER with the gasless
/// Payments API, which is not part of this program.
#[ephemeral]
#[program]
pub mod tip_jar {
    use super::*;

    /// Base layer. Create a jar that collects `mint` tips for `authority`.
    /// `payer` covers rent and may differ from `authority`. The authority must
    /// sign, so nobody can claim the jar address of a wallet they don't own.
    pub fn create_jar(ctx: Context<CreateJar>, validator: Pubkey) -> Result<()> {
        ctx.accounts.jar.set_inner(Jar {
            authority: ctx.accounts.authority.key(),
            mint: ctx.accounts.mint.key(),
            validator,
            total_tipped: 0,
            tip_count: 0,
            bump: ctx.bumps.jar,
        });
        Ok(())
    }

    /// Base layer. Delegate the jar to the validator chosen at creation. Anyone may
    /// call this, but the jar can only ever go to that one validator.
    pub fn delegate_jar(ctx: Context<DelegateJar>) -> Result<()> {
        require_keys_eq!(*ctx.accounts.jar.owner, crate::ID, TipJarError::InvalidJar);
        let jar = Jar::try_deserialize(&mut &ctx.accounts.jar.try_borrow_data()?[..])?;
        ctx.accounts.delegate_jar(
            &ctx.accounts.payer,
            &[JAR_SEED, jar.authority.as_ref()],
            DelegateConfig {
                validator: Some(jar.validator),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER. Move `amount` from the tipper's token account into the jar.
    pub fn tip(ctx: Context<Tip>, amount: u64) -> Result<()> {
        require!(amount > 0, TipJarError::InvalidAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.tipper_token.to_account_info(),
                    to: ctx.accounts.jar_token.to_account_info(),
                    authority: ctx.accounts.tipper.to_account_info(),
                },
            ),
            amount,
        )?;
        let jar = &mut ctx.accounts.jar;
        jar.total_tipped = jar
            .total_tipped
            .checked_add(amount)
            .ok_or(TipJarError::Overflow)?;
        jar.tip_count = jar.tip_count.checked_add(1).ok_or(TipJarError::Overflow)?;
        Ok(())
    }

    /// ER. The jar authority moves `amount` out of the jar. The jar PDA signs the transfer.
    pub fn withdraw_tips(ctx: Context<WithdrawTips>, amount: u64) -> Result<()> {
        require!(amount > 0, TipJarError::InvalidAmount);
        let jar = &ctx.accounts.jar;
        let signer_seeds: &[&[&[u8]]] = &[&[JAR_SEED, jar.authority.as_ref(), &[jar.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.jar_token.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.jar.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    /// ER. Write the jar's current state back to the base layer. It stays delegated.
    pub fn commit_jar(ctx: Context<CommitJar>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.jar.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// ER. Commit the jar and hand it back to the base layer.
    pub fn undelegate_jar(ctx: Context<CommitJar>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.jar.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateJar<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Jar::INIT_SPACE,
        seeds = [JAR_SEED, authority.key().as_ref()],
        bump
    )]
    pub jar: Account<'info, Jar>,
    pub mint: Account<'info, Mint>,
    /// The jar's own token account. Its ephemeral ATA is delegated off-program
    /// (see `scripts/create-jar.ts`) so the ER can move tokens in and out of it.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = jar
    )]
    pub jar_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateJar<'info> {
    pub payer: Signer<'info>,
    /// CHECK: checked in the handler: owned by this program and holds a `Jar`.
    #[account(mut, del)]
    pub jar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Tip<'info> {
    /// Signs and pays the (zero) ER fee. Needs no SOL.
    pub tipper: Signer<'info>,
    #[account(mut, token::mint = jar.mint, token::authority = tipper)]
    pub tipper_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [JAR_SEED, jar.authority.as_ref()], bump = jar.bump)]
    pub jar: Account<'info, Jar>,
    #[account(mut, associated_token::mint = jar.mint, associated_token::authority = jar)]
    pub jar_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawTips<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [JAR_SEED, jar.authority.as_ref()], bump = jar.bump, has_one = authority)]
    pub jar: Account<'info, Jar>,
    #[account(mut, associated_token::mint = jar.mint, associated_token::authority = jar)]
    pub jar_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = jar.mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitJar<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [JAR_SEED, jar.authority.as_ref()], bump = jar.bump, has_one = authority)]
    pub jar: Account<'info, Jar>,
}

#[account]
#[derive(InitSpace)]
pub struct Jar {
    pub authority: Pubkey,
    pub mint: Pubkey,
    /// The only validator this jar may be delegated to.
    pub validator: Pubkey,
    pub total_tipped: u64,
    pub tip_count: u64,
    pub bump: u8,
}

#[error_code]
pub enum TipJarError {
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("account is not a tip jar")]
    InvalidJar,
    #[msg("arithmetic overflow")]
    Overflow,
}
