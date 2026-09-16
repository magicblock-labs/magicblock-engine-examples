use {
    anchor_counter_session::{self, accounts, instruction, COUNTER_SEED},
    anchor_lang::{prelude::Pubkey, system_program, Id, InstructionData, ToAccountMetas},
    ephemeral_rollups_sdk::{
        anchor::{DelegationProgram, MagicProgram},
        consts::MAGIC_CONTEXT_ID,
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account,
        },
    },
    magicsvm::{MagicSVM, TransactionTarget},
    session_keys::{self, SessionTokenV2},
    solana_address::Address,
    solana_clock::Clock,
    solana_hash::Hash,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    },
    test_utils::{as_address, as_pubkey, program_id_from_idl, send_tx as send, sign_tx},
};

fn program_so_path() -> PathBuf {
    test_utils::program_so_path(env!("CARGO_MANIFEST_DIR"), "anchor_counter_session")
}

fn session_so_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests-magicsvm/fixtures/session-keys.so")
}

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "anchor_counter_session.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn session_program_address() -> Address {
    as_address(session_keys::ID)
}

fn client_ix(
    program: Pubkey,
    data: impl InstructionData,
    accounts: impl ToAccountMetas,
) -> Instruction {
    test_utils::client_ix(as_address(program), data, accounts)
}

fn sign_ix(signers: &[&Keypair], instruction: Instruction, blockhash: Hash) -> Transaction {
    sign_tx(signers, &[instruction], blockhash)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_secs() as i64
}

fn set_clock_now(svm: &mut MagicSVM) {
    let now = now_unix();
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = now;
    svm.set_sysvar(&clock);
    svm.ephemeral_mut().set_sysvar(&clock);
}

fn session_token_pda(session_signer: &Pubkey, authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            SessionTokenV2::SEED_PREFIX.as_bytes(),
            program_id().as_ref(),
            session_signer.as_ref(),
            authority.as_ref(),
        ],
        &session_keys::ID,
    )
    .0
}

fn create_session_v2_tx(
    session_token: Pubkey,
    session_signer: &Keypair,
    payer: &Keypair,
    blockhash: Hash,
) -> Transaction {
    let valid_until = now_unix() + 3600;
    let lamports = (0.005 * LAMPORTS_PER_SOL as f64) as u64;
    sign_ix(
        &[payer, session_signer],
        client_ix(
            session_keys::ID,
            session_keys::instruction::CreateSessionV2 {
                top_up: Some(true),
                valid_until: Some(valid_until),
                lamports: Some(lamports),
            },
            session_keys::accounts::CreateSessionTokenV2 {
                session_token,
                session_signer: as_pubkey(&session_signer.pubkey()),
                fee_payer: as_pubkey(&payer.pubkey()),
                authority: as_pubkey(&payer.pubkey()),
                target_program: program_id(),
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn initialize_tx(counter: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    sign_ix(
        &[payer],
        client_ix(
            program_id(),
            instruction::Initialize {},
            accounts::Initialize {
                user: as_pubkey(&payer.pubkey()),
                counter,
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn increment_tx(
    counter: Pubkey,
    session_token: Pubkey,
    session_signer: &Keypair,
    blockhash: Hash,
) -> Transaction {
    sign_ix(
        &[session_signer],
        client_ix(
            program_id(),
            instruction::Increment {},
            accounts::Increment {
                payer: as_pubkey(&session_signer.pubkey()),
                counter,
                session_token: Some(session_token),
            },
        ),
        blockhash,
    )
}

fn delegate_tx(
    counter: Pubkey,
    session_token: Pubkey,
    session_signer: &Keypair,
    validator: Address,
    blockhash: Hash,
) -> Transaction {
    let mut instruction = client_ix(
        program_id(),
        instruction::Delegate {},
        accounts::DelegateInput {
            payer: as_pubkey(&session_signer.pubkey()),
            buffer_pda: delegate_buffer_pda_from_delegated_account_and_owner_program(
                &counter,
                &program_id(),
            ),
            delegation_record_pda: delegation_record_pda_from_delegated_account(&counter),
            delegation_metadata_pda: delegation_metadata_pda_from_delegated_account(&counter),
            pda: counter,
            session_token: Some(session_token),
            owner_program: program_id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    );
    instruction
        .accounts
        .push(AccountMeta::new_readonly(validator, false));
    sign_ix(&[session_signer], instruction, blockhash)
}

fn commit_style_tx(
    counter: Pubkey,
    session_token: Pubkey,
    session_signer: &Keypair,
    data: impl InstructionData,
    blockhash: Hash,
) -> Transaction {
    sign_ix(
        &[session_signer],
        client_ix(
            program_id(),
            data,
            accounts::IncrementAndCommit {
                payer: as_pubkey(&session_signer.pubkey()),
                counter,
                session_token: Some(session_token),
                magic_program: MagicProgram::id(),
                magic_context: MAGIC_CONTEXT_ID,
            },
        ),
        blockhash,
    )
}

fn revoke_session_v2_tx(session_token: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    sign_ix(
        &[payer],
        client_ix(
            session_keys::ID,
            session_keys::instruction::RevokeSessionV2 {},
            session_keys::accounts::RevokeSessionTokenV2 {
                session_token,
                fee_payer: as_pubkey(&payer.pubkey()),
                authority: as_pubkey(&payer.pubkey()),
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn counter_count(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[40..48].try_into().expect("counter data"))
}

#[test]
fn anchor_counter_session_local_er_flow() {
    let payer = Keypair::new();
    let session_signer = Keypair::new();
    let mut svm = MagicSVM::new();
    set_clock_now(&mut svm);

    let authority = as_pubkey(&payer.pubkey());
    let (counter, _) =
        Pubkey::find_program_address(&[COUNTER_SEED, authority.as_ref()], &program_id());
    let session_token = session_token_pda(&as_pubkey(&session_signer.pubkey()), &authority);
    let counter_address = as_address(counter);
    let session_token_address = as_address(session_token);

    svm.add_program_from_file(program_address(), program_so_path())
        .unwrap();
    svm.add_program_from_file(session_program_address(), session_so_path())
        .unwrap();
    svm.airdrop(&payer.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();

    let base_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        create_session_v2_tx(session_token, &session_signer, &payer, base_blockhash),
        "createSessionV2",
    );
    let session_account = svm
        .get_account(&session_token_address)
        .expect("session token");
    assert_eq!(session_account.owner, session_program_address());

    let base_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        initialize_tx(counter, &payer, base_blockhash),
        "initialize",
    );
    assert_eq!(
        counter_count(&svm.get_account(&counter_address).unwrap().data),
        0
    );

    let base_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        increment_tx(counter, session_token, &session_signer, base_blockhash),
        "increment (base)",
    );
    assert_eq!(
        counter_count(&svm.get_account(&counter_address).unwrap().data),
        1
    );

    let validator = svm.validator_identity();
    let base_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        delegate_tx(
            counter,
            session_token,
            &session_signer,
            validator,
            base_blockhash,
        ),
        "delegate",
    );
    assert_eq!(
        svm.get_account(&counter_address).unwrap().owner,
        as_address(DelegationProgram::id())
    );

    let ephemeral_blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_tx(counter, session_token, &session_signer, ephemeral_blockhash),
        "increment (ER)",
    );
    assert_eq!(
        counter_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter_address)
                .unwrap()
                .data
        ),
        2
    );

    let ephemeral_blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        commit_style_tx(
            counter,
            session_token,
            &session_signer,
            instruction::Commit {},
            ephemeral_blockhash,
        ),
        "commit",
    );
    let base_after_commit = svm.get_account(&counter_address).unwrap();
    assert_eq!(counter_count(&base_after_commit.data), 2);
    assert_eq!(base_after_commit.owner, as_address(DelegationProgram::id()));

    let ephemeral_blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        commit_style_tx(
            counter,
            session_token,
            &session_signer,
            instruction::IncrementAndCommit {},
            ephemeral_blockhash,
        ),
        "incrementAndCommit",
    );
    assert_eq!(
        counter_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter_address)
                .unwrap()
                .data
        ),
        3
    );
    assert_eq!(
        counter_count(&svm.get_account(&counter_address).unwrap().data),
        3
    );

    let ephemeral_blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        commit_style_tx(
            counter,
            session_token,
            &session_signer,
            instruction::IncrementAndUndelegate {},
            ephemeral_blockhash,
        ),
        "incrementAndUndelegate",
    );
    let base_after_undelegate = svm.get_account(&counter_address).unwrap();
    assert_eq!(counter_count(&base_after_undelegate.data), 4);
    assert_eq!(base_after_undelegate.owner, program_address());

    let base_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        revoke_session_v2_tx(session_token, &payer, base_blockhash),
        "revokeSessionV2",
    );
    assert!(svm.get_account(&session_token_address).is_none());
}
