use ephemeral_rollups_pinocchio::acl::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_pinocchio::consts::DELEGATION_PROGRAM_ID;
use solana_instruction::{AccountMeta, Instruction};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};
use solana_program_test::{processor, tokio, ProgramTest};
use solana_signer::Signer;
use solana_transaction::Transaction;

mod utils;

#[tokio::test]
async fn delegate_counter() {
    let mut program_test = ProgramTest::new("pinocchio_counter", utils::PROGRAM, None);
    let delegation_program = Pubkey::new_from_array(*DELEGATION_PROGRAM_ID.as_array());
    let permission_program = Pubkey::new_from_array(*PERMISSION_PROGRAM_ID.as_array());
    program_test.prefer_bpf(false);
    program_test.add_program(
        "magicblock_delegation_program",
        delegation_program,
        processor!(delegate_stub),
    );
    program_test.add_program(
        "magicblock_permission_program",
        permission_program,
        processor!(permission_stub),
    );
    let context = program_test.start_with_context().await;

    let initializer = context.payer.pubkey();
    let (counter_pda, bump) = utils::counter_pda(utils::PROGRAM, initializer);
    let permission_pda = utils::permission_pda(counter_pda);
    let delegation_buffer = utils::delegation_buffer_pda(counter_pda);
    let delegation_record = utils::delegation_record_pda(counter_pda);
    let delegation_metadata = utils::delegation_metadata_pda(counter_pda);
    let validator = Pubkey::new_unique();

    let init_ix = Instruction {
        program_id: utils::PROGRAM,
        accounts: vec![
            AccountMeta::new(initializer, true),
            AccountMeta::new(counter_pda, false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
            AccountMeta::new_readonly(permission_program, false),
            AccountMeta::new(permission_pda, false),
            AccountMeta::new(delegation_buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new_readonly(delegation_program, false),
            AccountMeta::new_readonly(validator, false),
        ],
        data: utils::initialize_counter_ix_data(bump),
    };

    let delegate_ix = Instruction {
        program_id: utils::PROGRAM,
        accounts: vec![
            AccountMeta::new(initializer, true),
            AccountMeta::new(counter_pda, false),
            AccountMeta::new_readonly(utils::PROGRAM, false),
            AccountMeta::new(delegation_buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new_readonly(delegation_program, false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
            AccountMeta::new_readonly(validator, false),
        ],
        data: utils::delegate_counter_ix_data(bump),
    };

    let tx = Transaction::new_signed_with_payer(
        &[init_ix, delegate_ix],
        Some(&initializer),
        &[&context.payer],
        context.last_blockhash,
    );
    context.banks_client.process_transaction(tx).await.unwrap();

    let counter_account = context
        .banks_client
        .get_account(counter_pda)
        .await
        .unwrap()
        .expect("counter account must exist");

    assert_eq!(counter_account.owner, delegation_program);
    assert_eq!(counter_account.data.len(), 8);
    assert!(counter_account.data.iter().all(|byte| *byte == 0));
}

fn delegate_stub(_program_id: &Pubkey, _accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    Ok(())
}

fn permission_stub(_program_id: &Pubkey, _accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    Ok(())
}
