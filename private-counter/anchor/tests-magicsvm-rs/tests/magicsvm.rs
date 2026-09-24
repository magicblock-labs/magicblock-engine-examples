use {
    anchor_lang::{prelude::Pubkey, system_program, Id, InstructionData, ToAccountMetas},
    ephemeral_rollups_sdk::{
        access_control::structs::EphemeralPermission,
        anchor::{DelegationProgram, MagicProgram},
        consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account,
        },
    },
    magicsvm::{MagicSVM, TransactionTarget},
    private_counter::{self, accounts, instruction, COUNTER_SEED},
    solana_address::Address,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::path::PathBuf,
    test_utils::{
        as_address, as_pubkey, client_ix, is_delegated, program_id_from_idl, send_tx, sign_tx,
    },
};

fn deploy_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/deploy")
}

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "private_counter.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn send(svm: &mut MagicSVM, target: TransactionTarget, tx: Transaction) {
    send_tx(svm, target, tx, "transaction");
}

fn tx(payer: &Keypair, ix: Instruction, blockhash: solana_hash::Hash) -> Transaction {
    sign_tx(&[payer], &[ix], blockhash)
}

fn counter_pda(authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[COUNTER_SEED, authority.as_ref()], &program_id()).0
}

fn permission_pda(counter: &Pubkey) -> Pubkey {
    EphemeralPermission::find_pda(counter).0
}

fn counter_count(svm: &MagicSVM, target: TransactionTarget, counter: &Address) -> u64 {
    let account = svm
        .get_account_for(target, counter)
        .expect("counter account missing");
    u64::from_le_bytes(account.data[8..16].try_into().unwrap())
}

fn initialize_tx(counter: Pubkey, payer: &Keypair, blockhash: solana_hash::Hash) -> Transaction {
    tx(
        payer,
        ix(
            instruction::Initialize {},
            accounts::Initialize {
                counter,
                authority: as_pubkey(&payer.pubkey()),
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn increment_tx(counter: Pubkey, payer: &Keypair, blockhash: solana_hash::Hash) -> Transaction {
    tx(
        payer,
        ix(instruction::Increment {}, accounts::Increment { counter }),
        blockhash,
    )
}

fn delegate_tx(
    counter: Pubkey,
    validator: Address,
    payer: &Keypair,
    blockhash: solana_hash::Hash,
) -> Transaction {
    tx(
        payer,
        ix(
            instruction::Delegate {},
            accounts::DelegateCounterPrivately {
                authority: as_pubkey(&payer.pubkey()),
                buffer_counter: delegate_buffer_pda_from_delegated_account_and_owner_program(
                    &counter,
                    &program_id(),
                ),
                delegation_record_counter: delegation_record_pda_from_delegated_account(&counter),
                delegation_metadata_counter: delegation_metadata_pda_from_delegated_account(
                    &counter,
                ),
                counter,
                validator: Some(as_pubkey(&validator)),
                owner_program: program_id(),
                delegation_program: DelegationProgram::id(),
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn permission_accounts(
    counter: Pubkey,
    permission: Pubkey,
    payer: &Keypair,
) -> accounts::PermissionContext {
    accounts::PermissionContext {
        authority: as_pubkey(&payer.pubkey()),
        counter,
        permission,
        permission_program: PERMISSION_PROGRAM_ID,
        ephemeral_vault: EPHEMERAL_VAULT_ID,
        magic_program: MAGIC_PROGRAM_ID,
    }
}

fn commit_like_tx(
    payer: &Keypair,
    data: impl InstructionData,
    accounts: impl ToAccountMetas,
    blockhash: solana_hash::Hash,
) -> Transaction {
    tx(payer, ix(data, accounts), blockhash)
}

#[test_log::test]
fn private_counter_permissioned_er_flow() {
    let payer = Keypair::new();
    let program = program_address();
    let mut svm = MagicSVM::new();
    svm.add_program_from_file(program, deploy_dir().join("private_counter.so"))
        .unwrap();
    svm.airdrop(&payer.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();

    let authority = as_pubkey(&payer.pubkey());
    let counter = counter_pda(&authority);
    let counter_address = as_address(counter);
    let permission = permission_pda(&counter);

    let base_hash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        initialize_tx(counter, &payer, base_hash),
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Base, &counter_address),
        0
    );

    let base_hash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        increment_tx(counter, &payer, base_hash),
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Base, &counter_address),
        1
    );

    let validator = svm.validator_identity();
    let base_hash = svm.latest_blockhash_for(TransactionTarget::Base);
    send(
        &mut svm,
        TransactionTarget::Base,
        delegate_tx(counter, validator, &payer, base_hash),
    );
    assert!(
        is_delegated(&svm, &counter_address),
        "counter is not delegated"
    );
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &counter_address)
            .is_some(),
        "delegated counter missing on ephemeral"
    );

    let permission_program = svm.get_account_for(
        TransactionTarget::Ephemeral,
        &as_address(PERMISSION_PROGRAM_ID),
    );
    eprintln!(
        "Permission program on ephemeral: {:?}",
        permission_program
            .as_ref()
            .map(|account| account.executable)
    );

    let ephemeral_hash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        tx(
            &payer,
            ix(
                instruction::InitPermission {},
                permission_accounts(counter, permission, &payer),
            ),
            ephemeral_hash,
        ),
    );
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &as_address(permission))
            .is_some(),
        "permission PDA was not created on ephemeral"
    );

    let ephemeral_hash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_tx(counter, &payer, ephemeral_hash),
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Ephemeral, &counter_address),
        2
    );

    for is_private in [true, false] {
        let ephemeral_hash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
        send(
            &mut svm,
            TransactionTarget::Ephemeral,
            tx(
                &payer,
                ix(
                    instruction::SetPrivacy { is_private },
                    permission_accounts(counter, permission, &payer),
                ),
                ephemeral_hash,
            ),
        );
    }

    let ephemeral_hash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        tx(
            &payer,
            ix(
                instruction::ClosePermission {},
                permission_accounts(counter, permission, &payer),
            ),
            ephemeral_hash,
        ),
    );

    let ephemeral_hash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        commit_like_tx(
            &payer,
            instruction::Commit {},
            accounts::IncrementAndCommit {
                payer: authority,
                counter,
                magic_program: MagicProgram::id(),
                magic_context: MAGIC_CONTEXT_ID,
            },
            ephemeral_hash,
        ),
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Base, &counter_address),
        2
    );

    let ephemeral_hash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        commit_like_tx(
            &payer,
            instruction::Undelegate {},
            accounts::UndelegateCounter {
                payer: authority,
                counter,
                magic_program: MagicProgram::id(),
                magic_context: MAGIC_CONTEXT_ID,
            },
            ephemeral_hash,
        ),
    );
    let undelegated = svm
        .get_account_for(TransactionTarget::Base, &counter_address)
        .expect("counter missing after undelegate");
    assert_eq!(undelegated.owner, program);
    assert_eq!(
        counter_count(&svm, TransactionTarget::Base, &counter_address),
        2
    );
}
