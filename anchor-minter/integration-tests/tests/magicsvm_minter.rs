//! End-to-end exercise of `token_minter` on [`litesvm::MagicSVM`] ([Magicblock fork](https://github.com/Dodecahedr0x/magicsvm)).
//!
//! This crate is **standalone** (not part of the Anchor program workspace) so its dependency graph
//! stays aligned with LiteSVM.
//!
//! From this directory:
//! - `anchor build` in `anchor-minter/` to produce `../target/deploy/token_minter.so`
//! - `cargo test`

use {
    borsh::BorshSerialize,
    litesvm::{types::TransactionResult, MagicSVM},
    solana_account::{Account, ReadableAccount},
    solana_address::{address, Address},
    solana_hash::Hash,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_program_pack::Pack,
    solana_rent::Rent,
    solana_signer::Signer,
    solana_transaction::Transaction,
    spl_associated_token_account_interface::address::get_associated_token_address_with_program_id,
    spl_token_interface::state::{Account as TokenAccountState, AccountState},
    std::path::PathBuf,
};

const PROGRAM_ID: Address = address!("DSRodKj1gdLyUJ14gymWeciZiQdT3zH1SN7LWqSHxoqT");
const TOKEN_PROGRAM: Address = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const METADATA_PROGRAM: Address = address!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const ASSOCIATED_TOKEN_PROGRAM: Address =
    address!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM: Address = address!("11111111111111111111111111111111");
const SYSVAR_RENT: Address = address!("SysvarRent111111111111111111111111111111111");

/// Anchor account discriminator for `Counter` (`sha256("account:Counter")[..8]`).
const COUNTER_DISCRIMINATOR: [u8; 8] = [255, 176, 4, 245, 188, 253, 124, 25];

const CREATE_TOKEN_IX: [u8; 8] = [84, 52, 204, 228, 24, 140, 234, 75];
const MINT_TOKEN_IX: [u8; 8] = [172, 137, 183, 14, 207, 110, 234, 56];

fn program_so_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("../target/deploy/token_minter.so");
    p
}

#[derive(BorshSerialize)]
struct CreateTokenArgs {
    token_name: String,
    token_symbol: String,
    token_uri: String,
}

fn encode_create_token_ix(args: &CreateTokenArgs) -> Vec<u8> {
    let mut data = CREATE_TOKEN_IX.to_vec();
    data.extend_from_slice(&borsh::to_vec(args).expect("borsh create_token"));
    data
}

fn encode_mint_token_ix(amount: u64) -> Vec<u8> {
    let mut data = MINT_TOKEN_IX.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

fn derive_mint_pda() -> (Address, u8) {
    Address::find_program_address(&[b"mint"], &PROGRAM_ID)
}

fn metadata_pda(mint: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[
            b"metadata".as_ref(),
            METADATA_PROGRAM.as_ref(),
            mint.as_ref(),
        ],
        &METADATA_PROGRAM,
    )
}

fn assert_success(result: TransactionResult) {
    result.unwrap();
}

fn counter_account_bytes(count: u64) -> Vec<u8> {
    let mut v = COUNTER_DISCRIMINATOR.to_vec();
    v.extend_from_slice(&count.to_le_bytes());
    v
}

#[test]
fn create_and_mint_on_magicsvm() {
    let so_path = program_so_path();
    assert!(
        so_path.exists(),
        "missing {} — run `anchor build` in anchor-minter first",
        so_path.display()
    );

    let mut svm = MagicSVM::new();
    svm.add_program_from_file(PROGRAM_ID, &so_path)
        .expect("load token_minter.so");

    let payer = Keypair::new();
    let payer_pk = payer.pubkey();
    svm.airdrop(&payer_pk, LAMPORTS_PER_SOL).unwrap();

    let counter = Keypair::new();
    let rent = svm.get_sysvar::<Rent>();
    let counter_data = counter_account_bytes(7);
    svm.set_account(
        counter.pubkey(),
        Account {
            lamports: rent.minimum_balance(counter_data.len()),
            owner: SYSTEM_PROGRAM,
            data: counter_data,
            ..Default::default()
        },
    )
    .unwrap();

    let (mint_address, _mint_bump) = derive_mint_pda();
    let (metadata_pda, _md_bump) = metadata_pda(&mint_address);

    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer_pk, true),
            AccountMeta::new(mint_address, false),
            AccountMeta::new(metadata_pda, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(METADATA_PROGRAM, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(SYSVAR_RENT, false),
        ],
        data: encode_create_token_ix(&CreateTokenArgs {
            token_name: "Magical Gem".into(),
            token_symbol: "MBGEM".into(),
            token_uri: "https://example.invalid/gem.json".into(),
        }),
    };

    let blockhash: Hash = svm.latest_blockhash();
    let create_tx = Transaction::new(
        &[&payer],
        Message::new(&[create_ix], Some(&payer_pk)),
        blockhash,
    );
    assert_success(svm.send_transaction(create_tx));

    let ata = get_associated_token_address_with_program_id(
        &payer_pk,
        &mint_address,
        &TOKEN_PROGRAM,
    );

    let mint_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer_pk, true),
            AccountMeta::new_readonly(counter.pubkey(), false),
            AccountMeta::new(mint_address, false),
            AccountMeta::new(ata, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: encode_mint_token_ix(1),
    };

    let mint_tx = Transaction::new(
        &[&payer],
        Message::new(&[mint_ix], Some(&payer_pk)),
        svm.latest_blockhash(),
    );
    assert_success(svm.send_transaction(mint_tx));

    let ata_account = svm.get_account(&ata).expect("ATA exists");
    assert_eq!(*ata_account.owner(), TOKEN_PROGRAM);
    let mut packed = [0u8; TokenAccountState::LEN];
    packed.copy_from_slice(ata_account.data());
    let parsed = TokenAccountState::unpack(&packed).unwrap();
    assert_eq!(parsed.mint, mint_address);
    assert_eq!(parsed.owner, payer_pk);
    assert_eq!(parsed.amount, 1_000_000_000); // 1 token with 9 decimals
    assert_eq!(parsed.state, AccountState::Initialized);
}
