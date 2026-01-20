use solana_instruction::{AccountMeta, Instruction};
use solana_program_test::{tokio, ProgramTest};
use solana_signer::Signer;
use solana_transaction::Transaction;

mod utils;

#[tokio::test]
async fn initialize_counter() {
    let context = ProgramTest::new("pinocchio_counter", utils::PROGRAM, None)
        .start_with_context()
        .await;

    let initializer = context.payer.pubkey();
    let (counter_pda, _bump) = utils::counter_pda(utils::PROGRAM, initializer);

    let ix = Instruction {
        program_id: utils::PROGRAM,
        accounts: vec![
            AccountMeta::new(initializer, true),
            AccountMeta::new(counter_pda, false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
        data: utils::INITIALIZE_COUNTER.to_vec(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
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

    assert_eq!(account.owner, utils::PROGRAM);
    assert_eq!(account.data.len(), 8);
    assert_eq!(utils::read_counter(&account.data), 0);
}
