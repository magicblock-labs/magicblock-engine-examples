use bolt_lang::*;
use game::Game;
use game::GameCellOwner;
use game::GameError;
use game::GameStatus;

declare_id!("HBdGPJycpHjjJ149T3RQGtQWjSC39MVpcKYF6JJvaF6e");

#[system]
pub mod finish {

    pub fn execute(ctx: Context<Components>, args: Args) -> Result<Components> {
        let game = &mut ctx.accounts.game;

        // Can only finish the game when it's currently running
        if game.status != GameStatus::Playing {
            return Err(GameError::StatusIsNotPlaying.into());
        }

        // The standard win condition is when a user is the last one standing
        let mut finished = true;
        for x in 0..game.size_x {
            for y in 0..game.size_y {
                let cell = game.get_cell(x, y)?;
                let anyone_else = match cell.owner {
                    GameCellOwner::Player(player_index) => player_index != args.player_index,
                    GameCellOwner::Nobody => false,
                };
                if anyone_else {
                    finished = false;
                }
            }
        }

        // Mark game finished only if didnt find anything against it
        if finished {
            game.status = GameStatus::Finished;
        }

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub game: Game,
    }

    #[arguments]
    struct Args {
        player_index: u8,
    }
}
