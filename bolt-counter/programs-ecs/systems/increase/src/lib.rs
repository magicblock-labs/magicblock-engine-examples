use bolt_lang::*;
use counter::Counter;

declare_id!("6Cnsm3Kmq2PprwQkAg7hp4pKzJKyLqL2TvM5KLnPhaz6");

#[system]
pub mod increase {

    pub fn execute(ctx: Context<Components>, _args_p: Vec<u8>) -> Result<Components> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub counter: Counter,
    }

}
