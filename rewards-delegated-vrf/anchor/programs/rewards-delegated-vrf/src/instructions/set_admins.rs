use anchor_lang::prelude::*;

use crate::helpers::remove_duplicate_pubkeys;
use crate::SetAdmins;

pub fn set_admins(ctx: Context<SetAdmins>, admins: Vec<Pubkey>) -> Result<()> {
    msg!("Setting admins for reward distributor");
    let reward_distributor = &mut ctx.accounts.reward_distributor;
    let super_admin = reward_distributor.super_admin;

    let filtered_admins: Vec<Pubkey> = admins.into_iter().filter(|k| *k != super_admin).collect();
    let mut unique_admins = remove_duplicate_pubkeys(filtered_admins);
    unique_admins.insert(0, super_admin);

    reward_distributor.admins = unique_admins;
    Ok(())
}
