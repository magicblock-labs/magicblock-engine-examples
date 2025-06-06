use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

declare_id!("5AUHCWm4TzipCWK9H3EKx9JNccEA3rfNSUp4BCy2Zy2f");

pub const PLAYER: &[u8] = b"playerd";

#[program]
pub mod random_dice {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!(
            "Initializing player account: {:?}",
            ctx.accounts.player.key()
        );
        Ok(())
    }

    pub fn roll_dice(ctx: Context<DoRollDiceCtx>, client_seed: u8) -> Result<()> {
        msg!("Requesting randomness...");
        let ix = create_request_randomness_ix(RequestRandomnessParams {
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
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn callback_roll_dice(
        ctx: Context<CallbackRollDiceCtx>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let roll = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 1, 101);
        msg!("Roll: {}", roll);

        // Determine character class based on roll
        let (class, class_name) = if roll <= 32 {
            (0, "Warrior")
        } else if roll <= 64 {
            (1, "Mage")
        } else if roll <= 96 {
            (2, "Archer")
        } else {
            (3, "Priest")
        };

        // Generate a random u32 and use modulo to get a 6-digit number
        let stats_roll = ephemeral_vrf_sdk::rnd::random_u32(&randomness) % 900000 + 100000;
        msg!("Stats roll: {}", stats_roll);

        // Split the 6-digit number into three 2-digit numbers
        let atk = ((stats_roll / 10000) % 100) as u8;
        let def = ((stats_roll / 100) % 100) as u8;
        let dex = (stats_roll % 100) as u8;

        // Log character details
        msg!("Class: {}, ATK: {}, DEF: {}, DEX: {}", class_name, atk, def, dex);

        let player = &mut ctx.accounts.player;
        player.last_result = roll;
        player.character_class = class;
        player.atk = atk;
        player.def = def;
        player.dex = dex;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + 5, seeds = [PLAYER, payer.key().to_bytes().as_slice()], bump)]
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
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CallbackRollDiceCtx<'info> {
    /// This check ensure that the vrf_program_identity (which is a PDA) is a singer
    /// enforcing the callback is executed by the VRF program trough CPI
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub player: Account<'info, Player>,
}

#[account]
pub struct Player {
    pub last_result: u8,
    pub character_class: u8,
    pub atk: u8,
    pub def: u8,
    pub dex: u8,
}