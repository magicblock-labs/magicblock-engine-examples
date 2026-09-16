use {
    dlp_api::{
        args::DelegateArgs,
        consts::DELEGATION_PROGRAM_ID,
        discriminator::DlpDiscriminator,
        pda::{DELEGATE_BUFFER_TAG, DELEGATION_METADATA_TAG, DELEGATION_RECORD_TAG},
    },
    ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID},
    magicsvm::{MagicSVM, TransactionTarget},
    solana_address::Address,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_system_interface::instruction::{allocate, assign},
    solana_transaction::Transaction,
    test_utils::send_ixs,
};

fn delegate_ix(
    payer: Address,
    delegated_account: Address,
    owner: Address,
    validator: Address,
) -> Instruction {
    let delegate_buffer =
        Address::find_program_address(&[DELEGATE_BUFFER_TAG, delegated_account.as_ref()], &owner).0;
    let delegation_record = Address::find_program_address(
        &[DELEGATION_RECORD_TAG, delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0;
    let delegation_metadata = Address::find_program_address(
        &[DELEGATION_METADATA_TAG, delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0;
    let args = DelegateArgs {
        commit_frequency_ms: u32::MAX,
        seeds: Vec::new(),
        validator: Some(validator.to_bytes().into()),
    };
    let mut data = DlpDiscriminator::Delegate.to_vec();
    data.extend_from_slice(&borsh::to_vec(&args).expect("serialize DelegateArgs"));

    Instruction {
        program_id: DELEGATION_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(delegated_account, true),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new(delegate_buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data,
    }
}

fn commit_ix(payer: Address, delegated_account: Address) -> Instruction {
    Instruction {
        program_id: MAGIC_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
            AccountMeta::new_readonly(delegated_account, false),
        ],
        data: vec![1, 0, 0, 0],
    }
}

fn commit_and_undelegate_ix(payer: Address, delegated_account: Address) -> Instruction {
    Instruction {
        program_id: MAGIC_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
            AccountMeta::new(delegated_account, false),
        ],
        data: vec![2, 0, 0, 0],
    }
}

#[test]
fn oncurve_assign_delegate_commit_undelegate() {
    let user = Keypair::new();
    let fee_payer = Keypair::new();
    let mut svm = MagicSVM::new();
    let validator = svm.validator_identity();

    svm.airdrop(&user.pubkey(), 2 * LAMPORTS_PER_SOL)
        .expect("user airdrop");
    svm.airdrop(&fee_payer.pubkey(), LAMPORTS_PER_SOL)
        .expect("fee payer airdrop");

    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&fee_payer, &user],
        &[
            assign(&user.pubkey(), &DELEGATION_PROGRAM_ID),
            delegate_ix(
                fee_payer.pubkey(),
                user.pubkey(),
                solana_sdk_ids::system_program::id(),
                validator,
            ),
        ],
        "delegate",
    );

    let base = svm
        .get_account(&user.pubkey())
        .expect("delegated account on base");
    assert_eq!(base.owner, DELEGATION_PROGRAM_ID);
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &user.pubkey())
            .is_some(),
        "delegated account missing on ephemeral"
    );

    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&fee_payer, &user],
        &[commit_ix(user.pubkey(), user.pubkey())],
        "commit",
    );

    assert!(
        svm.get_account(&user.pubkey()).is_some(),
        "committed account missing on base"
    );
    assert!(
        svm.get_account_for(TransactionTarget::Ephemeral, &user.pubkey())
            .is_some(),
        "committed account missing on ephemeral"
    );

    svm.expire_blockhash_for(TransactionTarget::Ephemeral);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&fee_payer, &user],
        &[commit_and_undelegate_ix(user.pubkey(), user.pubkey())],
        "commit-and-undelegate",
    );

    assert!(
        svm.get_account(&user.pubkey()).is_some(),
        "undelegated account missing on base"
    );

    svm.expire_blockhash_for(TransactionTarget::Ephemeral);
    let rejected = Transaction::new(
        &[&user, &fee_payer],
        Message::new(&[allocate(&user.pubkey(), 8)], Some(&fee_payer.pubkey())),
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    svm.send_transaction_to(TransactionTarget::Ephemeral, rejected)
        .expect_err("undelegated on-curve account must not stay writable on ephemeral");
}
