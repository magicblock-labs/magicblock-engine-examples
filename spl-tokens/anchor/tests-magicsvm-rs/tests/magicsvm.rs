use {
    anchor_lang::{InstructionData, ToAccountMetas},
    ephemeral_rollups_sdk::{
        consts::{ASSOCIATED_TOKEN_PROGRAM_ID, ESPL_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID},
        spl::{
            builders::{
                DelegateEphemeralAtaBuilder, DepositSplTokensBuilder,
                InitializeEphemeralAtaBuilder, InitializeGlobalVaultBuilder,
                UndelegateEphemeralAtaBuilder,
            },
            find_rent_pda, find_vault_ata, EphemeralAta, GlobalVault,
        },
    },
    magicsvm::{MagicSVM, TransactionTarget},
    solana_address::Address,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    spl_tokens::{self, accounts, instruction},
    std::path::PathBuf,
    test_utils::{as_pubkey, program_id_from_idl, send_ixs},
};

const TOKEN_AMOUNT: u64 = 1000;
const MINT_SIZE: u64 = 82;

fn program_address() -> Address {
    program_id_from_idl(env!("CARGO_MANIFEST_DIR"), "spl_tokens.json")
}

fn program_so_path() -> PathBuf {
    test_utils::program_so_path(env!("CARGO_MANIFEST_DIR"), "spl_tokens")
}

fn send(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    ixs: &[Instruction],
    payer: &Keypair,
    extra_signers: &[&Keypair],
    label: &str,
) {
    let mut signers = Vec::with_capacity(1 + extra_signers.len());
    signers.push(payer);
    signers.extend_from_slice(extra_signers);
    send_ixs(svm, target, &signers, ixs, label);
}

fn derive_ata(owner: &Address, mint: &Address) -> Address {
    Address::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

fn token_amount(svm: &MagicSVM, target: TransactionTarget, ata: &Address) -> u64 {
    let account = svm
        .get_account_for(target, ata)
        .unwrap_or_else(|| panic!("missing token account {ata} on {target:?}"));
    u64::from_le_bytes(account.data[64..72].try_into().unwrap())
}

fn initialize_mint_ix(mint: Address, authority: Address) -> Instruction {
    let mut data = vec![0u8, 0];
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(&[0u8; 4]);
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(mint, false),
            AccountMeta::new_readonly(solana_sdk_ids::sysvar::rent::id(), false),
        ],
        data,
    }
}

fn create_ata_ix(payer: Address, ata: Address, owner: Address, mint: Address) -> Instruction {
    Instruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(ata, false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(solana_sdk_ids::sysvar::rent::id(), false),
        ],
        data: vec![],
    }
}

fn create_ata_idempotent_ix(
    payer: Address,
    ata: Address,
    owner: Address,
    mint: Address,
) -> Instruction {
    Instruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(ata, false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data: vec![1],
    }
}

fn mint_to_ix(mint: Address, dest: Address, authority: Address, amount: u64) -> Instruction {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(mint, false),
            AccountMeta::new(dest, false),
            AccountMeta::new_readonly(authority, true),
        ],
        data,
    }
}

fn spl_transfer_ix(source: Address, dest: Address, owner: Address, amount: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(source, false),
            AccountMeta::new(dest, false),
            AccountMeta::new_readonly(owner, true),
        ],
        data,
    }
}

fn program_transfer_ix(payer: Address, from: Address, to: Address, amount: u64) -> Instruction {
    Instruction {
        program_id: program_address(),
        accounts: accounts::TransferTokens {
            payer: as_pubkey(&payer),
            from: as_pubkey(&from),
            to: as_pubkey(&to),
            token_program: as_pubkey(&TOKEN_PROGRAM_ID),
        }
        .to_account_metas(None)
        .into_iter()
        .map(|meta| AccountMeta {
            pubkey: Address::new_from_array(meta.pubkey.to_bytes()),
            is_signer: meta.is_signer,
            is_writable: meta.is_writable,
        })
        .collect(),
        data: instruction::Transfer { amount }.data(),
    }
}

/// Legacy withdraw account order from TS SDK 0.16.2 `withdrawSplIx`.
fn withdraw_spl_ix(owner: Address, mint: Address, amount: u64) -> Instruction {
    let (eata, _) = EphemeralAta::find_pda(&owner, &mint);
    let (vault, _) = GlobalVault::find_pda(&mint);
    let vault_ata = find_vault_ata(&mint, &vault);
    let user_ata = derive_ata(&owner, &mint);
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ESPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new(eata, false),
            AccountMeta::new_readonly(vault, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new(user_ata, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data,
    }
}

fn delegate_spl_ixs(
    payer: Address,
    owner: Address,
    mint: Address,
    amount: u64,
    validator: Address,
    init_vault_if_missing: bool,
) -> Vec<Instruction> {
    let mut ixs = vec![InitializeEphemeralAtaBuilder {
        payer,
        user: owner,
        mint,
    }
    .instruction()];
    if init_vault_if_missing {
        let (vault, _) = GlobalVault::find_pda(&mint);
        let vault_ata = find_vault_ata(&mint, &vault);
        ixs.push(InitializeGlobalVaultBuilder { payer, mint }.instruction());
        ixs.push(create_ata_idempotent_ix(payer, vault_ata, vault, mint));
        ixs.push(
            DelegateEphemeralAtaBuilder {
                payer,
                user: vault,
                mint,
                validator: Some(validator),
            }
            .instruction(),
        );
    }
    ixs.push(
        DepositSplTokensBuilder {
            authority: owner,
            user: owner,
            mint,
            amount,
        }
        .instruction(),
    );
    ixs.push(
        DelegateEphemeralAtaBuilder {
            payer,
            user: owner,
            mint,
            validator: Some(validator),
        }
        .instruction(),
    );
    ixs
}

struct MintSetup {
    mint: Keypair,
    owner1: Keypair,
    owner2: Keypair,
    ata1: Address,
    ata2: Address,
}

fn setup_mint_with_recipients(svm: &mut MagicSVM, admin: &Keypair) -> MintSetup {
    let mint = Keypair::new();
    let owner1 = Keypair::new();
    let owner2 = Keypair::new();
    let (sponsor_pda, _) = find_rent_pda();

    send(
        svm,
        TransactionTarget::Base,
        &[
            system_instruction::transfer(&admin.pubkey(), &owner1.pubkey(), LAMPORTS_PER_SOL / 5),
            system_instruction::transfer(&admin.pubkey(), &owner2.pubkey(), LAMPORTS_PER_SOL / 5),
            system_instruction::transfer(&admin.pubkey(), &sponsor_pda, LAMPORTS_PER_SOL / 5),
        ],
        admin,
        &[],
        "fund recipients",
    );

    let ata1 = derive_ata(&owner1.pubkey(), &mint.pubkey());
    let ata2 = derive_ata(&owner2.pubkey(), &mint.pubkey());
    let mint_lamports = svm.minimum_balance_for_rent_exemption(MINT_SIZE as usize);

    send(
        svm,
        TransactionTarget::Base,
        &[
            system_instruction::create_account(
                &admin.pubkey(),
                &mint.pubkey(),
                mint_lamports,
                MINT_SIZE,
                &TOKEN_PROGRAM_ID,
            ),
            initialize_mint_ix(mint.pubkey(), admin.pubkey()),
            create_ata_ix(admin.pubkey(), ata1, owner1.pubkey(), mint.pubkey()),
            create_ata_ix(admin.pubkey(), ata2, owner2.pubkey(), mint.pubkey()),
            mint_to_ix(mint.pubkey(), ata1, admin.pubkey(), TOKEN_AMOUNT),
            mint_to_ix(mint.pubkey(), ata2, admin.pubkey(), TOKEN_AMOUNT),
        ],
        admin,
        &[&mint],
        "create mint and ATAs",
    );

    assert_eq!(
        token_amount(svm, TransactionTarget::Base, &ata1),
        TOKEN_AMOUNT
    );
    assert_eq!(
        token_amount(svm, TransactionTarget::Base, &ata2),
        TOKEN_AMOUNT
    );

    MintSetup {
        mint,
        owner1,
        owner2,
        ata1,
        ata2,
    }
}

fn new_svm() -> (MagicSVM, Keypair) {
    let admin = Keypair::new();
    let mut svm = MagicSVM::new();
    svm.add_program_from_file(program_address(), program_so_path())
        .unwrap();
    svm.airdrop(&admin.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
    (svm, admin)
}

#[test]
fn delegate_spl_tokens_transfer_and_undelegate() {
    let (mut svm, admin) = new_svm();
    let validator = svm.validator_identity();
    let setup = setup_mint_with_recipients(&mut svm, &admin);
    let mint = setup.mint.pubkey();

    assert_eq!(
        token_amount(&svm, TransactionTarget::Base, &setup.ata1),
        1000
    );
    assert_eq!(
        token_amount(&svm, TransactionTarget::Base, &setup.ata2),
        1000
    );

    send(
        &mut svm,
        TransactionTarget::Base,
        &delegate_spl_ixs(
            admin.pubkey(),
            setup.owner1.pubkey(),
            mint,
            50,
            validator,
            true,
        ),
        &admin,
        &[&setup.owner1],
        "delegate owner1",
    );
    send(
        &mut svm,
        TransactionTarget::Base,
        &delegate_spl_ixs(
            admin.pubkey(),
            setup.owner2.pubkey(),
            mint,
            10,
            validator,
            false,
        ),
        &admin,
        &[&setup.owner2],
        "delegate owner2",
    );

    assert_eq!(
        token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata1),
        50
    );
    assert_eq!(
        token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata2),
        10
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[spl_transfer_ix(
            setup.ata1,
            setup.ata2,
            setup.owner1.pubkey(),
            2,
        )],
        &setup.owner1,
        &[],
        "ER transfer",
    );

    let acct_a = token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata1);
    let acct_b = token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata2);
    assert_eq!(acct_a, 48);
    assert_eq!(acct_b, 12);

    for owner in [&setup.owner1, &setup.owner2] {
        send(
            &mut svm,
            TransactionTarget::Ephemeral,
            &[UndelegateEphemeralAtaBuilder {
                payer: owner.pubkey(),
                user: owner.pubkey(),
                mint,
            }
            .instruction()],
            owner,
            &[],
            "undelegate",
        );
    }

    for owner in [&setup.owner1, &setup.owner2] {
        let (eata, _) = EphemeralAta::find_pda(&owner.pubkey(), &mint);
        let account = svm
            .get_account(&eata)
            .unwrap_or_else(|| panic!("missing eata {eata}"));
        assert_eq!(account.owner, ESPL_TOKEN_PROGRAM_ID);
    }

    send(
        &mut svm,
        TransactionTarget::Base,
        &[
            withdraw_spl_ix(setup.owner1.pubkey(), mint, acct_a),
            withdraw_spl_ix(setup.owner2.pubkey(), mint, acct_b),
        ],
        &admin,
        &[&setup.owner1, &setup.owner2],
        "withdraw",
    );

    assert_eq!(
        token_amount(&svm, TransactionTarget::Base, &setup.ata1),
        998
    );
    assert_eq!(
        token_amount(&svm, TransactionTarget::Base, &setup.ata2),
        1002
    );
}

#[test]
fn delegate_spl_tokens_and_transfer_through_program() {
    let (mut svm, admin) = new_svm();
    let validator = svm.validator_identity();
    let setup = setup_mint_with_recipients(&mut svm, &admin);
    let mint = setup.mint.pubkey();

    send(
        &mut svm,
        TransactionTarget::Base,
        &delegate_spl_ixs(
            admin.pubkey(),
            setup.owner1.pubkey(),
            mint,
            10,
            validator,
            true,
        ),
        &admin,
        &[&setup.owner1],
        "delegate sender",
    );
    send(
        &mut svm,
        TransactionTarget::Base,
        &delegate_spl_ixs(
            admin.pubkey(),
            setup.owner2.pubkey(),
            mint,
            10,
            validator,
            false,
        ),
        &admin,
        &[&setup.owner2],
        "delegate receiver",
    );

    assert_eq!(
        token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata1),
        10
    );
    assert_eq!(
        token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata2),
        10
    );

    send(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[program_transfer_ix(
            setup.owner1.pubkey(),
            setup.ata1,
            setup.ata2,
            2,
        )],
        &setup.owner1,
        &[],
        "program transfer",
    );

    assert_eq!(
        token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata1),
        8
    );
    assert_eq!(
        token_amount(&svm, TransactionTarget::Ephemeral, &setup.ata2),
        12
    );
}
