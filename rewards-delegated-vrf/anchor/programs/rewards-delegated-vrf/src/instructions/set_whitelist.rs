use anchor_lang::prelude::*;

use crate::helpers::remove_duplicate_pubkeys;
use crate::SetWhitelist;

pub fn set_whitelist(ctx: Context<SetWhitelist>, whitelist: Vec<Pubkey>) -> Result<()> {
    msg!("Setting whitelist for reward distributor");
    let reward_distributor = &mut ctx.accounts.reward_distributor;
    reward_distributor.whitelist = remove_duplicate_pubkeys(whitelist);
    Ok(())
}
