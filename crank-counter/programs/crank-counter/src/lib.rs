use anchor_lang::prelude::*;

declare_id!("5LomaZ9w94qfwvdDa1QhhCe41HYqrQTkdYfP39pX6LqH");

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
