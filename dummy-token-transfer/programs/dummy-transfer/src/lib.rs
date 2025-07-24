use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_and_undelegate_accounts};

declare_id!("Ckyvyxw2rrFmhAKxDa7qjfTridciYHRTetS1WPGmKdpo");

#[ephemeral]
#[program]
pub mod dummy_transfer {
    use super::*;

    /// Initialize the payer balance with 20 tokens
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let acc = &mut ctx.accounts.balance;
        acc.balance = 100;
        Ok(())
    }

    /// Delegate the balance
    pub fn delegate(ctx: Context<DelegateBalance>, params: DelegateParams) -> Result<()> {
        let config = DelegateConfig {
            commit_frequency_ms: params.commit_frequency_ms,
            validator: params.validator,
        };

        ctx.accounts.delegate_balance(
            &ctx.accounts.payer,
            &[ctx.accounts.payer.key.as_ref()],
            config,
        )?;
        Ok(())
    }

    /// Transfer an amount of tokens from the balance
    pub fn transfer(ctx: Context<Transfer>, amount: u64) -> Result<()> {
        let balance = &mut ctx.accounts.balance;
        let receiver_balance = &mut ctx.accounts.receiver_balance;
        if balance.balance < amount {
            return Err(error!(ErrorCode::InsufficientBalance));
        }
        balance.balance -= amount;
        receiver_balance.balance += amount;
        Ok(())
    }

    /// Undelegate the balance
    pub fn undelegate(ctx: Context<UndelegateBalance>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.balance.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + 8, seeds = [user.key.as_ref()], bump)]
    pub balance: Account<'info, Balance>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [payer.key.as_ref()], bump)]
    pub balance: Account<'info, Balance>,
    /// CHECK: anyone can receive the tokens
    pub receiver: AccountInfo<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + 8, seeds = [receiver.key.as_ref()], bump)]
    pub receiver_balance: Account<'info, Balance>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the correct balance
    #[account(mut, del, seeds = [payer.key.as_ref()], bump)]
    pub balance: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [payer.key.as_ref()], bump)]
    pub balance: Account<'info, Balance>,
}

#[account]
pub struct Balance {
    pub balance: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient balance for transfer")]
    InsufficientBalance,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DelegateParams {
    pub commit_frequency_ms: u32,
    pub validator: Option<Pubkey>,
}