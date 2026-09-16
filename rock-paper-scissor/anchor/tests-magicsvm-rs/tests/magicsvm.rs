use {
    anchor_lang::{prelude::Pubkey, system_program, Id, InstructionData, ToAccountMetas},
    anchor_rock_paper_scissor::{
        self, accounts, instruction, AccountType, Choice, GAME_SEED, PLAYER_CHOICE_SEED, VAULT_SEED,
    },
    ephemeral_rollups_sdk::{
        access_control::structs::{EphemeralPermission, Member, AUTHORITY_FLAG, TX_LOGS_FLAG},
        anchor::{DelegationProgram, MagicProgram},
        consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account,
        },
    },
    magicsvm::{MagicSVM, TransactionTarget},
    solana_address::Address,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    std::path::PathBuf,
    test_utils::{
        as_address, as_pubkey, client_ix, program_id_from_idl, program_so_path, send_ixs,
    },
};

const GAME_ID: u64 = 1;
const STAKE: u64 = LAMPORTS_PER_SOL / 20;
const TARGET_WINS: u8 = 2;

fn program_so() -> PathBuf {
    program_so_path(env!("CARGO_MANIFEST_DIR"), "anchor_rock_paper_scissor")
}

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "anchor_rock_paper_scissor.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn send(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ixs: Vec<Instruction>,
    label: &str,
) {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra_signers);
    send_ixs(svm, target, &signers, &ixs, label);
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &program_id()).0
}

fn permission_pda(account: &Pubkey) -> Pubkey {
    EphemeralPermission::find_pda(account).0
}

fn game_id_bytes() -> [u8; 8] {
    GAME_ID.to_le_bytes()
}

fn member(pubkey: Pubkey) -> Member {
    Member {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
        pubkey,
    }
}

fn create_game_ix(
    game: Pubkey,
    player_choice: Pubkey,
    vault: Pubkey,
    player1: Pubkey,
) -> Instruction {
    ix(
        instruction::CreateGame {
            game_id: GAME_ID,
            stake: STAKE,
            target_wins: TARGET_WINS,
        },
        accounts::CreateGame {
            game,
            player_choice,
            vault,
            player1,
            system_program: system_program::ID,
        },
    )
}

fn join_game_ix(game: Pubkey, player_choice: Pubkey, vault: Pubkey, player: Pubkey) -> Instruction {
    ix(
        instruction::JoinGame { game_id: GAME_ID },
        accounts::JoinGame {
            game,
            player_choice,
            vault,
            player,
            system_program: system_program::ID,
        },
    )
}

fn delegate_pda_ix(
    pda_addr: Pubkey,
    payer: Pubkey,
    validator: Pubkey,
    account_type: AccountType,
) -> Instruction {
    ix(
        instruction::DelegatePda { account_type },
        accounts::DelegatePda {
            buffer_pda: delegate_buffer_pda_from_delegated_account_and_owner_program(
                &pda_addr,
                &program_id(),
            ),
            delegation_record_pda: delegation_record_pda_from_delegated_account(&pda_addr),
            delegation_metadata_pda: delegation_metadata_pda_from_delegated_account(&pda_addr),
            pda: pda_addr,
            payer,
            validator: Some(validator),
            owner_program: program_id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    )
}

fn init_permission_ix(
    permissioned_account: Pubkey,
    permission: Pubkey,
    authority: Pubkey,
    account_type: AccountType,
    members: Option<Vec<Member>>,
) -> Instruction {
    ix(
        instruction::InitPermission {
            account_type,
            members,
        },
        accounts::PermissionContextRps {
            permissioned_account,
            permission,
            authority,
            permission_program: PERMISSION_PROGRAM_ID,
            ephemeral_vault: EPHEMERAL_VAULT_ID,
            magic_program: MAGIC_PROGRAM_ID,
        },
    )
}

fn make_choice_ix(player_choice: Pubkey, player: Pubkey, choice: Choice) -> Instruction {
    ix(
        instruction::MakeChoice {
            _game_id: GAME_ID,
            choice,
        },
        accounts::MakeChoice {
            player_choice,
            player,
        },
    )
}

fn reveal_round_ix(
    game: Pubkey,
    p1_choice: Pubkey,
    p2_choice: Pubkey,
    permission_game: Pubkey,
    permission1: Pubkey,
    permission2: Pubkey,
    payer: Pubkey,
) -> Instruction {
    ix(
        instruction::RevealRound {},
        accounts::RevealRound {
            game,
            player1_choice: p1_choice,
            player2_choice: p2_choice,
            permission_game,
            permission1,
            permission2,
            payer,
            permission_program: PERMISSION_PROGRAM_ID,
            ephemeral_vault: EPHEMERAL_VAULT_ID,
            magic_program: MAGIC_PROGRAM_ID,
        },
    )
}

fn next_round_ix(
    game: Pubkey,
    p1_choice: Pubkey,
    p2_choice: Pubkey,
    permission_game: Pubkey,
    permission1: Pubkey,
    permission2: Pubkey,
    payer: Pubkey,
) -> Instruction {
    ix(
        instruction::NextRound {},
        accounts::NextRound {
            game,
            player1_choice: p1_choice,
            player2_choice: p2_choice,
            permission_game,
            permission1,
            permission2,
            payer,
            permission_program: PERMISSION_PROGRAM_ID,
            ephemeral_vault: EPHEMERAL_VAULT_ID,
            magic_program: MAGIC_PROGRAM_ID,
        },
    )
}

fn undelegate_all_ix(
    payer: Pubkey,
    game: Pubkey,
    p1_choice: Pubkey,
    p2_choice: Pubkey,
) -> Instruction {
    ix(
        instruction::UndelegateAll {},
        accounts::UndelegateAll {
            payer,
            game,
            player1_choice: p1_choice,
            player2_choice: p2_choice,
            magic_program: MagicProgram::id(),
            magic_context: MAGIC_CONTEXT_ID,
        },
    )
}

fn claim_pot_ix(
    game: Pubkey,
    vault: Pubkey,
    player1: Pubkey,
    player2: Pubkey,
    payer: Pubkey,
) -> Instruction {
    ix(
        instruction::ClaimPot {},
        accounts::ClaimPot {
            game,
            vault,
            player1,
            player2,
            payer,
            system_program: system_program::ID,
        },
    )
}

#[test]
fn rock_paper_scissor_magicsvm() {
    let player1 = Keypair::new();
    let player2 = Keypair::new();
    let mut svm = MagicSVM::new();
    let validator = as_pubkey(&svm.validator_identity());
    let p1 = as_pubkey(&player1.pubkey());
    let p2 = as_pubkey(&player2.pubkey());

    svm.add_program_from_file(program_address(), program_so())
        .expect("load program");
    svm.airdrop(&player1.pubkey(), 2 * LAMPORTS_PER_SOL)
        .expect("airdrop p1");
    svm.airdrop(&player2.pubkey(), 2 * LAMPORTS_PER_SOL)
        .expect("airdrop p2");

    let permission_program = svm.get_account_for(
        TransactionTarget::Ephemeral,
        &as_address(PERMISSION_PROGRAM_ID),
    );
    eprintln!(
        "PERMISSION_PROGRAM_ID on ephemeral: {}",
        if permission_program.is_some() {
            "present"
        } else {
            "MISSING"
        }
    );
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &as_address(MAGIC_PROGRAM_ID))
            .is_some(),
        "MAGIC_PROGRAM should be loaded on ephemeral"
    );
    assert!(
        svm.get_account_for(
            TransactionTarget::Ephemeral,
            &as_address(EPHEMERAL_VAULT_ID)
        )
        .is_some(),
        "ephemeral vault should be loaded"
    );

    let game = pda(&[GAME_SEED, &game_id_bytes()]);
    let vault = pda(&[VAULT_SEED, &game_id_bytes()]);
    let p1_choice = pda(&[PLAYER_CHOICE_SEED, &game_id_bytes(), p1.as_ref()]);
    let p2_choice = pda(&[PLAYER_CHOICE_SEED, &game_id_bytes(), p2.as_ref()]);
    let permission_game = permission_pda(&game);
    let permission1 = permission_pda(&p1_choice);
    let permission2 = permission_pda(&p2_choice);
    let game_address = as_address(game);
    let vault_address = as_address(vault);
    let p1_choice_address = as_address(p1_choice);
    let p2_choice_address = as_address(p2_choice);

    send(
        &mut svm,
        TransactionTarget::Base,
        &player1,
        &[],
        vec![
            create_game_ix(game, p1_choice, vault, p1),
            delegate_pda_ix(
                p1_choice,
                p1,
                validator,
                AccountType::PlayerChoice {
                    game_id: GAME_ID,
                    player: p1,
                },
            ),
        ],
        "create game + delegate p1 choice",
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player1,
        &[],
        vec![init_permission_ix(
            p1_choice,
            permission1,
            p1,
            AccountType::PlayerChoice {
                game_id: GAME_ID,
                player: p1,
            },
            Some(vec![member(p1)]),
        )],
        "init p1 choice permission",
    );
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &as_address(permission1))
            .is_some(),
        "Player 1 Choice permission never activated in-process"
    );

    send(
        &mut svm,
        TransactionTarget::Base,
        &player2,
        &[],
        vec![
            join_game_ix(game, p2_choice, vault, p2),
            delegate_pda_ix(game, p2, validator, AccountType::Game { game_id: GAME_ID }),
            delegate_pda_ix(
                p2_choice,
                p2,
                validator,
                AccountType::PlayerChoice {
                    game_id: GAME_ID,
                    player: p2,
                },
            ),
        ],
        "join + delegate game + p2 choice",
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player2,
        &[],
        vec![
            init_permission_ix(
                game,
                permission_game,
                p2,
                AccountType::Game { game_id: GAME_ID },
                Some(vec![member(p1), member(p2)]),
            ),
            init_permission_ix(
                p2_choice,
                permission2,
                p2,
                AccountType::PlayerChoice {
                    game_id: GAME_ID,
                    player: p2,
                },
                Some(vec![member(p2)]),
            ),
        ],
        "init game + p2 choice permissions",
    );
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &as_address(permission2))
            .is_some(),
        "Player 2 Choice permission never activated in-process"
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player1,
        &[],
        vec![make_choice_ix(p1_choice, p1, Choice::Rock)],
        "p1 rock",
    );
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player2,
        &[],
        vec![make_choice_ix(p2_choice, p2, Choice::Scissors)],
        "p2 scissors",
    );

    svm.set_authorized_user(Some(player1.pubkey()));
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &p1_choice_address)
            .is_some(),
        "Player 1 should read own choice"
    );
    svm.set_authorized_user(Some(player2.pubkey()));
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &p2_choice_address)
            .is_some(),
        "Player 2 should read own choice"
    );

    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &p1_choice_address)
            .is_none(),
        "❌ Player 1 choice account exists unexpectedly!"
    );
    svm.set_authorized_user(Some(player1.pubkey()));
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &p2_choice_address)
            .is_none(),
        "❌ Player 2 choice account exists unexpectedly!"
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player1,
        &[],
        vec![reveal_round_ix(
            game,
            p1_choice,
            p2_choice,
            permission_game,
            permission1,
            permission2,
            p1,
        )],
        "reveal round 1",
    );
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player2,
        &[],
        vec![next_round_ix(
            game,
            p1_choice,
            p2_choice,
            permission_game,
            permission1,
            permission2,
            p2,
        )],
        "next round",
    );
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player1,
        &[],
        vec![make_choice_ix(p1_choice, p1, Choice::Rock)],
        "round 2 p1 rock",
    );
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player2,
        &[],
        vec![make_choice_ix(p2_choice, p2, Choice::Scissors)],
        "round 2 p2 scissors",
    );
    svm.set_authorized_user(Some(player1.pubkey()));
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &p2_choice_address)
            .is_none(),
        "❌ Player 2 choice readable after reset!"
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player1,
        &[],
        vec![reveal_round_ix(
            game,
            p1_choice,
            p2_choice,
            permission_game,
            permission1,
            permission2,
            p1,
        )],
        "reveal round 2",
    );
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &player1,
        &[],
        vec![undelegate_all_ix(p1, game, p1_choice, p2_choice)],
        "undelegate all",
    );

    let game_base = svm
        .get_account_for(TransactionTarget::Base, &game_address)
        .expect("game back on base");
    assert_eq!(
        game_base.owner,
        program_address(),
        "game owner should be program"
    );

    let vault_before = svm.get_balance(&vault_address).unwrap_or(0);
    let p1_before = svm.get_balance(&player1.pubkey()).unwrap_or(0);
    send(
        &mut svm,
        TransactionTarget::Base,
        &player1,
        &[],
        vec![claim_pot_ix(game, vault, p1, p2, p1)],
        "claim pot",
    );
    let vault_after = svm.get_balance(&vault_address).unwrap_or(0);
    let p1_after = svm.get_balance(&player1.pubkey()).unwrap_or(0);
    assert_eq!(vault_after, 0, "vault not fully drained");
    assert!(
        p1_after + vault_before > p1_before,
        "winner did not receive pot"
    );
    let _ = vault_before;
}
