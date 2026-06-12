use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::{
    CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi,
};
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member, AUTHORITY_FLAG, TX_LOGS_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("J7Zmxm5U7PJzqLJvGcwJr38d6L2NyrgjjGf8bQVTLZ8H");

pub const PLAYER_CHOICE_SEED: &[u8] = b"player_choice";
pub const GAME_SEED: &[u8] = b"game";

#[ephemeral]
#[program]
pub mod anchor_rock_paper_scissor {

    use super::*;

    // 1️⃣ Create and auto-join as Player 1.
    // Pre-funds the Game PDA with enough rent for its ephemeral permission (room
    // for [p1, p2] members) and the PlayerChoice PDA with rent for its own (1
    // member). After delegation those lamports flow with the PDAs onto the ER,
    // where each PDA PDA-signs its CreateEphemeralPermission CPI and pays its
    // own rent — no external account needs lamports on the ER.
    pub fn create_game(ctx: Context<CreateGame>, game_id: u64) -> Result<()> {
        // Rent for the game's ephemeral permission (2 members: p1 + p2)
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player1.to_account_info(),
                    to: ctx.accounts.game.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(2) as u32),
        )?;
        // Rent for player1's PlayerChoice ephemeral permission (1 member: p1)
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player1.to_account_info(),
                    to: ctx.accounts.player_choice.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
        )?;

        let game = &mut ctx.accounts.game;
        let player1 = ctx.accounts.player1.key();

        game.game_id = game_id;
        game.player1 = Some(player1);
        game.player2 = None;
        game.result = GameResult::None;

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

    // 2️⃣ Player 2 joins the game.
    // Pre-funds player2's PlayerChoice PDA with rent for its ephemeral permission.
    pub fn join_game(ctx: Context<JoinGame>, game_id: u64) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.player_choice.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
        )?;

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
    pub fn make_choice(ctx: Context<MakeChoice>, _game_id: u64, choice: Choice) -> Result<()> {
        let player_choice = &mut ctx.accounts.player_choice;
        require!(player_choice.choice.is_none(), GameError::AlreadyChose);

        player_choice.choice = choice.into();
        msg!(
            "Player {:?} made choice {:?}",
            player_choice.player,
            player_choice.choice
        );

        Ok(())
    }

    // 4️⃣ Reveal and record the winner. Flips all three ephemeral permissions to
    // public (members = []) so anyone can read the committed state, then commits
    // and undelegates the game so the result lives on the base layer.
    pub fn reveal_winner(ctx: Context<RevealWinner>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_choice = &ctx.accounts.player1_choice;
        let player2_choice = &ctx.accounts.player2_choice;
        let permission_program = ctx.accounts.permission_program.to_account_info();
        let permission_game = ctx.accounts.permission_game.to_account_info();
        let permission1 = ctx.accounts.permission1.to_account_info();
        let permission2 = ctx.accounts.permission2.to_account_info();
        let ephemeral_vault = ctx.accounts.ephemeral_vault.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();

        // 1️⃣ Clone choices into game
        game.player1_choice = player1_choice.choice.clone().into();
        game.player2_choice = player2_choice.choice.clone().into();

        // 2️⃣ Ensure both players exist
        let player1 = game.player1.ok_or(GameError::MissingOpponent)?;
        let player2 = game.player2.ok_or(GameError::MissingOpponent)?;

        // 3️⃣ Ensure both players made a choice
        let choice1 = game
            .player1_choice
            .clone()
            .ok_or(GameError::MissingChoice)?;
        let choice2 = game
            .player2_choice
            .clone()
            .ok_or(GameError::MissingChoice)?;

        // 4️⃣ Determine winner based on choices
        game.result = match (choice1, choice2) {
            (Choice::Rock, Choice::Scissors)
            | (Choice::Paper, Choice::Rock)
            | (Choice::Scissors, Choice::Paper) => GameResult::Winner(player1),

            (Choice::Rock, Choice::Paper)
            | (Choice::Paper, Choice::Scissors)
            | (Choice::Scissors, Choice::Rock) => GameResult::Winner(player2),

            _ => GameResult::Tie,
        };

        // 5️⃣ Make game + both player_choice permissions public via UpdateEphemeralPermission.
        // is_private=false with empty members ⇒ anyone with a valid TEE auth token can read.
        let public_args = || EphemeralMembersArgs {
            is_private: false,
            members: vec![],
        };

        // Each PDA pays for its own rent delta (private → public shrinks the account,
        // refund flows back to the PDA), and PDA-signs its CPI via its own seeds.
        UpdateEphemeralPermissionCpi {
            payer: game.to_account_info(),
            permissioned_account: game.to_account_info(),
            permission: permission_game,
            vault: ephemeral_vault.clone(),
            magic_program: magic_program.clone(),
            permission_program: permission_program.clone(),
            authority: game.to_account_info(),
            authority_is_signer: false,
            args: public_args(),
        }
        .invoke_signed(&[&[GAME_SEED, &game.game_id.to_le_bytes(), &[ctx.bumps.game]]])?;

        UpdateEphemeralPermissionCpi {
            payer: player1_choice.to_account_info(),
            permissioned_account: player1_choice.to_account_info(),
            permission: permission1,
            vault: ephemeral_vault.clone(),
            magic_program: magic_program.clone(),
            permission_program: permission_program.clone(),
            authority: player1_choice.to_account_info(),
            authority_is_signer: false,
            args: public_args(),
        }
        .invoke_signed(&[&[
            PLAYER_CHOICE_SEED,
            &player1_choice.game_id.to_le_bytes(),
            player1_choice.player.as_ref(),
            &[ctx.bumps.player1_choice],
        ]])?;

        UpdateEphemeralPermissionCpi {
            payer: player2_choice.to_account_info(),
            permissioned_account: player2_choice.to_account_info(),
            permission: permission2,
            vault: ephemeral_vault.clone(),
            magic_program: magic_program.clone(),
            permission_program: permission_program.clone(),
            authority: player2_choice.to_account_info(),
            authority_is_signer: false,
            args: public_args(),
        }
        .invoke_signed(&[&[
            PLAYER_CHOICE_SEED,
            &player2_choice.game_id.to_le_bytes(),
            player2_choice.player.as_ref(),
            &[ctx.bumps.player2_choice],
        ]])?;

        msg!("Result: {:?}", &game.result);

        game.exit(&crate::ID)?;

        // Note: undelegation is intentionally NOT done here. Call `undelegate_all`
        // afterwards to commit + undelegate game + both player_choices in one ix.

        Ok(())
    }

    // 5️⃣ Rematch: after the winner is revealed, either player can reset the
    // game while it is still delegated to the ER and play another round with
    // the SAME PDAs — no new accounts, no new rent, no base-layer round-trip.
    // Clears both choices + the result and flips all three ephemeral
    // permissions back to private (game: [p1, p2], each choice: its owner
    // only). The rent each permission needs to grow back is exactly the refund
    // its PDA received when `reveal_winner` shrank it to public, so the PDAs
    // stay solvent across unlimited rounds.
    pub fn reset_game(ctx: Context<ResetGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_choice = &mut ctx.accounts.player1_choice;
        let player2_choice = &mut ctx.accounts.player2_choice;
        let permission_program = ctx.accounts.permission_program.to_account_info();
        let permission_game = ctx.accounts.permission_game.to_account_info();
        let permission1 = ctx.accounts.permission1.to_account_info();
        let permission2 = ctx.accounts.permission2.to_account_info();
        let ephemeral_vault = ctx.accounts.ephemeral_vault.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();

        // 1️⃣ Only between rounds: the previous round must be revealed,
        // otherwise a losing-streak player could wipe a round in flight.
        require!(game.result != GameResult::None, GameError::NotRevealed);

        // 2️⃣ Either player can trigger the rematch — but only a player.
        let player1 = game.player1.ok_or(GameError::MissingOpponent)?;
        let player2 = game.player2.ok_or(GameError::MissingOpponent)?;
        let payer = ctx.accounts.payer.key();
        require!(payer == player1 || payer == player2, GameError::NotAPlayer);

        // 3️⃣ Clear the round state
        game.player1_choice = None;
        game.player2_choice = None;
        game.result = GameResult::None;
        player1_choice.choice = None;
        player2_choice.choice = None;

        // 4️⃣ Flip permissions back to private, mirroring the initial setup.
        let member = |pubkey: Pubkey| Member {
            flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
            pubkey,
        };
        let private_args = |members: Vec<Member>| EphemeralMembersArgs {
            is_private: true,
            members,
        };

        UpdateEphemeralPermissionCpi {
            payer: game.to_account_info(),
            permissioned_account: game.to_account_info(),
            permission: permission_game,
            vault: ephemeral_vault.clone(),
            magic_program: magic_program.clone(),
            permission_program: permission_program.clone(),
            authority: game.to_account_info(),
            authority_is_signer: false,
            args: private_args(vec![member(player1), member(player2)]),
        }
        .invoke_signed(&[&[GAME_SEED, &game.game_id.to_le_bytes(), &[ctx.bumps.game]]])?;

        UpdateEphemeralPermissionCpi {
            payer: player1_choice.to_account_info(),
            permissioned_account: player1_choice.to_account_info(),
            permission: permission1,
            vault: ephemeral_vault.clone(),
            magic_program: magic_program.clone(),
            permission_program: permission_program.clone(),
            authority: player1_choice.to_account_info(),
            authority_is_signer: false,
            args: private_args(vec![member(player1)]),
        }
        .invoke_signed(&[&[
            PLAYER_CHOICE_SEED,
            &player1_choice.game_id.to_le_bytes(),
            player1_choice.player.as_ref(),
            &[ctx.bumps.player1_choice],
        ]])?;

        UpdateEphemeralPermissionCpi {
            payer: player2_choice.to_account_info(),
            permissioned_account: player2_choice.to_account_info(),
            permission: permission2,
            vault: ephemeral_vault.clone(),
            magic_program: magic_program.clone(),
            permission_program: permission_program.clone(),
            authority: player2_choice.to_account_info(),
            authority_is_signer: false,
            args: private_args(vec![member(player2)]),
        }
        .invoke_signed(&[&[
            PLAYER_CHOICE_SEED,
            &player2_choice.game_id.to_le_bytes(),
            player2_choice.player.as_ref(),
            &[ctx.bumps.player2_choice],
        ]])?;

        msg!("Game {} reset for a rematch by {}", game.game_id, payer);
        Ok(())
    }

    /// Commit + undelegate game + both player_choices in a single magic-intent
    /// bundle. Bring the whole game state back to the base layer at once and
    /// release all three PDAs from the ER.
    pub fn undelegate_all(ctx: Context<UndelegateAll>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[
            ctx.accounts.game.to_account_info(),
            ctx.accounts.player1_choice.to_account_info(),
            ctx.accounts.player2_choice.to_account_info(),
        ])
        .build_and_invoke()?;
        Ok(())
    }

    /// Delegate account to the delegation program based on account type
    /// Set specific validator based on ER, see https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/local-setup
    pub fn delegate_pda(ctx: Context<DelegatePda>, account_type: AccountType) -> Result<()> {
        let seed_data = derive_seeds_from_account_type(&account_type);
        let seeds_refs: Vec<&[u8]> = seed_data.iter().map(|s| s.as_slice()).collect();

        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &seeds_refs,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Create an ephemeral permission for a delegated account directly on the ER.
    /// The `permissioned_account` PDA is both `payer` and `permissioned_account` —
    /// it covers its own rent from the lamports pre-funded at `create_game` /
    /// `join_game` time, and signs the CPI via its seeds derived from `account_type`.
    /// Idempotent: skips if the permission already exists. `members = Some(vec)` →
    /// private with that member list; `members = None` → public.
    pub fn init_permission(
        ctx: Context<PermissionContextRps>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Permission already exists, skipping creation");
            return Ok(());
        }

        let seed_data = derive_seeds_from_account_type(&account_type);
        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );
        let mut seeds = seed_data.clone();
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        let (is_private, member_list) = match members {
            Some(m) => (true, m),
            None => (false, vec![]),
        };

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.permissioned_account.to_account_info(),
            permissioned_account: ctx.accounts.permissioned_account.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private,
                members: member_list,
            },
        }
        .invoke_signed(&[seed_refs.as_slice()])?;
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
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission_game: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission1: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission2: UncheckedAccount<'info>,
    /// Anyone can trigger this
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Context for `reset_game` — same account set as `RevealWinner`: the game,
/// both choice PDAs (re-derived from the players stored on the game) and their
/// permission accounts, which get flipped back to private for the next round.
#[derive(Accounts)]
pub struct ResetGame<'info> {
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
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission_game: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission1: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission2: UncheckedAccount<'info>,
    /// Must be one of the two players (checked in the handler)
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Context for `undelegate_all` — commits + undelegates game + both player_choice
/// PDAs in a single magic-intent bundle. `#[commit]` auto-adds `magic_context` and
/// `magic_program`. Player addresses are derived from the game's stored state.
#[commit]
#[derive(Accounts)]
pub struct UndelegateAll<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        seeds = [PLAYER_CHOICE_SEED, &game.game_id.to_le_bytes(), game.player1.unwrap().as_ref()],
        bump,
    )]
    pub player1_choice: Account<'info, PlayerChoice>,
    #[account(
        mut,
        seeds = [PLAYER_CHOICE_SEED, &game.game_id.to_le_bytes(), game.player2.unwrap().as_ref()],
        bump,
    )]
    pub player2_choice: Account<'info, PlayerChoice>,
}

/// Unified delegate PDA context
#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: The PDA to delegate
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<UncheckedAccount<'info>>,
}

/// Context for `init_permission` — runs on the ER, creates an ephemeral permission
/// for the delegated `permissioned_account`. The PDA itself is the rent payer and
/// signs the CPI via seeds (so it must be `mut`); the `authority` Signer just covers
/// the outer tx fee on the ER.
#[derive(Accounts)]
pub struct PermissionContextRps<'info> {
    /// CHECK: The delegated PDA whose access is being gated; pays its own permission
    /// rent and signs the CPI via the seeds derived from `account_type`.
    #[account(mut)]
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: verified by permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[account]
pub struct Game {
    pub game_id: u64,
    pub player1: Option<Pubkey>,
    pub player2: Option<Pubkey>,
    pub player1_choice: Option<Choice>,
    pub player2_choice: Option<Choice>,
    pub result: GameResult,
}
impl Game {
    pub const LEN: usize = 8                // game_id
        + (32 + 1) * 2                       // player1, player2
        + (1 + 1) * 2                        // player1_choice, player2_choice
        + (1 + 32); // result (1 byte tag + 32 bytes pubkey for Winner variant)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum GameResult {
    Winner(Pubkey),
    Tie,
    None,
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
    #[msg("The winner has not been revealed yet.")]
    NotRevealed,
    #[msg("Only a player of this game can do this.")]
    NotAPlayer,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    PlayerChoice { game_id: u64, player: Pubkey },
}

fn derive_seeds_from_account_type(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::Game { game_id } => {
            vec![GAME_SEED.to_vec(), game_id.to_le_bytes().to_vec()]
        }
        AccountType::PlayerChoice { game_id, player } => {
            vec![
                PLAYER_CHOICE_SEED.to_vec(),
                game_id.to_le_bytes().to_vec(),
                player.to_bytes().to_vec(),
            ]
        }
    }
}
