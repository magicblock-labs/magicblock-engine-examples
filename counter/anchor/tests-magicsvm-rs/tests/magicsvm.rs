use {
    anchor_lang::{prelude::Pubkey, system_program, Id, InstructionData},
    magicsvm::TransactionTarget,
    public_counter::{self, accounts, instruction, COUNTER_SEED},
    solana_address::Address,
    solana_hash::Hash,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    test_utils::{
        account_owner, account_u64, as_address, as_pubkey, boot, client_ix,
        delegate_buffer_pda_from_delegated_account_and_owner_program,
        delegation_metadata_pda_from_delegated_account,
        delegation_record_pda_from_delegated_account, is_delegated, program_id_from_idl, send_tx,
        sign_tx, DelegationProgram, MagicProgram, MAGIC_CONTEXT_ID,
    },
};

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "public_counter.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn signed(payer: &Keypair, instruction: Instruction, blockhash: Hash) -> Transaction {
    sign_tx(&[payer], &[instruction], blockhash)
}

fn ix(
    data: impl anchor_lang::InstructionData,
    accounts: impl anchor_lang::ToAccountMetas,
) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn initialize_tx(counter: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    signed(
        payer,
        ix(
            instruction::Initialize {},
            accounts::Initialize {
                counter,
                user: as_pubkey(&payer.pubkey()),
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn increment_tx(counter: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    signed(
        payer,
        ix(instruction::Increment {}, accounts::Increment { counter }),
        blockhash,
    )
}

fn delegate_tx(
    counter: Pubkey,
    payer: &Keypair,
    validator: Address,
    blockhash: Hash,
) -> Transaction {
    let mut instruction = ix(
        instruction::Delegate {},
        accounts::DelegateInput {
            payer: as_pubkey(&payer.pubkey()),
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
    signed(payer, instruction, blockhash)
}

fn commit_style_tx(
    counter: Pubkey,
    payer: &Keypair,
    data: impl InstructionData,
    blockhash: Hash,
) -> Transaction {
    signed(
        payer,
        ix(
            data,
            accounts::IncrementAndCommit {
                payer: as_pubkey(&payer.pubkey()),
                counter,
                magic_program: MagicProgram::id(),
                magic_context: MAGIC_CONTEXT_ID,
            },
        ),
        blockhash,
    )
}

#[test]
fn public_counter_local_er_flow() {
    let payer = Keypair::new();
    let mut svm = boot(
        env!("CARGO_MANIFEST_DIR"),
        "public_counter",
        program_address(),
        &payer,
        2 * LAMPORTS_PER_SOL,
    );
    let (counter, _) = Pubkey::find_program_address(&[COUNTER_SEED], &program_id());
    let counter_address = as_address(counter);
    let program_id = program_address();

    let initialize = initialize_tx(
        counter,
        &payer,
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    send_tx(&mut svm, TransactionTarget::Base, initialize, "initialize");
    assert_eq!(
        account_u64(&svm, TransactionTarget::Base, &counter_address, 8),
        0
    );

    let increment_base = increment_tx(
        counter,
        &payer,
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    send_tx(
        &mut svm,
        TransactionTarget::Base,
        increment_base,
        "increment (base)",
    );
    assert_eq!(
        account_u64(&svm, TransactionTarget::Base, &counter_address, 8),
        1
    );

    let validator = svm.validator_identity();
    let delegate = delegate_tx(
        counter,
        &payer,
        validator,
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    send_tx(&mut svm, TransactionTarget::Base, delegate, "delegate");
    assert!(is_delegated(&svm, &counter_address));

    let increment_er = increment_tx(
        counter,
        &payer,
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send_tx(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_er,
        "increment (ER)",
    );
    assert_eq!(
        account_u64(&svm, TransactionTarget::Ephemeral, &counter_address, 8),
        2
    );

    let commit = commit_style_tx(
        counter,
        &payer,
        instruction::Commit {},
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send_tx(&mut svm, TransactionTarget::Ephemeral, commit, "commit");
    assert_eq!(
        account_u64(&svm, TransactionTarget::Base, &counter_address, 8),
        2
    );
    assert!(is_delegated(&svm, &counter_address));

    let increment_and_commit = commit_style_tx(
        counter,
        &payer,
        instruction::IncrementAndCommit {},
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send_tx(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_and_commit,
        "incrementAndCommit",
    );
    assert_eq!(
        account_u64(&svm, TransactionTarget::Ephemeral, &counter_address, 8),
        3
    );
    assert_eq!(
        account_u64(&svm, TransactionTarget::Base, &counter_address, 8),
        3
    );

    let increment_and_undelegate = commit_style_tx(
        counter,
        &payer,
        instruction::IncrementAndUndelegate {},
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    send_tx(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_and_undelegate,
        "incrementAndUndelegate",
    );
    assert_eq!(
        account_u64(&svm, TransactionTarget::Base, &counter_address, 8),
        4
    );
    assert_eq!(
        account_owner(&svm, TransactionTarget::Base, &counter_address),
        program_id
    );
}
