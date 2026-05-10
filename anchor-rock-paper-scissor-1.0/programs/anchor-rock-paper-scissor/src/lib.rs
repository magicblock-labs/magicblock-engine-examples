use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("6wABXyMw9akNgmBG8LXEVjUaexWZC1vCQjxafQ8vTEfe");

pub const PLAYER_CHOICE_SEED: &[u8] = b"player_choice";
pub const GAME_SEED: &[u8] = b"game";
pub const PERMISSION_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const CREATE_PERMISSION_DISCRIMINATOR: u64 = 0;
const UPDATE_PERMISSION_DISCRIMINATOR: u64 = 1;

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

    // 4️⃣ Reveal and record the winner
    pub fn reveal_winner(ctx: Context<RevealWinner>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_choice = &ctx.accounts.player1_choice;
        let player2_choice = &ctx.accounts.player2_choice;
        let permission_program = &ctx.accounts.permission_program.to_account_info();
        let permission_game = &ctx.accounts.permission_game.to_account_info();
        let permission1 = &ctx.accounts.permission1.to_account_info();
        let permission2 = &ctx.accounts.permission2.to_account_info();
        let magic_program = &ctx.accounts.magic_program.to_account_info();
        let magic_context = &ctx.accounts.magic_context.to_account_info();

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

        invoke_update_permission(
            permission_program,
            (&game.to_account_info(), false),
            (&game.to_account_info(), true),
            permission_game,
            MembersArgs { members: None },
            &[&[GAME_SEED, &game.game_id.to_le_bytes(), &[ctx.bumps.game]]],
        )?;

        invoke_update_permission(
            permission_program,
            (&player1_choice.to_account_info(), false),
            (&player1_choice.to_account_info(), true),
            permission1,
            MembersArgs { members: None },
            &[&[
                PLAYER_CHOICE_SEED,
                &player1_choice.game_id.to_le_bytes(),
                &player1_choice.player.as_ref(),
                &[ctx.bumps.player1_choice],
            ]],
        )?;

        invoke_update_permission(
            permission_program,
            (&player2_choice.to_account_info(), false),
            (&player2_choice.to_account_info(), true),
            permission2,
            MembersArgs { members: None },
            &[&[
                PLAYER_CHOICE_SEED,
                &player2_choice.game_id.to_le_bytes(),
                &player2_choice.player.as_ref(),
                &[ctx.bumps.player2_choice],
            ]],
        )?;

        msg!("Result: {:?}", &game.result);

        game.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&game.to_account_info()],
            magic_context,
            magic_program,
            None,
        )?;

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

    /// Creates a permission based on account type input.
    /// Derives the bump from the account type and seeds, then calls the permission program.
    pub fn create_permission(
        ctx: Context<CreatePermission>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        let CreatePermission {
            permissioned_account,
            permission,
            payer,
            permission_program,
            system_program,
        } = ctx.accounts;

        let seed_data = derive_seeds_from_account_type(&account_type);

        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );

        let mut seeds = seed_data.clone();
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        invoke_create_permission(
            &permission_program.to_account_info(),
            &permissioned_account.to_account_info(),
            &permission.to_account_info(),
            &payer.to_account_info(),
            &system_program.to_account_info(),
            MembersArgs { members },
            &[seed_refs.as_slice()],
        )?;
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
}

/// Unified delegate PDA context
#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: The PDA to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct CreatePermission<'info> {
    /// CHECK: Validated via permission program CPI
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
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
pub struct Member {
    pub flags: u8,
    pub pubkey: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct MembersArgs {
    pub members: Option<Vec<Member>>,
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
    #[msg("Failed to serialize permission instruction data.")]
    PermissionSerializationFailed,
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

#[derive(AnchorSerialize)]
struct CreatePermissionInstructionData {
    discriminator: u64,
}

#[derive(AnchorSerialize)]
struct CreatePermissionInstructionArgs {
    args: MembersArgs,
}

#[derive(AnchorSerialize)]
struct UpdatePermissionInstructionData {
    discriminator: u64,
}

#[derive(AnchorSerialize)]
struct UpdatePermissionInstructionArgs {
    args: MembersArgs,
}

fn serialize_permission_data<T: AnchorSerialize>(value: &T) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    value
        .serialize(&mut data)
        .map_err(|_| error!(GameError::PermissionSerializationFailed))?;
    Ok(data)
}

fn invoke_create_permission<'info>(
    program: &AccountInfo<'info>,
    permissioned_account: &AccountInfo<'info>,
    permission: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    args: MembersArgs,
    signers_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = serialize_permission_data(&CreatePermissionInstructionData {
        discriminator: CREATE_PERMISSION_DISCRIMINATOR,
    })?;
    data.extend(serialize_permission_data(&CreatePermissionInstructionArgs { args })?);

    let instruction = Instruction {
        program_id: PERMISSION_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*permissioned_account.key, true),
            AccountMeta::new(*permission.key, false),
            AccountMeta::new(*payer.key, true),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data,
    };

    let account_infos = vec![
        program.clone(),
        permissioned_account.clone(),
        permission.clone(),
        payer.clone(),
        system_program.clone(),
    ];

    if signers_seeds.is_empty() {
        invoke(&instruction, &account_infos)?;
    } else {
        invoke_signed(&instruction, &account_infos, signers_seeds)?;
    }

    Ok(())
}

fn invoke_update_permission<'info>(
    program: &AccountInfo<'info>,
    authority: (&AccountInfo<'info>, bool),
    permissioned_account: (&AccountInfo<'info>, bool),
    permission: &AccountInfo<'info>,
    args: MembersArgs,
    signers_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = serialize_permission_data(&UpdatePermissionInstructionData {
        discriminator: UPDATE_PERMISSION_DISCRIMINATOR,
    })?;
    data.extend(serialize_permission_data(&UpdatePermissionInstructionArgs { args })?);

    let instruction = Instruction {
        program_id: PERMISSION_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority.0.key, authority.1),
            AccountMeta::new_readonly(*permissioned_account.0.key, permissioned_account.1),
            AccountMeta::new(*permission.key, false),
        ],
        data,
    };

    let account_infos = vec![
        program.clone(),
        authority.0.clone(),
        permissioned_account.0.clone(),
        permission.clone(),
    ];

    if signers_seeds.is_empty() {
        invoke(&instruction, &account_infos)?;
    } else {
        invoke_signed(&instruction, &account_infos, signers_seeds)?;
    }

    Ok(())
}
