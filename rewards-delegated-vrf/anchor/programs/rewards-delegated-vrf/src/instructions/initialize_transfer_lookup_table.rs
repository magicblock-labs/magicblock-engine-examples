use anchor_lang::prelude::*;

use crate::InitializeTransferLookupTable;

pub fn initialize_transfer_lookup_table(
    ctx: Context<InitializeTransferLookupTable>,
    lookup_accounts: Vec<Pubkey>,
) -> Result<()> {
    msg!(
        "Initializing transfer lookup table: {:?}",
        ctx.accounts.transfer_lookup_table.key()
    );
    let table = &mut ctx.accounts.transfer_lookup_table;
    table.bump = ctx.bumps.transfer_lookup_table;
    table.lookup_accounts = lookup_accounts;
    msg!(
        "Initialized {} reward type lookup accounts",
        table.lookup_accounts.len()
    );
    Ok(())
}
