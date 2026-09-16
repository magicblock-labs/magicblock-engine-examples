use {
    anchor_lang::{prelude::Pubkey, system_program, Id, InstructionData, ToAccountMetas},
    ephemeral_rollups_sdk::{
        anchor::{DelegationProgram, MagicProgram},
        consts::MAGIC_CONTEXT_ID,
        dlp_api::discriminator::DlpDiscriminator,
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account, ephemeral_balance_pda_from_payer,
        },
    },
    magic_actions::{
        self, accounts, instruction, ACTION_ESCROW_INDEX, COUNTER_SEED, LEADERBOARD_SEED,
    },
    magicsvm::{MagicSVM, TransactionTarget},
    solana_address::Address,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    solana_transaction_error::TransactionError,
    std::path::PathBuf,
    test_utils::{
        as_address, as_pubkey, client_ix, program_id_from_idl, program_so_path, send_ixs,
    },
};

fn program_so() -> PathBuf {
    program_so_path(env!("CARGO_MANIFEST_DIR"), "magic_actions")
}

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "magic_actions.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &program_id()).0
}

fn send(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    payer: &Keypair,
    instructions: &[Instruction],
) {
    send_ixs(svm, target, &[payer], instructions, "transaction");
}

fn send_expecting_failure(
    svm: &mut MagicSVM,
    payer: &Keypair,
    extra: &[&Keypair],
    instructions: &[Instruction],
) -> (TransactionError, String) {
    let blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    let mut tx = Transaction::new_unsigned(Message::new(instructions, Some(&payer.pubkey())));
    let mut signers = Vec::with_capacity(1 + extra.len());
    signers.push(payer);
    signers.extend(extra.iter().copied());
    tx.partial_sign(&signers, blockhash);
    let err = svm
        .send_transaction_to(TransactionTarget::Base, tx)
        .expect_err("expected FailedTransactionMetadata");
    let logs = err.meta.logs.join("\n");
    (err.err, logs)
}

fn initialize_ix(counter: Pubkey, leaderboard: Pubkey, user: Pubkey) -> Instruction {
    ix(
        instruction::Initialize {},
        accounts::Initialize {
            counter,
            leaderboard,
            user,
            system_program: system_program::ID,
        },
    )
}

fn increment_ix(counter: Pubkey) -> Instruction {
    ix(instruction::Increment {}, accounts::Increment { counter })
}

fn update_leaderboard_ix(
    leaderboard: Pubkey,
    counter: Pubkey,
    escrow_auth: Pubkey,
    escrow: Pubkey,
) -> Instruction {
    ix(
        instruction::UpdateLeaderboard {},
        accounts::UpdateLeaderboard {
            leaderboard,
            counter,
            escrow_auth,
            escrow,
        },
    )
}

fn delegate_ix(payer: Pubkey, counter: Pubkey, validator: Address) -> Instruction {
    let mut instruction = ix(
        instruction::Delegate {},
        accounts::DelegateCounter {
            payer,
            buffer_pda: delegate_buffer_pda_from_delegated_account_and_owner_program(
                &counter,
                &program_id(),
            ),
            delegation_record_pda: delegation_record_pda_from_delegated_account(&counter),
            delegation_metadata_pda: delegation_metadata_pda_from_delegated_account(&counter),
            pda: counter,
            owner_program: program_id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    );
    instruction
        .accounts
        .push(AccountMeta::new_readonly(validator, false));
    instruction
}

fn undelegate_ix(payer: Pubkey, counter: Pubkey) -> Instruction {
    ix(
        instruction::Undelegate {},
        accounts::UndelegateCounter {
            payer,
            counter,
            magic_program: MagicProgram::id(),
            magic_context: MAGIC_CONTEXT_ID,
        },
    )
}

fn commit_and_update_leaderboard_ix(
    payer: Pubkey,
    counter: Pubkey,
    leaderboard: Pubkey,
) -> Instruction {
    ix(
        instruction::CommitAndUpdateLeaderboard {},
        accounts::CommitAndUpdateLeaderboard {
            payer,
            counter,
            leaderboard,
            program_id: program_id(),
            magic_program: MagicProgram::id(),
            magic_context: MAGIC_CONTEXT_ID,
        },
    )
}

fn top_up_escrow_ix(payer: Address, escrow: Address) -> Instruction {
    let mut data = DlpDiscriminator::TopUpEphemeralBalance.to_vec();
    data.extend_from_slice(&10_000u64.to_le_bytes());
    data.push(ACTION_ESCROW_INDEX);
    Instruction {
        program_id: as_address(DelegationProgram::id()),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(payer, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new_readonly(as_address(system_program::ID), false),
        ],
        data,
    }
}

fn close_escrow_ix(payer: Address, escrow: Address) -> Instruction {
    Instruction {
        program_id: as_address(DelegationProgram::id()),
        accounts: vec![
            AccountMeta::new_readonly(payer, true),
            AccountMeta::new(escrow, false),
            AccountMeta::new_readonly(as_address(system_program::ID), false),
        ],
        data: [
            DlpDiscriminator::CloseEphemeralBalance.to_vec(),
            vec![ACTION_ESCROW_INDEX],
        ]
        .concat(),
    }
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}

#[test]
fn magic_actions_local_sequence() {
    let payer = Keypair::new();
    let mut svm = MagicSVM::new();
    let counter = pda(&[COUNTER_SEED]);
    let leaderboard = pda(&[LEADERBOARD_SEED]);
    let payer_pk = as_pubkey(&payer.pubkey());
    let escrow = ephemeral_balance_pda_from_payer(&payer_pk, ACTION_ESCROW_INDEX);
    let counter_address = as_address(counter);
    let leaderboard_address = as_address(leaderboard);
    let escrow_address = as_address(escrow);
    let validator = svm.validator_identity();

    svm.add_program_from_file(program_address(), program_so())
        .unwrap();
    svm.airdrop(&payer.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

    send(
        &mut svm,
        TransactionTarget::Base,
        &payer,
        &[initialize_ix(counter, leaderboard, payer_pk)],
    );
    assert_eq!(
        read_u64(&svm.get_account(&counter_address).unwrap().data, 8),
        0
    );
    assert_eq!(
        read_u64(&svm.get_account(&leaderboard_address).unwrap().data, 8),
        0
    );

    send(
        &mut svm,
        TransactionTarget::Base,
        &payer,
        &[increment_ix(counter)],
    );
    assert_eq!(
        read_u64(&svm.get_account(&counter_address).unwrap().data, 8),
        1
    );

    let (err, logs) = send_expecting_failure(
        &mut svm,
        &payer,
        &[],
        &[update_leaderboard_ix(
            leaderboard,
            counter,
            payer_pk,
            escrow,
        )],
    );
    let blob = format!("{err:?}\n{logs}");
    assert!(
        matches!(err, TransactionError::SignatureFailure)
            || blob.to_lowercase().contains("signature")
            || blob.to_lowercase().contains("unknown signer"),
        "expected signature verification failure, got {blob}"
    );

    let invalid_escrow = Keypair::new();
    let (_, logs) = send_expecting_failure(
        &mut svm,
        &payer,
        &[&invalid_escrow],
        &[update_leaderboard_ix(
            leaderboard,
            leaderboard,
            payer_pk,
            as_pubkey(&invalid_escrow.pubkey()),
        )],
    );
    assert!(
        logs.contains("ConstraintSeeds"),
        "expected ConstraintSeeds, logs: {logs}"
    );

    let invalid_escrow = Keypair::new();
    let (_, logs) = send_expecting_failure(
        &mut svm,
        &payer,
        &[&invalid_escrow],
        &[update_leaderboard_ix(
            leaderboard,
            counter,
            payer_pk,
            as_pubkey(&invalid_escrow.pubkey()),
        )],
    );
    assert!(
        logs.contains("ConstraintAddress"),
        "expected ConstraintAddress, logs: {logs}"
    );

    send(
        &mut svm,
        TransactionTarget::Base,
        &payer,
        &[
            top_up_escrow_ix(payer.pubkey(), escrow_address),
            delegate_ix(payer_pk, counter, validator),
        ],
    );
    assert_eq!(
        svm.get_account(&counter_address).unwrap().owner,
        as_address(DelegationProgram::id())
    );
    assert_eq!(
        read_u64(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter_address)
                .unwrap()
                .data,
            8
        ),
        1
    );
    assert!(svm.get_account(&escrow_address).unwrap().lamports > 0);

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &payer,
        &[increment_ix(counter)],
    );
    assert_eq!(
        read_u64(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter_address)
                .unwrap()
                .data,
            8
        ),
        2
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &payer,
        &[commit_and_update_leaderboard_ix(
            payer_pk,
            counter,
            leaderboard,
        )],
    );
    let er_count = read_u64(
        &svm.get_account_for(TransactionTarget::Ephemeral, &counter_address)
            .unwrap()
            .data,
        8,
    );
    let high_score = read_u64(&svm.get_account(&leaderboard_address).unwrap().data, 8);
    assert_eq!(
        high_score, er_count,
        "post-commit magic action must update the base leaderboard from the committed counter"
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &payer,
        &[undelegate_ix(payer_pk, counter)],
    );
    let base = svm.get_account(&counter_address).unwrap();
    assert_eq!(base.owner, program_address());
    assert_eq!(read_u64(&base.data, 8), 2);

    send(
        &mut svm,
        TransactionTarget::Base,
        &payer,
        &[close_escrow_ix(payer.pubkey(), escrow_address)],
    );
    let closed = svm.get_account(&escrow_address);
    assert!(closed.is_none() || closed.unwrap().lamports == 0);
}
