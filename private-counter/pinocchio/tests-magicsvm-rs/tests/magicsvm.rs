use {
    dlp_api::consts::DELEGATION_PROGRAM_ID,
    ephemeral_rollups_sdk::{
        access_control::structs::EphemeralPermission,
        consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    },
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
const CREATE_PERMISSION: [u8; 8] = [4, 0, 0, 0, 0, 0, 0, 0];
const UPDATE_PERMISSION: [u8; 8] = [5, 0, 0, 0, 0, 0, 0, 0];
const CLOSE_PERMISSION: [u8; 8] = [6, 0, 0, 0, 0, 0, 0, 0];

fn program_id() -> Address {
    program_id_from_keypair(env!("CARGO_MANIFEST_DIR"), "pinocchio_private_counter")
}

fn send(svm: &mut MagicSVM, target: TransactionTarget, tx: Transaction) {
    send_tx(svm, target, tx, "transaction");
}

fn counter_count(data: &[u8]) -> [u8; 8] {
    data[32..40].try_into().unwrap()
}

fn increment_tx(
    program_id: Address,
    counter: Address,
    payer: &Keypair,
    blockhash: Hash,
) -> Transaction {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&INCREASE_COUNTER);
    data.extend_from_slice(&1u64.to_le_bytes());
    let instruction = Instruction {
        program_id,
        accounts: vec![AccountMeta::new(counter, false)],
        data,
    };
    Transaction::new(
        &[payer],
        Message::new(&[instruction], Some(&payer.pubkey())),
        blockhash,
    )
}

fn permission_accounts(payer: Address, counter: Address, permission: Address) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(payer, true),
        AccountMeta::new(counter, false),
        AccountMeta::new_readonly(PERMISSION_PROGRAM_ID, false),
        AccountMeta::new(permission, false),
        AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
        AccountMeta::new(EPHEMERAL_VAULT_ID, false),
    ]
}

fn permission_tx(
    program_id: Address,
    payer: &Keypair,
    counter: Address,
    permission: Address,
    discriminator: [u8; 8],
    blockhash: Hash,
) -> Transaction {
    let instruction = Instruction {
        program_id,
        accounts: permission_accounts(payer.pubkey(), counter, permission),
        data: discriminator.to_vec(),
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

#[test]
fn pinocchio_private_counter_init_increment_delegate_permission_undelegate() {
    let payer = Keypair::new();
    let id = Keypair::new().pubkey();
    let mut svm = MagicSVM::new();
    let program_id = program_id();
    svm.add_program_from_file(
        program_id,
        program_so_path(env!("CARGO_MANIFEST_DIR"), "pinocchio_private_counter"),
    )
    .unwrap();
    svm.airdrop(&payer.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();

    let (counter, _bump) = Address::find_program_address(&[COUNTER_SEED, id.as_ref()], &program_id);
    let permission = EphemeralPermission::find_pda(&counter).0;

    let mut initialize_data = Vec::with_capacity(40);
    initialize_data.extend_from_slice(&INITIALIZE_COUNTER);
    initialize_data.extend_from_slice(id.as_ref());
    let blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        Transaction::new(
            &[&payer],
            Message::new(
                &[Instruction {
                    program_id,
                    accounts: vec![
                        AccountMeta::new(payer.pubkey(), true),
                        AccountMeta::new(counter, false),
                        AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
                    ],
                    data: initialize_data,
                }],
                Some(&payer.pubkey()),
            ),
            blockhash,
        ),
    );
    let account = svm.get_account(&counter).expect("counter must exist");
    assert_eq!(counter_count(&account.data), [0, 0, 0, 0, 0, 0, 0, 0]);

    let blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        increment_tx(program_id, counter, &payer, blockhash),
    );
    assert_eq!(
        counter_count(&svm.get_account(&counter).unwrap().data),
        [1, 0, 0, 0, 0, 0, 0, 0]
    );

    let validator = svm.validator_identity();
    let blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        Transaction::new(
            &[&payer],
            Message::new(
                &[Instruction {
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
                    data: DELEGATE_COUNTER.to_vec(),
                }],
                Some(&payer.pubkey()),
            ),
            blockhash,
        ),
    );
    assert_eq!(
        svm.get_account(&counter).expect("delegated counter").owner,
        DELEGATION_PROGRAM_ID
    );

    let blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_tx(program_id, counter, &payer, blockhash),
    );
    assert_eq!(
        counter_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter)
                .unwrap()
                .data
        ),
        [2, 0, 0, 0, 0, 0, 0, 0]
    );

    let blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        permission_tx(
            program_id,
            &payer,
            counter,
            permission,
            CREATE_PERMISSION,
            blockhash,
        ),
    );
    let permission_account = svm
        .get_account_for(TransactionTarget::Ephemeral, &permission)
        .expect("permission must exist");
    assert_eq!(&permission_account.data[36..68], program_id.as_ref());
    assert_eq!(&permission_account.data[69..101], payer.pubkey().as_ref());

    svm.set_authorized_user(Some(payer.pubkey()));
    assert_eq!(
        counter_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter)
                .unwrap()
                .data
        ),
        [2, 0, 0, 0, 0, 0, 0, 0]
    );
    svm.set_authorized_user(Some(Keypair::new().pubkey()));
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &counter)
            .is_none(),
        "unauthorized viewer must not read a private counter"
    );
    svm.set_authorized_user(None);
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &counter)
            .is_none(),
        "anonymous viewer must not read a private counter"
    );

    let blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        permission_tx(
            program_id,
            &payer,
            counter,
            permission,
            UPDATE_PERMISSION,
            blockhash,
        ),
    );
    let permission_account = svm
        .get_account_for(TransactionTarget::Ephemeral, &permission)
        .expect("permission must exist");
    assert_eq!(&permission_account.data[36..68], program_id.as_ref());
    assert_eq!(permission_account.data.len(), 68);
    svm.set_authorized_user(Some(payer.pubkey()));
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &counter)
            .is_none(),
        "private counter with no members must be hidden from the authority"
    );
    svm.set_authorized_user(None);
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &counter)
            .is_none(),
        "private counter with no members must be hidden from anonymous viewers"
    );

    let blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        permission_tx(
            program_id,
            &payer,
            counter,
            permission,
            CLOSE_PERMISSION,
            blockhash,
        ),
    );
    svm.set_authorized_user(None);
    assert_eq!(
        counter_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter)
                .unwrap()
                .data
        ),
        [2, 0, 0, 0, 0, 0, 0, 0]
    );
    svm.set_authorized_user(Some(payer.pubkey()));
    assert_eq!(
        counter_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &counter)
                .unwrap()
                .data
        ),
        [2, 0, 0, 0, 0, 0, 0, 0]
    );

    let blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        Transaction::new(
            &[&payer],
            Message::new(
                &[Instruction {
                    program_id,
                    accounts: vec![
                        AccountMeta::new(payer.pubkey(), true),
                        AccountMeta::new(counter, false),
                        AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
                        AccountMeta::new(MAGIC_CONTEXT_ID, false),
                    ],
                    data: COMMIT_AND_UNDELEGATE.to_vec(),
                }],
                Some(&payer.pubkey()),
            ),
            blockhash,
        ),
    );
    let account = svm.get_account(&counter).expect("counter must exist");
    assert_eq!(account.owner, program_id);
}
