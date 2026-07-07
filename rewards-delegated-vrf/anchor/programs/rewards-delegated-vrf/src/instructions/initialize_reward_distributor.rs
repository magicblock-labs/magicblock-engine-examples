use anchor_lang::prelude::*;

use crate::InitializeRewardDistributor;

/// Initialize the reward_distributor PDA and, in the same call, ensure the
/// per-distributor `whitelist_distributor` PDA exists. Both accounts use
/// `init_if_needed` so each guard runs independently:
///   - If neither exists → both get created and populated here.
///   - If reward_distributor already exists but whitelist_distributor was
///     missing → the latter is created and linked.
///   - If both already exist → this is a no-op.
pub fn initialize_reward_distributor(
    ctx: Context<InitializeRewardDistributor>,
    admins: Vec<Pubkey>,
) -> Result<()> {
    msg!(
        "Initializing reward distributor: {:?}",
        ctx.accounts.reward_distributor.key()
    );

    // Reward distributor — only populate if we're looking at a freshly
    // created account (super_admin still zeroed).
    let reward_distributor_key = ctx.accounts.reward_distributor.key();
    let reward_distributor = &mut ctx.accounts.reward_distributor;
    if reward_distributor.super_admin == Pubkey::default() {
        let super_admin = ctx.accounts.initializer.key();
        reward_distributor.super_admin = super_admin;
        reward_distributor.bump = ctx.bumps.reward_distributor;
        let mut all_admins = vec![super_admin];
        all_admins.extend(admins.into_iter().filter(|k| *k != super_admin));
        reward_distributor.admins = all_admins;
    }

    // Whitelist distributor — same idempotent pattern. We backfill it on a
    // distributor that pre-dates this PDA without touching the rest of the
    // reward_distributor state.
    let whitelist_distributor = &mut ctx.accounts.whitelist_distributor;
    if whitelist_distributor.reward_distributor == Pubkey::default() {
        whitelist_distributor.reward_distributor = reward_distributor_key;
        whitelist_distributor.bump = ctx.bumps.whitelist_distributor;
        msg!(
            "Initialized whitelist distributor: {:?}",
            ctx.accounts.whitelist_distributor.key()
        );
    }

    Ok(())
}
