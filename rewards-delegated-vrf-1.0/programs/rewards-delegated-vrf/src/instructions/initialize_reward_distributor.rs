use anchor_lang::prelude::*;

use crate::InitializeRewardDistributor;

pub fn initialize_reward_distributor(
    ctx: Context<InitializeRewardDistributor>,
    admins: Vec<Pubkey>,
) -> Result<()> {
    msg!(
        "Initializing reward distributor: {:?}",
        ctx.accounts.reward_distributor.key()
    );
    let reward_distributor = &mut ctx.accounts.reward_distributor;
    if reward_distributor.super_admin != Pubkey::default() {
        return Ok(());
    }
    let super_admin = ctx.accounts.initializer.key();
    reward_distributor.super_admin = super_admin;
    reward_distributor.bump = ctx.bumps.reward_distributor;
    let mut all_admins = vec![super_admin];
    all_admins.extend(admins.into_iter().filter(|k| *k != super_admin));
    reward_distributor.admins = all_admins;
    Ok(())
}
