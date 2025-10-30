use anchor_lang::prelude::*;

declare_id!("1jLopnc9i9fBjSkgTWQwzT49ue3xe3DKtrkpeiZeEtt");

#[program]
pub mod crank_counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
