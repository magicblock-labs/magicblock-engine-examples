use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{self, commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use magicblock_permission_client::instructions::{
    CreateGroupCpiBuilder, CreatePermissionCpiBuilder,
};

declare_id!("AviHxCYvxaBXoSmoFbqnC4jgeoCSnLYKj4kJRoi6jCTH");

pub const PLAYER_CHOICE_SEED: &[u8] = b"player_choice";
pub const GAME_SEED: &[u8] = b"game";

#[ephemeral]
#[program]
pub mod anchor_rock_paper_scissor {
    use super::*;

    // 1️⃣ Create and auto-join as Player 1
    pub fn create_game(ctx: Context<CreateGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1 = ctx.accounts.player1.key();

        game.game_id = game_id;
        game.player1 = Some(player1);
        game.player2 = None;
        game.winner = None;

        msg!("Game ID: {}", game_id);
        msg!("Player 1 PDA: {}", player1);

        // initialize PlayerChoice for player 1
        let player_choice = &mut ctx.accounts.player_choice;
        player_choice.game_id = game_id;
        player_choice.player = player1;
        player_choice.choice = None;

        msg!("Game {} created and joined by {}", game_id, player1);
        Ok(())
    }

    // 2️⃣ Player 2 joins the game
    pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player = ctx.accounts.player.key();

        require!(game.player1 != Some(player), GameError::CannotJoinOwnGame);
        require!(game.player2.is_none(), GameError::GameFull);

        game.player2 = Some(player);

        // Create PlayerChoice PDA for player 2
        let player_choice = &mut ctx.accounts.player_choice;
        player_choice.game_id = game_id;
        player_choice.player = player;
        player_choice.choice = None;

        msg!("{} joined Game {} as player 2", player, game_id);
        Ok(())
    }

    // 3️⃣ Player makes a choice
    pub fn make_choice(ctx: Context<MakeChoice>, game_id: u64, choice: Choice) -> Result<()> {
        let player_choice = &mut ctx.accounts.player_choice;
        require!(player_choice.choice.is_none(), GameError::AlreadyChose);

        player_choice.choice = choice.into();
        msg!("Player {:?} made choice {:?}", player_choice.player, player_choice.choice);


        Ok(())
    }

    // 4️⃣ Reveal and record the winner
    pub fn reveal_winner(ctx: Context<RevealWinner>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_choice = &ctx.accounts.player1_choice;
        let player2_choice = &ctx.accounts.player2_choice;

        // 1️⃣ Clone choices into game
        game.player1_choice = player1_choice.choice.clone().into();
        game.player2_choice = player2_choice.choice.clone().into();

        // 2️⃣ Ensure both players made a choice
        let choice1 = game
            .player1_choice
            .clone() 
            .ok_or(GameError::MissingChoice)?;
        let choice2 = game
            .player2_choice
            .clone() 
            .ok_or(GameError::MissingChoice)?;

        // 3️⃣ Ensure both players exist
        let player1 = game.player1.ok_or(GameError::MissingOpponent)?;
        let player2 = game.player2.ok_or(GameError::MissingOpponent)?;

        // 4️⃣ Determine winner
        let winner = match (choice1, choice2) {
            (Choice::Rock, Choice::Scissors)
            | (Choice::Paper, Choice::Rock)
            | (Choice::Scissors, Choice::Paper) => Some(player1),

            (Choice::Rock, Choice::Paper)
            | (Choice::Paper, Choice::Scissors)
            | (Choice::Scissors, Choice::Rock) => Some(player2),

            _ => None, // tie
        };

        game.winner = winner.into();

        game.exit(&crate::ID)?;
        player1_choice.exit(&crate::ID)?;
        player2_choice.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![
                &ctx.accounts.game.to_account_info(),
                &ctx.accounts.player1_choice.to_account_info(),
                &ctx.accounts.player2_choice.to_account_info(),
            ],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        msg!("Result: {:?}", &ctx.accounts.game.winner);
        
        Ok(())
    }

    /// Delegate the account to the delegation program
    /// Set specific validator based on ER, see https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/local-setup
    pub fn delegate_game(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[GAME_SEED, &game_id.to_le_bytes()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Delegate the account to the delegation program
    /// Set specific validator based on ER, see https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/local-setup
    pub fn delegate_player_choice(ctx: Context<DelegatePlayer>, game_id: u64) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[
                PLAYER_CHOICE_SEED,
                &game_id.to_le_bytes(),
                ctx.accounts.payer.key().as_ref(),
            ],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }


    /// Creates a permission group and permission for a player choice account using the external permission program.
    ///
    /// Calls out to the permission program to create a group and permission for the deposit account.
    pub fn create_permission(ctx: Context<CreatePermission>, game_id: u64, pubkey_id: Pubkey) -> Result<()> {
        let CreatePermission {
            payer,
            permission,
            permission_program,
            group,
            permissioned_pda,
            user,
            system_program,
        } = ctx.accounts;

        CreateGroupCpiBuilder::new(&permission_program)
            .group(&group)
            .id(pubkey_id)
            .members(vec![user.key()])
            .payer(&payer)
            .system_program(system_program)
            .invoke()?;

        CreatePermissionCpiBuilder::new(&permission_program)
            .permission(&permission)
            .delegated_account(&permissioned_pda.to_account_info())
            .group(&group)
            .payer(&payer)
            .system_program(system_program)
            .invoke_signed(&[&[
                PLAYER_CHOICE_SEED,
                &game_id.to_le_bytes(),
                &payer.key().as_ref(),
                &[ctx.bumps.permissioned_pda]
            ]])?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(
        init_if_needed,
        payer = player1,
        space = 8 + Game::LEN,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        init_if_needed,
        payer = player1,
        space = 8 + PlayerChoice::LEN,
        seeds = [PLAYER_CHOICE_SEED, &game_id.to_le_bytes(), player1.key().as_ref()],
        bump
    )]
    pub player_choice: Account<'info, PlayerChoice>,

    #[account(mut)]
    pub player1: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerChoice::LEN,
        seeds = [PLAYER_CHOICE_SEED, &game_id.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub player_choice: Account<'info, PlayerChoice>,

    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct MakeChoice<'info> {
    #[account(
        mut,
        seeds = [PLAYER_CHOICE_SEED, &game_id.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub player_choice: Account<'info, PlayerChoice>,

    #[account(mut)]
    pub player: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct RevealWinner<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,

    /// Player1's choice PDA (derived automatically)
    #[account(
        mut,
        seeds = [PLAYER_CHOICE_SEED, &game.game_id.to_le_bytes(), game.player1.unwrap().as_ref()],
        bump
    )]
    pub player1_choice: Account<'info, PlayerChoice>,

    /// Player2's choice PDA (derived automatically)
    #[account(
        mut,
        seeds = [PLAYER_CHOICE_SEED, &game.game_id.to_le_bytes(), game.player2.unwrap().as_ref()],
        bump
    )]
    pub player2_choice: Account<'info, PlayerChoice>,

    /// Anyone can trigger this
    #[account(mut)]
    pub payer: Signer<'info>,
}

/// Add delegate player function to the context
#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegatePlayer<'info> {
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK The pda to delegate
    #[account(
        mut, 
        del,
        seeds = [PLAYER_CHOICE_SEED, &game_id.to_le_bytes(), payer.key().as_ref()],
        bump,)]
    pub pda: AccountInfo<'info>,
}

/// Add delegate player function to the context
#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateGame<'info> {
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK The pda to delegate
    #[account(
        mut, 
        del,
        seeds = [GAME_SEED, &game_id.to_le_bytes()],
        bump,)]
    pub pda: AccountInfo<'info>,
}

#[account]
pub struct Game {
    pub game_id: u64,
    pub player1: Option<Pubkey>,
    pub player2: Option<Pubkey>,
    pub player1_choice: Option<Choice>,
    pub player2_choice: Option<Choice>,
    pub winner: Option<Pubkey>,
}
impl Game {
    pub const LEN: usize =  8     // game_id
        + (32 + 1) * 3          // player1, player2, winner
        + (1 + 1) * 2;          // player1_choice, player2_choice
}

#[account]
pub struct PlayerChoice {
    pub game_id: u64,
    pub player: Pubkey,
    pub choice: Option<Choice>,
}
impl PlayerChoice {
    pub const LEN: usize = 8 + 8 + 32 + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum Choice {
    Rock,
    Paper,
    Scissors,
}

#[error_code]
pub enum GameError {
    #[msg("You already made your choice.")]
    AlreadyChose,
    #[msg("You cannot join your own game.")]
    CannotJoinOwnGame,
    #[msg("Both players must make a choice first.")]
    MissingChoice,
    #[msg("Opponent not found.")]
    MissingOpponent,
    #[msg("Game is already full.")]
    GameFull,
}


#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreatePermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Anyone can create the permission
    pub user: UncheckedAccount<'info>,
    #[account(
        seeds = [PLAYER_CHOICE_SEED, &game_id.to_le_bytes(), payer.key().as_ref()],
        bump
    )]
    pub permissioned_pda: Account<'info, PlayerChoice>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub group: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}