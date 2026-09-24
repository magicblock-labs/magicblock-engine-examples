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
    test_utils::{program_id_from_keypair, program_so_path, send_tx},
};

const COUNTER_SEED: &[u8] = b"counter";
const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
const DELEGATE_COUNTER: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];
const COMMIT_AND_UNDELEGATE: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
const COMMIT: [u8; 8] = [4, 0, 0, 0, 0, 0, 0, 0];

fn program_id() -> Address {
    program_id_from_keypair(env!("CARGO_MANIFEST_DIR"), "pinocchio_counter")
}

fn send(svm: &mut MagicSVM, target: TransactionTarget, tx: Transaction) {
    send_tx(svm, target, tx, "transaction");
}

fn read_counter(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[..8].try_into().unwrap())
}

fn initialize_tx(
    program_id: Address,
    counter: Address,
    payer: &Keypair,
    bump: u8,
    blockhash: Hash,
) -> Transaction {
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&INITIALIZE_COUNTER);
    data.push(bump);
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(counter, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data,
    };
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

fn increment_tx(
    program_id: Address,
    counter: Address,
    payer: &Keypair,
    bump: u8,
    increase_by: u64,
    blockhash: Hash,
) -> Transaction {
    let mut data = Vec::with_capacity(17);
    data.extend_from_slice(&INCREASE_COUNTER);
    data.push(bump);
    data.extend_from_slice(&increase_by.to_le_bytes());
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(counter, false),
        ],
        data,
    };
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

fn delegate_buffer(counter: &Address, owner_program: &Address) -> Address {
    Address::find_program_address(&[b"buffer", counter.as_ref()], owner_program).0
}

fn delegation_pda(seed: &[u8], delegated_account: &Address) -> Address {
    Address::find_program_address(&[seed, delegated_account.as_ref()], &DELEGATION_PROGRAM_ID).0
}

fn delegate_tx(
    program_id: Address,
    counter: Address,
    payer: &Keypair,
    bump: u8,
    validator: Address,
    blockhash: Hash,
) -> Transaction {
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(counter, false),
            AccountMeta::new_readonly(program_id, false),
            AccountMeta::new(delegate_buffer(&counter, &program_id), false),
            AccountMeta::new(delegation_pda(b"delegation", &counter), false),
            AccountMeta::new(delegation_pda(b"delegation-metadata", &counter), false),
            AccountMeta::new_readonly(DELEGATION_PROGRAM_ID, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
            AccountMeta::new_readonly(validator, false),
        ],
        data: {
            let mut data = Vec::with_capacity(9);
            data.extend_from_slice(&DELEGATE_COUNTER);
            data.push(bump);
            data
        },
    };
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

fn commit_tx(
    program_id: Address,
    counter: Address,
    payer: &Keypair,
    blockhash: Hash,
) -> Transaction {
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(counter, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
        ],
        data: COMMIT.to_vec(),
    };
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

fn undelegate_tx(
    program_id: Address,
    counter: Address,
    payer: &Keypair,
    blockhash: Hash,
) -> Transaction {
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(counter, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
        ],
        data: COMMIT_AND_UNDELEGATE.to_vec(),
    };
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

#[test]
fn pinocchio_counter_init_increment_delegate_er_commit_undelegate() {
    let payer = Keypair::new();
    let mut svm = MagicSVM::new();
    let program_id = program_id();
    svm.add_program_from_file(
        program_id,
        program_so_path(env!("CARGO_MANIFEST_DIR"), "pinocchio_counter"),
    )
    .unwrap();
    svm.airdrop(&payer.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();

    let (counter, bump) =
        Address::find_program_address(&[COUNTER_SEED, payer.pubkey().as_ref()], &program_id);

    let tx = initialize_tx(
        program_id,
        counter,
        &payer,
        bump,
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    send(&mut svm, TransactionTarget::Base, tx);
    let account = svm.get_account(&counter).expect("counter must exist");
    assert_eq!(account.owner, program_id);
    assert_eq!(account.data.len(), 8);
    assert_eq!(read_counter(&account.data), 0);

    let tx = increment_tx(
        program_id,
        counter,
        &payer,
        bump,
        1,
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    send(&mut svm, TransactionTarget::Base, tx);
    assert_eq!(read_counter(&svm.get_account(&counter).unwrap().data), 1);

    let validator = svm.validator_identity();
    let tx = delegate_tx(
        program_id,
        counter,
        &payer,
        bump,
        validator,
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    send(&mut svm, TransactionTarget::Base, tx);
    assert_eq!(
        svm.get_account(&counter).unwrap().owner,
        DELEGATION_PROGRAM_ID
    );

    let tx = increment_tx(
        program_id,
        counter,
        &payer,
        bump,
        1,
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send(&mut svm, TransactionTarget::Ephemeral, tx);
    assert_eq!(
        read_counter(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter)
                .unwrap()
                .data
        ),
        2
    );

    let tx = commit_tx(
        program_id,
        counter,
        &payer,
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send(&mut svm, TransactionTarget::Ephemeral, tx);
    assert_eq!(read_counter(&svm.get_account(&counter).unwrap().data), 2);

    let tx = increment_tx(
        program_id,
        counter,
        &payer,
        bump,
        1,
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send(&mut svm, TransactionTarget::Ephemeral, tx);
    assert_eq!(
        read_counter(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter)
                .unwrap()
                .data
        ),
        3
    );

    let tx = undelegate_tx(
        program_id,
        counter,
        &payer,
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send(&mut svm, TransactionTarget::Ephemeral, tx);
    let account = svm.get_account(&counter).expect("counter must exist");
    assert_eq!(account.owner, program_id);
    assert_eq!(read_counter(&account.data), 3);
}
