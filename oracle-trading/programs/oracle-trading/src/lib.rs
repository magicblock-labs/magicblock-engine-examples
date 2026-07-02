use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::anchor::ephemeral;
use pyth_solana_receiver_sdk::price_update::{Price, PriceUpdateV2};

declare_id!("32M8Sk4TMrktcpCwW6638MvknQbmbW4yskLaVR4vruHC");

pub const STORE_SEED: &[u8] = b"store";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const MAX_PRICE_AGE_SECONDS: u64 = 60;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const USD_CENTS_PER_USD: u128 = 100;

#[ephemeral]
#[program]
pub mod oracle_trading {
    use super::*;

    pub fn initialize_store(
        ctx: Context<InitializeStore>,
        token_price_usd_cents: u64,
        sol_usd_feed: Pubkey,
    ) -> Result<()> {
        require!(token_price_usd_cents > 0, StoreError::InvalidTokenPrice);

        let store = &mut ctx.accounts.store;
        if store.merchant != Pubkey::default() {
            require_keys_eq!(
                store.merchant,
                ctx.accounts.merchant.key(),
                StoreError::UnauthorizedMerchant
            );
        }

        store.merchant = ctx.accounts.merchant.key();
        store.sol_usd_feed = sol_usd_feed;
        store.token_price_usd_cents = token_price_usd_cents;
        Ok(())
    }

    pub fn buy_token(ctx: Context<BuyToken>, quantity: u64, max_lamports: u64) -> Result<()> {
        require!(quantity > 0, StoreError::InvalidQuantity);
        require_keys_eq!(
            ctx.accounts.merchant.key(),
            ctx.accounts.store.merchant,
            StoreError::UnauthorizedMerchant
        );
        require_keys_eq!(
            ctx.accounts.price_update.key(),
            ctx.accounts.store.sol_usd_feed,
            StoreError::UnexpectedPriceFeed
        );

        let sol_price = read_price(&ctx.accounts.price_update)?;
        let total_usd_cents = ctx
            .accounts
            .store
            .token_price_usd_cents
            .checked_mul(quantity)
            .ok_or(StoreError::MathOverflow)?;
        let required_lamports = usd_cents_to_lamports(total_usd_cents, sol_price)?;
        require!(
            required_lamports <= max_lamports,
            StoreError::PaymentTooHigh
        );

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.merchant.to_account_info(),
                },
            ),
            required_lamports,
        )?;

        let store = &mut ctx.accounts.store;
        store.sold_count = store
            .sold_count
            .checked_add(quantity)
            .ok_or(StoreError::MathOverflow)?;

        let receipt = &mut ctx.accounts.receipt;
        receipt.buyer = ctx.accounts.buyer.key();
        receipt.total_quantity = receipt
            .total_quantity
            .checked_add(quantity)
            .ok_or(StoreError::MathOverflow)?;
        receipt.total_paid_lamports = receipt
            .total_paid_lamports
            .checked_add(required_lamports)
            .ok_or(StoreError::MathOverflow)?;
        receipt.last_unit_price_usd_cents = store.token_price_usd_cents;
        receipt.last_paid_lamports = required_lamports;
        receipt.oracle_price = sol_price.price;
        receipt.oracle_exponent = sol_price.exponent;
        receipt.purchased_at = Clock::get()?.unix_timestamp;

        msg!(
            "Purchased {} token(s) for {} lamports using SOL/USD oracle price {}e{}",
            quantity,
            required_lamports,
            sol_price.price,
            sol_price.exponent
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeStore<'info> {
    #[account(
        init_if_needed,
        payer = merchant,
        space = 8 + Store::SIZE,
        seeds = [STORE_SEED],
        bump
    )]
    pub store: Account<'info, Store>,
    #[account(mut)]
    pub merchant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyToken<'info> {
    #[account(mut, seeds = [STORE_SEED], bump)]
    pub store: Account<'info, Store>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + PurchaseReceipt::SIZE,
        seeds = [RECEIPT_SEED, buyer.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, PurchaseReceipt>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub merchant: SystemAccount<'info>,
    /// CHECK: price feed bytes are validated by PriceUpdateV2 deserialization.
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Store {
    pub merchant: Pubkey,
    pub sol_usd_feed: Pubkey,
    pub token_price_usd_cents: u64,
    pub sold_count: u64,
}

impl Store {
    pub const SIZE: usize = 32 + 32 + 8 + 8;
}

#[account]
pub struct PurchaseReceipt {
    pub buyer: Pubkey,
    pub total_quantity: u64,
    pub total_paid_lamports: u64,
    pub last_unit_price_usd_cents: u64,
    pub last_paid_lamports: u64,
    pub oracle_price: i64,
    pub oracle_exponent: i32,
    pub purchased_at: i64,
}

impl PurchaseReceipt {
    pub const SIZE: usize = 32 + 8 + 8 + 8 + 8 + 8 + 4 + 8;
}

fn read_price(price_update_info: &UncheckedAccount) -> Result<Price> {
    let data = price_update_info.try_borrow_data()?;
    let price_update = PriceUpdateV2::try_deserialize_unchecked(&mut data.as_ref())
        .map_err(|_| error!(StoreError::InvalidPriceUpdate))?;
    let feed_id = price_update_info.key().to_bytes();
    let price = price_update
        .get_price_no_older_than(&Clock::get()?, MAX_PRICE_AGE_SECONDS, &feed_id)
        .map_err(|_| error!(StoreError::InvalidPriceUpdate))?;

    require!(price.price > 0, StoreError::InvalidOraclePrice);
    Ok(price)
}

fn usd_cents_to_lamports(usd_cents: u64, sol_price: Price) -> Result<u64> {
    require!(sol_price.price > 0, StoreError::InvalidOraclePrice);

    let mut numerator = (usd_cents as u128)
        .checked_mul(LAMPORTS_PER_SOL as u128)
        .ok_or(StoreError::MathOverflow)?;
    let mut denominator = (sol_price.price as u128)
        .checked_mul(USD_CENTS_PER_USD)
        .ok_or(StoreError::MathOverflow)?;

    if sol_price.exponent < 0 {
        let scale = checked_pow10(sol_price.exponent.unsigned_abs())?;
        numerator = numerator
            .checked_mul(scale)
            .ok_or(StoreError::MathOverflow)?;
    } else {
        let scale = checked_pow10(sol_price.exponent as u32)?;
        denominator = denominator
            .checked_mul(scale)
            .ok_or(StoreError::MathOverflow)?;
    }

    let lamports = numerator
        .checked_add(denominator - 1)
        .and_then(|value| value.checked_div(denominator))
        .ok_or(StoreError::MathOverflow)?;
    require!(lamports <= u64::MAX as u128, StoreError::MathOverflow);
    Ok(lamports as u64)
}

fn checked_pow10(exponent: u32) -> Result<u128> {
    10_u128
        .checked_pow(exponent)
        .ok_or(error!(StoreError::MathOverflow))
}

#[error_code]
pub enum StoreError {
    #[msg("token price must be greater than zero")]
    InvalidTokenPrice,
    #[msg("quantity must be greater than zero")]
    InvalidQuantity,
    #[msg("only the configured merchant can update this store")]
    UnauthorizedMerchant,
    #[msg("price feed does not match the configured SOL/USD feed")]
    UnexpectedPriceFeed,
    #[msg("price update could not be deserialized or failed validation")]
    InvalidPriceUpdate,
    #[msg("oracle price must be greater than zero")]
    InvalidOraclePrice,
    #[msg("required lamports exceed the buyer's max_lamports")]
    PaymentTooHigh,
    #[msg("math overflow")]
    MathOverflow,
}
