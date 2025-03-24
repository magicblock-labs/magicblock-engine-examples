use bolt_lang::*;
use game::Game;
use game::GameError;
use game::GameStatus;

declare_id!("3zMXokc8DYYAairrtAKZKPJZKHmWKRdj6G8bm8ZZVi9g");

#[system]
pub mod join {

    pub fn execute(ctx: Context<Components>, args: Args) -> Result<Components> {
        let game = &mut ctx.accounts.game;

        // Can only join the game when the game is accepting new players
        if game.status != GameStatus::Lobby {
            return Err(GameError::StatusIsNotLobby.into());
        }

        let payer = ctx.accounts.authority.key();
        let player = &mut game.players[usize::from(args.player_index)];

        // If user want to join the room
        if args.join {
            if player.ready {
                return Err(GameError::PlayerAlreadyJoined.into());
            } else {
                player.authority = payer;
                player.ready = true;
            }
        }
        // If user want to leave the room
        else {
            if player.authority != payer {
                return Err(GameError::PlayerIsNotPayer.into());
            } else {
                player.authority = Pubkey::default();
                player.ready = false;
            }
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
        join: bool,
    }
}
