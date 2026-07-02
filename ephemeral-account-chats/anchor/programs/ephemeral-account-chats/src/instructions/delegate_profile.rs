use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;

use crate::state::Profile;

pub fn delegate_profile(ctx: Context<DelegateProfile>, validator: Option<Pubkey>) -> Result<()> {
    // Read handle out of the raw account data inside a scoped borrow so it's
    // released before the delegate CPI takes its own mutable borrow.
    let handle = {
        let data = ctx.accounts.profile.try_borrow_data()?;
        Profile::try_deserialize(&mut &data[..])?.handle
    };

    let profile_seeds: &[&[u8]] = &[b"profile", handle.as_bytes()];
    let config = ephemeral_rollups_sdk::cpi::DelegateConfig {
        validator,
        ..Default::default()
    };
    ctx.accounts
        .delegate_profile(&ctx.accounts.authority, profile_seeds, config)?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: PDA verified by the delegate CPI via the seeds we pass. Using
    /// UncheckedAccount avoids Anchor re-serializing stale data after the
    /// CPI transfers ownership to the delegation program.
    #[account(mut, del)]
    pub profile: UncheckedAccount<'info>,
}
