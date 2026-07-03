use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_option::COption,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::error::ErrorCode;
use crate::state::Direction;
use crate::{
    ASSOCIATED_TOKEN_PROGRAM_ID, BASIS_POINTS_DENOMINATOR, DELEGATION_PROGRAM_ID,
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID, MAX_PRICE_AGE_SECONDS, POOL_SEED,
};

/// Reads a fresh price from the Pyth receiver account.
/// This example rejects stale prices with a fixed max age.
pub(crate) fn read_price(
    price_update_account: &UncheckedAccount,
    feed_id: &[u8; 32],
) -> Result<i64> {
    let price_update_info = price_update_account.to_account_info();
    let data_ref = price_update_info.data.borrow();
    let price_update = PriceUpdateV2::try_deserialize_unchecked(&mut data_ref.as_ref())
        .map_err(Into::<Error>::into)?;
    let price =
        price_update.get_price_no_older_than(&Clock::get()?, MAX_PRICE_AGE_SECONDS, feed_id)?;
    Ok(price.price)
}

/// Confirms an SPL token account delegated enough allowance to the Pool PDA.
pub(crate) fn require_token_delegate(
    token_account: &Account<TokenAccount>,
    delegate_authority: Pubkey,
    amount: u64,
) -> Result<()> {
    match token_account.delegate {
        COption::Some(delegate) => {
            require_keys_eq!(
                delegate,
                delegate_authority,
                ErrorCode::InvalidTokenDelegate
            )
        }
        COption::None => return err!(ErrorCode::InvalidTokenDelegate),
    }
    require!(
        token_account.delegated_amount >= amount,
        ErrorCode::InsufficientDelegatedAmount
    );
    Ok(())
}

/// Calculates a payout from a stake and a basis-point multiplier.
pub(crate) fn checked_payout(stake: u64, payout_bps: u64) -> Result<u64> {
    stake
        .checked_mul(payout_bps)
        .and_then(|value| value.checked_div(BASIS_POINTS_DENOMINATOR))
        .ok_or(ErrorCode::MathOverflow.into())
}

/// Returns the price direction between opening and settlement.
pub(crate) fn outcome(settle_price: i64, open_price: i64) -> Result<Direction> {
    if settle_price > open_price {
        Ok(Direction::Up)
    } else if settle_price < open_price {
        Ok(Direction::Down)
    } else {
        err!(ErrorCode::TieHasNoDirection)
    }
}

/// Transfers tokens using the Pool PDA as the SPL delegate authority.
/// The user and pool token accounts approve this PDA so ER instructions can move
/// stake and payouts without requiring another wallet signature.
pub(crate) fn pool_signed_transfer<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    pool: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount: u64,
    pool_bump: u8,
) -> Result<()> {
    let pool_bump_seed = [pool_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, &pool_bump_seed]];
    let cpi_accounts = SplTransfer {
        from,
        to,
        authority: pool,
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program.key(), cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;
    Ok(())
}

pub(crate) fn init_ephemeral_ata<'info>(
    program: &UncheckedAccount<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    owner: AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(owner.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data: vec![0],
    };
    invoke(
        &instruction,
        &[
            ephemeral_ata.to_account_info(),
            payer.to_account_info(),
            owner,
            mint.to_account_info(),
            system_program.to_account_info(),
            program.to_account_info(),
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn init_vault<'info>(
    program: &UncheckedAccount<'info>,
    vault: &UncheckedAccount<'info>,
    mint: &Account<'info, Mint>,
    payer: &Signer<'info>,
    vault_ephemeral_ata: &UncheckedAccount<'info>,
    vault_token_account: &UncheckedAccount<'info>,
    token_program: &Program<'info, Token>,
    associated_token_program: &Program<'info, AssociatedToken>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(vault.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new(vault_ephemeral_ata.key(), false),
            AccountMeta::new(vault_token_account.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
            AccountMeta::new_readonly(associated_token_program.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data: vec![1],
    };
    invoke(
        &instruction,
        &[
            vault.to_account_info(),
            payer.to_account_info(),
            mint.to_account_info(),
            vault_ephemeral_ata.to_account_info(),
            vault_token_account.to_account_info(),
            token_program.to_account_info(),
            associated_token_program.to_account_info(),
            system_program.to_account_info(),
            program.to_account_info(),
        ],
    )?;
    Ok(())
}

pub(crate) fn init_associated_token_account<'info>(
    associated_token_program: &Program<'info, AssociatedToken>,
    payer: &Signer<'info>,
    associated_token: &UncheckedAccount<'info>,
    owner: &UncheckedAccount<'info>,
    mint: &Account<'info, Mint>,
    system_program: &Program<'info, System>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    let instruction = Instruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer.key(), true),
            AccountMeta::new(associated_token.key(), false),
            AccountMeta::new_readonly(owner.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
        ],
        data: vec![1],
    };
    invoke(
        &instruction,
        &[
            payer.to_account_info(),
            associated_token.to_account_info(),
            owner.to_account_info(),
            mint.to_account_info(),
            system_program.to_account_info(),
            token_program.to_account_info(),
            associated_token_program.to_account_info(),
        ],
    )?;
    Ok(())
}

/// Deposits base-layer SPL tokens into an EATA.
#[allow(clippy::too_many_arguments)]
pub(crate) fn transfer_to_vault<'info>(
    program: &UncheckedAccount<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    vault: &UncheckedAccount<'info>,
    mint: &Account<'info, Mint>,
    source_ata: &Account<'info, TokenAccount>,
    vault_ata: &UncheckedAccount<'info>,
    owner: AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
    owner_seeds: Option<&[&[u8]]>,
) -> Result<()> {
    let mut data = Vec::with_capacity(9);
    data.push(2);
    data.extend_from_slice(&amount.to_le_bytes());

    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new_readonly(vault.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new(source_ata.key(), false),
            AccountMeta::new(vault_ata.key(), false),
            AccountMeta::new_readonly(owner.key(), true),
            AccountMeta::new_readonly(token_program.key(), false),
        ],
        data,
    };
    let account_infos = [
        ephemeral_ata.to_account_info(),
        vault.to_account_info(),
        mint.to_account_info(),
        source_ata.to_account_info(),
        vault_ata.to_account_info(),
        owner,
        token_program.to_account_info(),
        program.to_account_info(),
    ];
    if let Some(owner_seeds) = owner_seeds {
        invoke_signed(&instruction, &account_infos, &[owner_seeds])?;
    } else {
        invoke(&instruction, &account_infos)?;
    }
    Ok(())
}

/// Delegates an EATA to the MagicBlock runtime.
/// Passing a validator pins the delegated token account to that ER validator.
#[allow(clippy::too_many_arguments)]
pub(crate) fn delegate_ephemeral_ata<'info>(
    program: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    buffer: &UncheckedAccount<'info>,
    record: &UncheckedAccount<'info>,
    metadata: &UncheckedAccount<'info>,
    delegation_program: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    validator: Option<Pubkey>,
) -> Result<()> {
    let mut data = vec![4];
    if let Some(validator) = validator {
        data.extend_from_slice(validator.as_ref());
    }

    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer.key(), true),
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new_readonly(EPHEMERAL_SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new(buffer.key(), false),
            AccountMeta::new(record.key(), false),
            AccountMeta::new(metadata.key(), false),
            AccountMeta::new_readonly(delegation_program.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data,
    };
    invoke(
        &instruction,
        &[
            payer.to_account_info(),
            ephemeral_ata.to_account_info(),
            program.to_account_info(),
            buffer.to_account_info(),
            record.to_account_info(),
            metadata.to_account_info(),
            delegation_program.to_account_info(),
            system_program.to_account_info(),
        ],
    )?;
    Ok(())
}

pub(crate) fn ephemeral_ata_pda(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), mint.as_ref()],
        &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    )
    .0
}

pub(crate) fn vault_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[mint.as_ref()], &EPHEMERAL_SPL_TOKEN_PROGRAM_ID).0
}

pub(crate) fn associated_token_pda(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), Token::id().as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

pub(crate) fn eata_buffer_address(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"buffer", delegated_account.as_ref()],
        &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    )
    .0
}

pub(crate) fn record_pda(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation", delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}

pub(crate) fn metadata_pda(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation-metadata", delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}
