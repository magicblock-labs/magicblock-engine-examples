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

declare_id!("4AEU8Dhg5dRXyfPCdPUibbhQvQVrqs9ZGPvft6wyDBvE");

pub const PLAYER_CHOICE_SEED: &[u8] = b"player_choice";
pub const GAME_SEED: &[u8] = b"game";
pub const VAULT_SEED: &[u8] = b"vault";

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
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        stake: u64,
        target_wins: u8,
    ) -> Result<()> {
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

        // Player 1's wager into the game vault — a base-layer SOL escrow PDA that
        // is never delegated, so the pot stays put while the game runs on the ER.
        if stake > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.player1.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                stake,
            )?;
        }

        let game = &mut ctx.accounts.game;
        let player1 = ctx.accounts.player1.key();

        game.game_id = game_id;
        game.player1 = Some(player1);
        game.player2 = None;
        game.round_result = RoundResult::None;
        game.stake = stake;
        game.paid = false;
        // First to `target_wins` round-wins takes the match (min 1).
        game.target_wins = target_wins.max(1);
        game.player1_wins = 0;
        game.player2_wins = 0;
        game.round = 1;

        msg!("Game ID: {}", game_id);
        msg!("Player 1 PDA: {}", player1);
        msg!("Stake per player: {} lamports", stake);
        msg!("Match: first to {} round-wins", game.target_wins);

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

        require!(!game.paid, GameError::GameSettled);
        require!(game.player1 != Some(player), GameError::CannotJoinOwnGame);
        require!(game.player2.is_none(), GameError::GameFull);

        // Player 2 matches Player 1's wager into the vault.
        if game.stake > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                game.stake,
            )?;
        }

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

    // 4️⃣ Decide THIS ROUND and tally the match score. Flips all three ephemeral
    // permissions to public (members = []) so the round's choices become
    // readable, and records the round result in `game.round_result`. The match
    // winner is derived from the score (see `match_winner`), not stored here.
    pub fn reveal_round(ctx: Context<RevealRound>) -> Result<()> {
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

        // 4️⃣ Determine this round's winner based on choices, and tally the
        // match score. A tied round counts for neither side and is replayed.
        game.round_result = match (choice1, choice2) {
            (Choice::Rock, Choice::Scissors)
            | (Choice::Paper, Choice::Rock)
            | (Choice::Scissors, Choice::Paper) => {
                game.player1_wins += 1;
                RoundResult::Winner(player1)
            }

            (Choice::Rock, Choice::Paper)
            | (Choice::Paper, Choice::Scissors)
            | (Choice::Scissors, Choice::Rock) => {
                game.player2_wins += 1;
                RoundResult::Winner(player2)
            }

            _ => RoundResult::Tie,
        };
        msg!(
            "Round {} result: {:?} — score {} : {}",
            game.round,
            game.round_result,
            game.player1_wins,
            game.player2_wins
        );

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

        msg!("Result: {:?}", &game.round_result);

        game.exit(&crate::ID)?;

        // Note: undelegation is intentionally NOT done here. Call `undelegate_all`
        // afterwards to commit + undelegate game + both player_choices in one ix.

        Ok(())
    }

    // 5️⃣ Advance the match after a round is revealed: either player clears the
    // round on the SAME PDAs and plays on — no new accounts, no new rent, no
    // base-layer round-trip. Clears both choices + `round_result` and flips the
    // permissions back to private (game: [p1, p2], each choice: its owner only).
    // If the match is still going it bumps `round`; if it's already decided
    // (free games only) it starts a fresh match with the score reset. The rent
    // each permission needs to grow back is exactly the refund its PDA received
    // when `reveal_round` shrank it to public, so the PDAs stay solvent.
    pub fn next_round(ctx: Context<NextRound>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1_choice = &mut ctx.accounts.player1_choice;
        let player2_choice = &mut ctx.accounts.player2_choice;
        let permission_program = ctx.accounts.permission_program.to_account_info();
        let permission_game = ctx.accounts.permission_game.to_account_info();
        let permission1 = ctx.accounts.permission1.to_account_info();
        let permission2 = ctx.accounts.permission2.to_account_info();
        let ephemeral_vault = ctx.accounts.ephemeral_vault.to_account_info();
        let magic_program = ctx.accounts.magic_program.to_account_info();

        // 1️⃣ The current round must be revealed before clearing it.
        require!(game.round_result != RoundResult::None, GameError::NotRevealed);

        // 2️⃣ Either player can trigger this — but only a player.
        let player1 = game.player1.ok_or(GameError::MissingOpponent)?;
        let player2 = game.player2.ok_or(GameError::MissingOpponent)?;
        let payer = ctx.accounts.payer.key();
        require!(payer == player1 || payer == player2, GameError::NotAPlayer);

        // 3️⃣ Advance the match, or start a fresh one:
        //   - match still going → next round, keep the score.
        //   - match decided → a brand-new match (rematch). Only for free games;
        //     a staked match must be settled + claimed first (so the pot can't
        //     be replayed for).
        if game.is_match_decided() {
            require!(game.stake == 0, GameError::MustClaimFirst);
            game.player1_wins = 0;
            game.player2_wins = 0;
            game.round = 1;
        } else {
            game.round += 1;
        }

        // 4️⃣ Clear the round state
        game.player1_choice = None;
        game.player2_choice = None;
        game.round_result = RoundResult::None;
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

        msg!(
            "Game {} advanced to round {} by {}",
            game.game_id,
            game.round,
            payer
        );
        Ok(())
    }

    /// Commit + undelegate game + both player_choices in a single magic-intent
    /// bundle. Bring the whole game state back to the base layer at once and
    /// release all three PDAs from the ER.
    ///
    /// Only allowed once the MATCH is decided (someone reached `target_wins`):
    /// undelegating mid-match would strand the game on the base layer where
    /// `reveal_round` (ER-only) can no longer run, leaving the pot unclaimable.
    pub fn undelegate_all(ctx: Context<UndelegateAll>) -> Result<()> {
        require!(
            ctx.accounts.game.is_match_decided(),
            GameError::MatchNotDecided
        );
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

    // 6️⃣ Pay out the pot. Runs on the BASE layer after `undelegate_all` has
    // brought the decided match back from the ER. The match winner (first to
    // `target_wins` round-wins) takes the whole pot. The vault is a system-owned
    // PDA, so it signs its own outgoing transfer via seeds. Idempotent via
    // `paid`. Anyone can trigger it — the funds only ever go to the players
    // recorded on the game.
    pub fn claim_pot(ctx: Context<ClaimPot>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let winner = game.match_winner().ok_or(GameError::MatchNotDecided)?;
        require!(!game.paid, GameError::AlreadyPaid);

        let player1 = game.player1.ok_or(GameError::MissingOpponent)?;
        let player2 = game.player2.ok_or(GameError::MissingOpponent)?;
        require!(
            ctx.accounts.player1.key() == player1,
            GameError::WrongPlayerAccount
        );
        require!(
            ctx.accounts.player2.key() == player2,
            GameError::WrongPlayerAccount
        );

        game.paid = true;

        // Nothing staked → nothing to pay out.
        if game.stake == 0 {
            return Ok(());
        }

        let game_id_bytes = game.game_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &game_id_bytes, &[ctx.bumps.vault]]];

        let to = if winner == player1 {
            ctx.accounts.player1.to_account_info()
        } else {
            ctx.accounts.player2.to_account_info()
        };
        let pot = game.stake.checked_mul(2).ok_or(GameError::MathOverflow)?;
        pay_from_vault(
            &ctx.accounts.vault,
            &to,
            pot,
            &ctx.accounts.system_program,
            signer_seeds,
        )?;
        msg!("Paid pot of {} lamports to match winner {}", pot, winner);

        Ok(())
    }

    // Refund the creator if nobody ever joined. Base layer; only callable by
    // player1 while player2 is still empty. Marks the game settled so it can't
    // be joined or refunded twice.
    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player1 = game.player1.ok_or(GameError::MissingOpponent)?;
        require!(
            ctx.accounts.player1.key() == player1,
            GameError::WrongPlayerAccount
        );
        require!(game.player2.is_none(), GameError::CannotCancelStarted);
        require!(!game.paid, GameError::AlreadyPaid);

        game.paid = true;

        if game.stake > 0 {
            let game_id_bytes = game.game_id.to_le_bytes();
            let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, &game_id_bytes, &[ctx.bumps.vault]]];
            pay_from_vault(
                &ctx.accounts.vault,
                &ctx.accounts.player1.to_account_info(),
                game.stake,
                &ctx.accounts.system_program,
                signer_seeds,
            )?;
        }
        msg!("Game {} cancelled, stake refunded to creator", game.game_id);
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

    /// CHECK: SOL escrow PDA, system-owned, holds the pot. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,

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

    /// CHECK: SOL escrow PDA, system-owned, holds the pot. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,

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
pub struct RevealRound<'info> {
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

/// Context for `next_round` — same account set as `RevealRound`: the game,
/// both choice PDAs (re-derived from the players stored on the game) and their
/// permission accounts, which get flipped back to private for the next round.
#[derive(Accounts)]
pub struct NextRound<'info> {
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

/// Context for `claim_pot` — base layer, after the game is undelegated. The
/// vault signs its own payout via seeds; both player accounts are passed so the
/// winner (or both, on a tie) can be paid.
#[derive(Accounts)]
pub struct ClaimPot<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: SOL escrow PDA, system-owned. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: payout recipient, verified against game.player1 in the handler.
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    /// CHECK: payout recipient, verified against game.player2 in the handler.
    #[account(mut)]
    pub player2: UncheckedAccount<'info>,
    /// Anyone can trigger the payout.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Context for `cancel_game` — base layer refund of the creator's stake when
/// no one joined.
#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: SOL escrow PDA, system-owned. Validated by seeds.
    #[account(mut, seeds = [VAULT_SEED, &game.game_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// Only the creator can cancel; refund goes back to them.
    #[account(mut)]
    pub player1: Signer<'info>,
    pub system_program: Program<'info, System>,
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
    pub round_result: RoundResult, // the CURRENT round's result
    pub stake: u64,         // per-player wager in lamports (0 = free game)
    pub paid: bool,         // pot claimed / game cancelled
    pub target_wins: u8,    // round-wins needed to take the match (best-of-N)
    pub player1_wins: u8,   // match score
    pub player2_wins: u8,
    pub round: u8, // current round number, 1-based
}
impl Game {
    pub const LEN: usize = 8                // game_id
        + (32 + 1) * 2                       // player1, player2
        + (1 + 1) * 2                        // player1_choice, player2_choice
        + (1 + 32)                           // result (1 byte tag + 32 bytes pubkey for Winner variant)
        + 8                                  // stake
        + 1                                  // paid
        + 1 * 4; // target_wins, player1_wins, player2_wins, round

    /// The match is over once a player reaches `target_wins` round-wins.
    pub fn is_match_decided(&self) -> bool {
        self.player1_wins >= self.target_wins || self.player2_wins >= self.target_wins
    }

    /// Pubkey of the match winner, or None if the match is still in progress.
    pub fn match_winner(&self) -> Option<Pubkey> {
        if self.player1_wins >= self.target_wins {
            self.player1
        } else if self.player2_wins >= self.target_wins {
            self.player2
        } else {
            None
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum RoundResult {
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
    #[msg("The pot has already been paid out.")]
    AlreadyPaid,
    #[msg("This game has already been settled.")]
    GameSettled,
    #[msg("Wrong player account for this game.")]
    WrongPlayerAccount,
    #[msg("Cannot cancel a game that already has two players.")]
    CannotCancelStarted,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("The match is not decided yet.")]
    MatchNotDecided,
    #[msg("Settle and claim the pot before starting a new match.")]
    MustClaimFirst,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    PlayerChoice { game_id: u64, player: Pubkey },
}

/// Transfer `amount` lamports out of the system-owned vault PDA, which signs
/// for itself via `signer_seeds`.
fn pay_from_vault<'info>(
    vault: &SystemAccount<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    system_program: &Program<'info, System>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: to.clone(),
            },
            signer_seeds,
        ),
        amount,
    )
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
