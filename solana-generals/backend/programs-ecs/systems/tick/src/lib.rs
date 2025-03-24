use bolt_lang::*;
use game::Game;
use game::GameCellKind;
use game::GameCellOwner;
use game::GameError;
use game::GameStatus;

declare_id!("8tKAapRKPrNkxXwcArbSAnBHieYnX6M2WoTxukbCQtTa");

const TICKS_PER_SECOND: u64 = 20;

#[system]
pub mod tick {
    pub fn execute(ctx: Context<Components>, _args_p: Vec<u8>) -> Result<Components> {
        let game = &mut ctx.accounts.game;

        // Can only trigger commands when the game is playing
        if game.status != GameStatus::Playing {
            return Err(GameError::StatusIsNotPlaying.into());
        }

        // Check that the game tick cooldown has elapsed
        let mut incremented_times = 0;
        while Clock::get()?.slot >= game.tick_next_slot {
            game.tick_next_slot = game.tick_next_slot + 1;

            // Everything happens on ticks mutliples of 1 second, we can ignore everything else
            if game.tick_next_slot % TICKS_PER_SECOND != 0 {
                continue;
            }

            // Loop over all cell and increment its strength if someone is occupying
            for x in 0..game.size_x {
                for y in 0..game.size_y {
                    let mut cell = game.get_cell(x, y)?.clone();
                    if cell.owner != GameCellOwner::Nobody {
                        // Capital gains 1 unit every 5 seconds
                        if game.tick_next_slot % (TICKS_PER_SECOND * 5) == 0
                            && cell.kind == GameCellKind::Capital
                        {
                            cell.strength = cell.strength.saturating_add(1);
                        }
                        // City gains 1 unit every 10 seconds
                        if game.tick_next_slot % (TICKS_PER_SECOND * 10) == 0
                            && cell.kind == GameCellKind::City
                        {
                            cell.strength = cell.strength.saturating_add(1);
                        }
                        // Fields gains 1 unit every 60 seconds
                        if game.tick_next_slot % (TICKS_PER_SECOND * 60) == 0
                            && cell.kind == GameCellKind::Field
                        {
                            cell.strength = cell.strength.saturating_add(1);
                        }
                    }
                    game.set_cell(x, y, cell)?;
                }
            }

            // We can only process a few ticks per transaction (we are CU limited)
            incremented_times += 1;
            if incremented_times >= 5 {
                break;
            }
        }

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game: Game,
    }
}
