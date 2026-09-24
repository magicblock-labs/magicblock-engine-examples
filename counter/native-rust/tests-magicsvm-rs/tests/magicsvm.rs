use {
    dlp_api::consts::DELEGATION_PROGRAM_ID,
    ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID},
    magicsvm::{MagicSVM, TransactionTarget},
    solana_address::Address,
    solana_hash::Hash,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::path::PathBuf,
    test_utils::send_tx,
};

const COUNTER_SEED: &[u8] = b"counter";

fn deploy_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("target/deploy")
}

fn program_id() -> Address {
    let path = deploy_dir().join("rust_counter-keypair.json");
    let bytes: Vec<u8> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    Address::new_from_array(bytes[32..64].try_into().unwrap())
}

fn program_so_path() -> PathBuf {
    deploy_dir().join("rust_counter.so")
}

fn counter_pda(program_id: &Address, initializer: &Address) -> Address {
    Address::find_program_address(&[COUNTER_SEED, initializer.as_ref()], program_id).0
}

fn delegate_buffer(program_id: &Address, counter: &Address) -> Address {
    Address::find_program_address(&[b"buffer", counter.as_ref()], program_id).0
}

fn delegation_pda(seed: &[u8], delegated_account: &Address) -> Address {
    Address::find_program_address(&[seed, delegated_account.as_ref()], &DELEGATION_PROGRAM_ID).0
}

fn initialize_ix_data() -> Vec<u8> {
    vec![0, 0, 0, 0, 0, 0, 0, 0]
}

fn increase_ix_data(increase_by: u64) -> Vec<u8> {
    let mut data = vec![1, 0, 0, 0, 0, 0, 0, 0];
    data.extend_from_slice(&increase_by.to_le_bytes());
    data
}

fn delegate_ix_data() -> Vec<u8> {
    vec![2, 0, 0, 0, 0, 0, 0, 0]
}

fn commit_and_undelegate_ix_data() -> Vec<u8> {
    vec![3, 0, 0, 0, 0, 0, 0, 0]
}

fn commit_ix_data() -> Vec<u8> {
    vec![4, 0, 0, 0, 0, 0, 0, 0]
}

fn increment_and_commit_ix_data(increase_by: u64) -> Vec<u8> {
    let mut data = vec![5, 0, 0, 0, 0, 0, 0, 0];
    data.extend_from_slice(&increase_by.to_le_bytes());
    data
}

fn increment_and_undelegate_ix_data(increase_by: u64) -> Vec<u8> {
    let mut data = vec![6, 0, 0, 0, 0, 0, 0, 0];
    data.extend_from_slice(&increase_by.to_le_bytes());
    data
}

fn send_ok(svm: &mut MagicSVM, target: TransactionTarget, tx: Transaction) {
    send_tx(svm, target, tx, "transaction");
}

fn send_built(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    build: impl FnOnce(Hash) -> Transaction,
) {
    let tx = build(svm.latest_blockhash_for(target));
    send_ok(svm, target, tx);
}

fn signed_tx(payer: &Keypair, instruction: Instruction, blockhash: Hash) -> Transaction {
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

fn initialize_tx(
    program_id: Address,
    payer: &Keypair,
    counter: Address,
    blockhash: Hash,
) -> Transaction {
    signed_tx(
        payer,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(counter, false),
                AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
            ],
            data: initialize_ix_data(),
        },
        blockhash,
    )
}

fn increase_tx(
    program_id: Address,
    payer: &Keypair,
    counter: Address,
    increase_by: u64,
    blockhash: Hash,
) -> Transaction {
    signed_tx(
        payer,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(counter, false),
            ],
            data: increase_ix_data(increase_by),
        },
        blockhash,
    )
}

fn delegate_tx(
    program_id: Address,
    payer: &Keypair,
    counter: Address,
    validator: Address,
    blockhash: Hash,
) -> Transaction {
    signed_tx(
        payer,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
                AccountMeta::new(counter, false),
                AccountMeta::new_readonly(program_id, false),
                AccountMeta::new(delegate_buffer(&program_id, &counter), false),
                AccountMeta::new(delegation_pda(b"delegation", &counter), false),
                AccountMeta::new(delegation_pda(b"delegation-metadata", &counter), false),
                AccountMeta::new_readonly(DELEGATION_PROGRAM_ID, false),
                AccountMeta::new_readonly(validator, false),
            ],
            data: delegate_ix_data(),
        },
        blockhash,
    )
}

fn commit_style_tx(
    program_id: Address,
    payer: &Keypair,
    counter: Address,
    data: Vec<u8>,
    blockhash: Hash,
) -> Transaction {
    signed_tx(
        payer,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(counter, false),
                AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
                AccountMeta::new(MAGIC_CONTEXT_ID, false),
            ],
            data,
        },
        blockhash,
    )
}

fn setup() -> (MagicSVM, Keypair, Address, Address) {
    let payer = Keypair::new();
    let program_id = program_id();
    let mut svm = MagicSVM::new();
    svm.add_program_from_file(program_id, program_so_path())
        .unwrap();
    svm.airdrop(&payer.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();
    let counter = counter_pda(&program_id, &payer.pubkey());
    (svm, payer, program_id, counter)
}

fn counter_count(svm: &MagicSVM, target: TransactionTarget, counter: &Address) -> u64 {
    let data = svm
        .get_account_for(target, counter)
        .unwrap_or_else(|| panic!("counter {counter} missing on {target:?}"))
        .data;
    u64::from_le_bytes(data[..8].try_into().unwrap())
}

fn counter_owner(svm: &MagicSVM, target: TransactionTarget, counter: &Address) -> Address {
    svm.get_account_for(target, counter)
        .unwrap_or_else(|| panic!("counter {counter} missing on {target:?}"))
        .owner
}

#[test]
fn rust_counter_init_increment_delegate_er_commit_undelegate() {
    let (mut svm, payer, program_id, counter) = setup();
    let validator = svm.validator_identity();

    send_built(&mut svm, TransactionTarget::Base, |bh| {
        initialize_tx(program_id, &payer, counter, bh)
    });
    assert_eq!(counter_count(&svm, TransactionTarget::Base, &counter), 0);

    send_built(&mut svm, TransactionTarget::Base, |bh| {
        increase_tx(program_id, &payer, counter, 1, bh)
    });
    assert_eq!(counter_count(&svm, TransactionTarget::Base, &counter), 1);

    send_built(&mut svm, TransactionTarget::Base, |bh| {
        delegate_tx(program_id, &payer, counter, validator, bh)
    });
    assert_eq!(
        counter_owner(&svm, TransactionTarget::Base, &counter),
        DELEGATION_PROGRAM_ID
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Ephemeral, &counter),
        1
    );

    send_built(&mut svm, TransactionTarget::Ephemeral, |bh| {
        increase_tx(program_id, &payer, counter, 1, bh)
    });
    assert_eq!(
        counter_count(&svm, TransactionTarget::Ephemeral, &counter),
        2
    );

    send_built(&mut svm, TransactionTarget::Ephemeral, |bh| {
        commit_style_tx(program_id, &payer, counter, commit_ix_data(), bh)
    });
    assert_eq!(counter_count(&svm, TransactionTarget::Base, &counter), 2);
    assert_eq!(
        counter_owner(&svm, TransactionTarget::Base, &counter),
        DELEGATION_PROGRAM_ID
    );

    send_built(&mut svm, TransactionTarget::Ephemeral, |bh| {
        increase_tx(program_id, &payer, counter, 1, bh)
    });
    assert_eq!(
        counter_count(&svm, TransactionTarget::Ephemeral, &counter),
        3
    );

    send_built(&mut svm, TransactionTarget::Ephemeral, |bh| {
        commit_style_tx(
            program_id,
            &payer,
            counter,
            commit_and_undelegate_ix_data(),
            bh,
        )
    });
    assert_eq!(counter_count(&svm, TransactionTarget::Base, &counter), 3);
    assert_eq!(
        counter_owner(&svm, TransactionTarget::Base, &counter),
        program_id
    );
}

#[test]
fn rust_counter_increment_and_commit_then_undelegate() {
    let (mut svm, payer, program_id, counter) = setup();
    let validator = svm.validator_identity();

    send_built(&mut svm, TransactionTarget::Base, |bh| {
        initialize_tx(program_id, &payer, counter, bh)
    });
    send_built(&mut svm, TransactionTarget::Base, |bh| {
        delegate_tx(program_id, &payer, counter, validator, bh)
    });

    send_built(&mut svm, TransactionTarget::Ephemeral, |bh| {
        commit_style_tx(
            program_id,
            &payer,
            counter,
            increment_and_commit_ix_data(1),
            bh,
        )
    });
    assert_eq!(
        counter_count(&svm, TransactionTarget::Ephemeral, &counter),
        1
    );
    assert_eq!(counter_count(&svm, TransactionTarget::Base, &counter), 1);
    assert_eq!(
        counter_owner(&svm, TransactionTarget::Base, &counter),
        DELEGATION_PROGRAM_ID
    );

    send_built(&mut svm, TransactionTarget::Ephemeral, |bh| {
        commit_style_tx(
            program_id,
            &payer,
            counter,
            increment_and_undelegate_ix_data(1),
            bh,
        )
    });
    assert_eq!(counter_count(&svm, TransactionTarget::Base, &counter), 2);
    assert_eq!(
        counter_owner(&svm, TransactionTarget::Base, &counter),
        program_id
    );
}
