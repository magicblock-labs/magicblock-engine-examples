use {
    anchor_lang::{
        prelude::Pubkey, system_program, Discriminator, Id, InstructionData, ToAccountMetas,
    },
    ephemeral_account_chats::{self, accounts, instruction, Conversation},
    ephemeral_rollups_sdk::{
        anchor::{DelegationProgram, MagicProgram},
        consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID},
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account,
        },
    },
    magicsvm::{MagicSVM, TransactionTarget},
    solana_address::Address,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::path::PathBuf,
    test_utils::{
        as_address, as_pubkey, client_ix, program_id_from_idl, program_so_path, send_ixs,
    },
};

const MAX_MESSAGE_COUNT: u32 = 5;

fn conversation_size(message_count: u32) -> usize {
    8 + Conversation::space_for_message_count(message_count as usize)
}

fn program_so() -> PathBuf {
    program_so_path(env!("CARGO_MANIFEST_DIR"), "ephemeral_account_chats")
}

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "ephemeral_account_chats.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn profile_pda(handle: &str) -> Pubkey {
    Pubkey::find_program_address(&[b"profile", handle.as_bytes()], &program_id()).0
}

fn conversation_pda(handle_owner: &str, handle_other: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"conversation",
            handle_owner.as_bytes(),
            handle_other.as_bytes(),
        ],
        &program_id(),
    )
    .0
}

fn send(svm: &mut MagicSVM, target: TransactionTarget, ix: Instruction, signers: &[&Keypair]) {
    send_ixs(svm, target, signers, &[ix], "transaction");
}

fn create_profile_ix(authority: Pubkey, profile: Pubkey, handle: &str) -> Instruction {
    ix(
        instruction::CreateProfile {
            handle: handle.to_string(),
        },
        accounts::CreateProfile {
            authority,
            profile,
            system_program: system_program::ID,
        },
    )
}

fn top_up_profile_ix(authority: Pubkey, profile: Pubkey, lamports: u64) -> Instruction {
    ix(
        instruction::TopUpProfile { lamports },
        accounts::TopUpProfile {
            authority,
            profile,
            system_program: system_program::ID,
        },
    )
}

fn delegate_profile_ix(authority: Pubkey, profile: Pubkey, validator: Pubkey) -> Instruction {
    ix(
        instruction::DelegateProfile {
            validator: Some(validator),
        },
        accounts::DelegateProfile {
            authority,
            buffer_profile: delegate_buffer_pda_from_delegated_account_and_owner_program(
                &profile,
                &program_id(),
            ),
            delegation_record_profile: delegation_record_pda_from_delegated_account(&profile),
            delegation_metadata_profile: delegation_metadata_pda_from_delegated_account(&profile),
            profile,
            owner_program: program_id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    )
}

fn create_conversation_ix(
    authority: Pubkey,
    profile_owner: Pubkey,
    profile_other: Pubkey,
    conversation: Pubkey,
) -> Instruction {
    ix(
        instruction::CreateConversation {},
        accounts::CreateConversation {
            authority,
            profile_owner,
            profile_other,
            conversation,
            vault: EPHEMERAL_VAULT_ID,
            magic_program: MagicProgram::id(),
        },
    )
}

fn extend_conversation_ix(
    authority: Pubkey,
    profile_sender: Pubkey,
    profile_other: Pubkey,
    conversation: Pubkey,
    additional_messages: u32,
) -> Instruction {
    ix(
        instruction::ExtendConversation {
            additional_messages,
        },
        accounts::ExtendConversation {
            authority,
            profile_sender,
            profile_other,
            conversation,
            vault: EPHEMERAL_VAULT_ID,
            magic_program: MagicProgram::id(),
        },
    )
}

fn append_message_ix(
    authority: Pubkey,
    profile_owner: Pubkey,
    profile_other: Pubkey,
    conversation: Pubkey,
    body: &str,
) -> Instruction {
    ix(
        instruction::AppendMessage {
            body: body.to_string(),
        },
        accounts::AppendMessage {
            authority,
            profile_owner,
            profile_other,
            conversation,
        },
    )
}

fn close_conversation_ix(
    authority: Pubkey,
    profile_owner: Pubkey,
    profile_other: Pubkey,
    conversation: Pubkey,
) -> Instruction {
    ix(
        instruction::CloseConversation {},
        accounts::CloseConversation {
            authority,
            profile_owner,
            profile_other,
            conversation,
            vault: EPHEMERAL_VAULT_ID,
            magic_program: MagicProgram::id(),
        },
    )
}

fn undelegate_profile_ix(authority: Pubkey, profile: Pubkey) -> Instruction {
    ix(
        instruction::UndelegateProfile {},
        accounts::UndelegateProfile {
            authority,
            profile,
            magic_program: MagicProgram::id(),
            magic_context: MAGIC_CONTEXT_ID,
        },
    )
}

fn close_profile_ix(authority: Pubkey, profile: Pubkey) -> Instruction {
    ix(
        instruction::CloseProfile {},
        accounts::CloseProfile { authority, profile },
    )
}

fn decode_handle(data: &[u8]) -> String {
    let start = 8 + 32 + 1 + 8;
    let len = u32::from_le_bytes(data[start..start + 4].try_into().unwrap()) as usize;
    String::from_utf8(data[start + 4..start + 4 + len].to_vec()).unwrap()
}

fn conversation_message_count(data: &[u8]) -> usize {
    let mut offset = 8;
    let owner_len = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4 + owner_len;
    let other_len = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4 + other_len + 1;
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize
}

#[test]
fn ephemeral_account_chats_profiles_conversation_messages_commit() {
    let user_a = Keypair::new();
    let user_b = Keypair::new();
    let name_a = "0000000001";
    let name_b = "0000000002";
    let profile_a = profile_pda(name_a);
    let profile_b = profile_pda(name_b);
    let conversation = conversation_pda(name_a, name_b);
    let profile_a_address = as_address(profile_a);
    let profile_b_address = as_address(profile_b);
    let conversation_address = as_address(conversation);

    let mut svm = MagicSVM::new();
    svm.add_program_from_file(program_address(), program_so())
        .unwrap();
    svm.airdrop(&user_a.pubkey(), LAMPORTS_PER_SOL).unwrap();
    svm.airdrop(&user_b.pubkey(), LAMPORTS_PER_SOL).unwrap();
    let validator = as_pubkey(&svm.validator_identity());
    let user_a_pk = as_pubkey(&user_a.pubkey());
    let user_b_pk = as_pubkey(&user_b.pubkey());

    send(
        &mut svm,
        TransactionTarget::Base,
        create_profile_ix(user_a_pk, profile_a, name_a),
        &[&user_a],
    );
    send(
        &mut svm,
        TransactionTarget::Base,
        create_profile_ix(user_b_pk, profile_b, name_b),
        &[&user_b],
    );
    assert_eq!(
        decode_handle(&svm.get_account(&profile_a_address).unwrap().data),
        name_a
    );
    assert_eq!(
        decode_handle(&svm.get_account(&profile_b_address).unwrap().data),
        name_b
    );

    let profile_a_lamports_before = svm.get_account(&profile_a_address).unwrap().lamports;
    send(
        &mut svm,
        TransactionTarget::Base,
        top_up_profile_ix(
            user_a_pk,
            profile_a,
            (0.05 * LAMPORTS_PER_SOL as f64) as u64,
        ),
        &[&user_a],
    );
    assert_eq!(
        svm.get_account(&profile_a_address).unwrap().lamports,
        (0.05 * LAMPORTS_PER_SOL as f64) as u64 + profile_a_lamports_before
    );

    send(
        &mut svm,
        TransactionTarget::Base,
        delegate_profile_ix(user_a_pk, profile_a, validator),
        &[&user_a],
    );
    send(
        &mut svm,
        TransactionTarget::Base,
        delegate_profile_ix(user_b_pk, profile_b, validator),
        &[&user_b],
    );
    assert_eq!(
        svm.get_account(&profile_a_address).unwrap().owner,
        as_address(DelegationProgram::id())
    );
    assert_eq!(
        svm.get_account(&profile_b_address).unwrap().owner,
        as_address(DelegationProgram::id())
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        create_conversation_ix(user_a_pk, profile_a, profile_b, conversation),
        &[&user_a],
    );
    let conversation_account = svm
        .get_account_for(TransactionTarget::Ephemeral, &conversation_address)
        .expect("conversation should exist on ephemeral");
    assert_eq!(
        conversation_account.data.get(..8),
        Some(Conversation::DISCRIMINATOR),
        "createConversation must persist a Conversation discriminator, got {:02x?}",
        conversation_account
            .data
            .get(..16)
            .unwrap_or(conversation_account.data.as_slice())
    );
    assert_eq!(conversation_message_count(&conversation_account.data), 0);
    assert_eq!(conversation_account.data.len(), conversation_size(0));

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        extend_conversation_ix(
            user_a_pk,
            profile_a,
            profile_b,
            conversation,
            MAX_MESSAGE_COUNT,
        ),
        &[&user_a],
    );
    assert_eq!(
        svm.get_account_for(TransactionTarget::Ephemeral, &conversation_address)
            .unwrap()
            .data
            .len(),
        conversation_size(MAX_MESSAGE_COUNT)
    );

    for i in 0..MAX_MESSAGE_COUNT {
        let (payer, authority, body) = if i % 2 == 0 {
            (&user_a, user_a_pk, format!("Hello {i} from user A!"))
        } else {
            (&user_b, user_b_pk, format!("Hello {i} from user B!"))
        };
        send(
            &mut svm,
            TransactionTarget::Ephemeral,
            append_message_ix(authority, profile_a, profile_b, conversation, &body),
            &[payer],
        );
    }
    assert_eq!(
        conversation_message_count(
            &svm.get_account_for(TransactionTarget::Ephemeral, &conversation_address)
                .unwrap()
                .data
        ),
        MAX_MESSAGE_COUNT as usize
    );

    let overflow = Transaction::new(
        &[&user_a],
        Message::new(
            &[append_message_ix(
                user_a_pk,
                profile_a,
                profile_b,
                conversation,
                "Hello world, appending another message, this should be failed!",
            )],
            Some(&user_a.pubkey()),
        ),
        svm.latest_blockhash_for(TransactionTarget::Ephemeral),
    );
    let failed = svm
        .send_transaction_to(TransactionTarget::Ephemeral, overflow)
        .expect_err("the conversation should have been full");
    assert!(
        failed.meta.logs.iter().any(|log| {
            log.contains("ConversationCapacityExceeded")
                || log.contains(
                    "The conversation does not have enough allocated capacity for another message.",
                )
        }),
        "missing capacity error in logs: {:#?}",
        failed.meta.logs
    );
    svm.expire_blockhash_for(TransactionTarget::Ephemeral);

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        close_conversation_ix(user_a_pk, profile_a, profile_b, conversation),
        &[&user_a],
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        undelegate_profile_ix(user_a_pk, profile_a),
        &[&user_a],
    );
    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        undelegate_profile_ix(user_b_pk, profile_b),
        &[&user_b],
    );
    assert_eq!(
        svm.get_account(&profile_a_address).unwrap().owner,
        program_address()
    );
    assert_eq!(
        svm.get_account(&profile_b_address).unwrap().owner,
        program_address()
    );

    send(
        &mut svm,
        TransactionTarget::Base,
        close_profile_ix(user_a_pk, profile_a),
        &[&user_a],
    );
    send(
        &mut svm,
        TransactionTarget::Base,
        close_profile_ix(user_b_pk, profile_b),
        &[&user_b],
    );
    assert!(svm
        .get_account(&profile_a_address)
        .is_none_or(|account| account.lamports == 0 && account.data.is_empty()));
    assert!(svm
        .get_account(&profile_b_address)
        .is_none_or(|account| account.lamports == 0 && account.data.is_empty()));
}
