use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("amount must be > 0")]
    InvalidAmount,
    #[msg("token account is not owned by the expected authority")]
    InvalidTokenOwner,
    #[msg("invalid pool config")]
    InvalidPoolConfig,
    #[msg("token account mint mismatch")]
    MintMismatch,
    #[msg("invalid ephemeral token account PDA")]
    InvalidEphemeralAta,
    #[msg("invalid e-token vault PDA")]
    InvalidVault,
    #[msg("invalid e-token vault associated token account")]
    InvalidVaultAta,
    #[msg("invalid delegation PDA")]
    InvalidDelegationPda,
    #[msg("stake is below the minimum")]
    StakeTooSmall,
    #[msg("bet is already open")]
    BetAlreadyOpen,
    #[msg("bet is not open")]
    BetNotOpen,
    #[msg("bet has not expired")]
    BetNotExpired,
    #[msg("invalid price feed account")]
    InvalidPriceFeed,
    #[msg("token account has not delegated authority to the pool")]
    InvalidTokenDelegate,
    #[msg("delegated token allowance is too small")]
    InsufficientDelegatedAmount,
    #[msg("pool free liquidity is too small")]
    InsufficientLiquidity,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("tie has no directional outcome")]
    TieHasNoDirection,
}
