use {
    anchor_lang::{prelude::Pubkey, system_program, Id, InstructionData, ToAccountMetas},
    delegation_actions::{self, accounts, instruction, COUNTER_SEED},
    magicsvm::TransactionTarget,
    solana_address::Address,
    solana_hash::Hash,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    test_utils::{
        as_address, as_pubkey, boot, client_ix,
        delegate_buffer_pda_from_delegated_account_and_owner_program,
        delegation_metadata_pda_from_delegated_account,
        delegation_record_pda_from_delegated_account, is_delegated, program_id_from_idl,
        read_u64_le, send_tx, sign_tx, DelegationProgram, MagicProgram, MAGIC_CONTEXT_ID,
    },
};

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "delegation_actions.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn signed(payer: &Keypair, instruction: Instruction, blockhash: Hash) -> Transaction {
    sign_tx(&[payer], &[instruction], blockhash)
}

fn counter_pda() -> Pubkey {
    Pubkey::find_program_address(&[COUNTER_SEED], &program_id()).0
}

fn counter_count(
    svm: &magicsvm::MagicSVM,
    target: TransactionTarget,
    pda: &Address,
) -> Option<u64> {
    svm.get_account_for(target, pda)
        .map(|account| read_u64_le(&account.data, 8))
}

fn initialize_tx(pda: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    signed(
        payer,
        ix(
            instruction::Initialize {},
            accounts::Initialize {
                counter: pda,
                user: as_pubkey(&payer.pubkey()),
                system_program: system_program::ID,
            },
        ),
        blockhash,
    )
}

fn increment_tx(pda: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    signed(
        payer,
        ix(
            instruction::Increment {},
            accounts::Increment { counter: pda },
        ),
        blockhash,
    )
}

fn delegate_with_actions_tx(
    pda: Pubkey,
    payer: &Keypair,
    validator: Address,
    blockhash: Hash,
) -> Transaction {
    let mut instruction = ix(
        instruction::DelegateWithActions {},
        accounts::DelegateCounter {
            payer: as_pubkey(&payer.pubkey()),
            buffer_pda: delegate_buffer_pda_from_delegated_account_and_owner_program(
                &pda,
                &program_id(),
            ),
            delegation_record_pda: delegation_record_pda_from_delegated_account(&pda),
            delegation_metadata_pda: delegation_metadata_pda_from_delegated_account(&pda),
            pda,
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

fn undelegate_tx(pda: Pubkey, payer: &Keypair, blockhash: Hash) -> Transaction {
    signed(
        payer,
        ix(
            instruction::Undelegate {},
            accounts::UndelegateCounter {
                payer: as_pubkey(&payer.pubkey()),
                counter: pda,
                magic_program: MagicProgram::id(),
                magic_context: MAGIC_CONTEXT_ID,
            },
        ),
        blockhash,
    )
}

#[test]
fn delegation_actions_run_automatically_after_delegate() {
    let payer = Keypair::new();
    let pda = counter_pda();
    let pda_address = as_address(pda);
    let mut svm = boot(
        env!("CARGO_MANIFEST_DIR"),
        "delegation_actions",
        program_address(),
        &payer,
        2 * LAMPORTS_PER_SOL,
    );

    let init_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send_tx(
        &mut svm,
        TransactionTarget::Base,
        initialize_tx(pda, &payer, init_blockhash),
        "initialize",
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Base, &pda_address),
        Some(0),
        "counter should initialize to 0"
    );

    let increment_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send_tx(
        &mut svm,
        TransactionTarget::Base,
        increment_tx(pda, &payer, increment_blockhash),
        "increment",
    );
    let before = counter_count(&svm, TransactionTarget::Base, &pda_address).expect("base counter");
    assert_eq!(before, 1, "base increment should set count to 1");

    let validator = svm.validator_identity();
    let delegate_blockhash = svm.latest_blockhash_for(TransactionTarget::Base);
    send_tx(
        &mut svm,
        TransactionTarget::Base,
        delegate_with_actions_tx(pda, &payer, validator, delegate_blockhash),
        "delegate",
    );

    let after = counter_count(&svm, TransactionTarget::Ephemeral, &pda_address);
    assert_eq!(
        after,
        Some(before + 1),
        "post-delegation action did not run: expected {} in ER, got {:?}",
        before + 1,
        after
    );
    assert!(
        is_delegated(&svm, &pda_address),
        "counter should be owned by the delegation program after delegate"
    );

    let er_increment_blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send_tx(
        &mut svm,
        TransactionTarget::Ephemeral,
        increment_tx(pda, &payer, er_increment_blockhash),
        "increment (ER)",
    );
    assert_eq!(
        counter_count(&svm, TransactionTarget::Ephemeral, &pda_address),
        Some(before + 2)
    );

    let undelegate_blockhash = svm.latest_blockhash_for(TransactionTarget::Ephemeral);
    send_tx(
        &mut svm,
        TransactionTarget::Ephemeral,
        undelegate_tx(pda, &payer, undelegate_blockhash),
        "undelegate",
    );
    assert!(
        !is_delegated(&svm, &pda_address),
        "counter should return to the program after undelegate"
    );
}
