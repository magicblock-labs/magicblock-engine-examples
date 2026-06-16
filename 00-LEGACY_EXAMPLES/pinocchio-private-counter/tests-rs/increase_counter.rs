use ephemeral_rollups_pinocchio::consts::DELEGATION_PROGRAM_ID;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_test::{tokio, ProgramTest};
use solana_signer::Signer;
use solana_transaction::Transaction;

mod utils;

#[tokio::test]
async fn increase_counter() {
    let context = ProgramTest::new("pinocchio_counter", utils::PROGRAM, None)
        .start_with_context()
        .await;

    let initializer = context.payer.pubkey();
    let (counter_pda, bump) = utils::counter_pda(utils::PROGRAM, initializer);
    let permission_pda = utils::permission_pda(counter_pda);
    let delegation_buffer = utils::delegation_buffer_pda(counter_pda);
    let delegation_record = utils::delegation_record_pda(counter_pda);
    let delegation_metadata = utils::delegation_metadata_pda(counter_pda);
    let delegation_program = solana_pubkey::Pubkey::new_from_array(*DELEGATION_PROGRAM_ID.as_array());
    let validator = solana_pubkey::Pubkey::new_unique();

    let init_ix = Instruction {
        program_id: utils::PROGRAM,
        accounts: vec![
            AccountMeta::new(initializer, true),
            AccountMeta::new(counter_pda, false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
            AccountMeta::new_readonly(utils::permission_program(), false),
            AccountMeta::new(permission_pda, false),
            AccountMeta::new(delegation_buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new_readonly(delegation_program, false),
            AccountMeta::new_readonly(validator, false),
        ],
        data: utils::initialize_counter_ix_data(bump),
    };

    let increase_amount: u64 = 3;
    let data = utils::increase_counter_ix_data(bump, increase_amount);
    let increase_ix = Instruction {
        program_id: utils::PROGRAM,
        accounts: vec![
            AccountMeta::new(initializer, true),
            AccountMeta::new(counter_pda, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(
        &[init_ix, increase_ix],
        Some(&initializer),
        &[&context.payer],
        context.last_blockhash,
    );
    context.banks_client.process_transaction(tx).await.unwrap();

    let account = context
        .banks_client
        .get_account(counter_pda)
        .await
        .unwrap()
        .expect("counter account must exist");

    assert_eq!(utils::read_counter(&account.data), increase_amount);
}
