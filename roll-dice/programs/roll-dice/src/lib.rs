use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    anchor::{vrf, vrf_callback},
    vrf::{
        self,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    }
};

declare_id!("3iSNV84a4hp2AiZpczjeuJEy4PTVCSzZZyU533MR6tEU");

pub const PLAYER: &[u8] = b"playerd";

#[program]
pub mod random_dice {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!(
            "Initializing player account: {:?}",
            ctx.accounts.player.key()
        );
        let player = &mut ctx.accounts.player;
        player.last_result = 0;
        player.rollnum = 0;
        Ok(())
    }

    pub fn roll_dice(ctx: Context<DoRollDiceCtx>, client_seed: u8) -> Result<()> {
        msg!("Requesting randomness with client_seed={}", client_seed);
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackRollDice::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            // Specify any account that is required by the callback
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.player.key(),
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: Some(vec![client_seed]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn callback_roll_dice(
        ctx: Context<CallbackRollDiceCtx>,
        randomness: [u8; 32],
        client_seed: u8,
    ) -> Result<()> {
        msg!("client_seed={}", client_seed);
        msg!("Randomness bytes: {:?}", randomness);
        let rnd_u8 = vrf::rnd::random_u8_with_range(&randomness, 1, 6);
        msg!("Consuming random number: {:?}", rnd_u8);
        let player = &mut ctx.accounts.player;
        player.last_result = rnd_u8;
        player.rollnum = player.rollnum.saturating_add(1);
        msg!("Roll number: {}", player.rollnum);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + 2, seeds = [PLAYER, payer.key().to_bytes().as_slice()], bump)]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
pub struct DoRollDiceCtx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [PLAYER, payer.key().to_bytes().as_slice()], bump)]
    pub player: Account<'info, Player>,
    /// CHECK: The oracle queue
    #[account(
        mut,
        constraint = 
            oracle_queue.key() == vrf::consts::DEFAULT_QUEUE || // Devnet
            oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE // Local
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackRollDiceCtx<'info> {
    #[account(mut)]
    pub player: Account<'info, Player>,
}

#[account]
pub struct Player {
    pub last_result: u8,
    pub rollnum: u8,
}
