use {
    anchor_lang::{prelude::Pubkey, system_program, InstructionData, ToAccountMetas},
    base64::{engine::general_purpose::STANDARD, Engine as _},
    magicsvm::{MagicSVM, TransactionTarget},
    oracle_priced_purchase::{self, accounts, instruction, RECEIPT_SEED, STORE_SEED},
    solana_account::Account,
    solana_address::{address, Address},
    solana_clock::Clock,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::{fs, path::PathBuf, str::FromStr},
    test_utils::{as_address, as_pubkey, client_ix, program_id_from_idl, send_ixs},
};

const SOL_USD_100_PRICE: Address = address!("B8vx8v7SwZsmFYz3fkSJphr7uq34LoiVr18pimLG5FJM");
const SOL_USD_50_PRICE: Address = address!("EpdAP2KHQAXPccREjM1WsLiyKVcchYj82pv9sWZhYUY1");
const SOL_USD_100_FEED_ID: [u8; 32] = [
    0x96, 0x9c, 0xef, 0xe5, 0xa1, 0xc3, 0xdc, 0x42, 0x4a, 0xea, 0xf1, 0x91, 0x89, 0x3d, 0x64, 0x27,
    0x99, 0xb8, 0x54, 0x54, 0x31, 0xb5, 0xe2, 0x56, 0x0e, 0x1c, 0xc7, 0x8c, 0xcf, 0xdd, 0x91, 0xd6,
];
const SOL_USD_50_FEED_ID: [u8; 32] = [
    0xcd, 0x5b, 0x1d, 0xc2, 0xe5, 0x48, 0x6e, 0xe8, 0xa1, 0xfa, 0x93, 0xa7, 0x6a, 0xd5, 0x6a, 0x1d,
    0x15, 0xfe, 0xf4, 0x5c, 0x54, 0xfa, 0xc5, 0x0c, 0x7b, 0x48, 0x9f, 0x1f, 0x3b, 0xe0, 0x13, 0x6a,
];
const PRICE_PUBLISH_TIME_OFFSET: usize = 93;

#[derive(serde::Deserialize)]
struct FixtureFile {
    pubkey: String,
    account: FixtureAccount,
}

#[derive(serde::Deserialize)]
struct FixtureAccount {
    lamports: u64,
    data: (String, String),
    owner: String,
    executable: bool,
    #[serde(rename = "rentEpoch", default)]
    rent_epoch: u64,
}

fn example_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn program_so() -> Vec<u8> {
    let path = example_dir().join("target/deploy/oracle_priced_purchase.so");
    fs::read(&path).unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()))
}

fn load_oracle_fixtures(svm: &mut MagicSVM) -> i64 {
    let fixtures_dir = example_dir().join("tests/fixtures/accounts");
    let mut publish_time = 0i64;
    for entry in fs::read_dir(&fixtures_dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let fixture: FixtureFile =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            fixture.account.data.1, "base64",
            "oracle fixtures must be base64-encoded"
        );
        let data = STANDARD.decode(fixture.account.data.0.as_bytes()).unwrap();
        if data.len() >= PRICE_PUBLISH_TIME_OFFSET + 8 {
            publish_time = i64::from_le_bytes(
                data[PRICE_PUBLISH_TIME_OFFSET..PRICE_PUBLISH_TIME_OFFSET + 8]
                    .try_into()
                    .unwrap(),
            );
        }
        svm.set_account(
            Address::from_str(&fixture.pubkey).unwrap(),
            Account {
                lamports: fixture.account.lamports,
                data,
                owner: Address::from_str(&fixture.account.owner).unwrap(),
                executable: fixture.account.executable,
                rent_epoch: fixture.account.rent_epoch,
            },
        )
        .unwrap();
    }
    publish_time
}

fn program_id() -> Pubkey {
    as_pubkey(&program_id_from_idl(
        env!("CARGO_MANIFEST_DIR"),
        "oracle_priced_purchase.json",
    ))
}

fn program_address() -> Address {
    as_address(program_id())
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    client_ix(program_address(), data, accounts)
}

fn send_base(svm: &mut MagicSVM, signers: &[&Keypair], ix: Instruction) {
    send_ixs(svm, TransactionTarget::Base, signers, &[ix], "transaction");
}

fn initialize_store_ix(
    store: Pubkey,
    merchant: Pubkey,
    token_price_usd_cents: u64,
    sol_usd_feed_id: [u8; 32],
) -> Instruction {
    ix(
        instruction::InitializeStore {
            token_price_usd_cents,
            sol_usd_feed_id,
        },
        accounts::InitializeStore {
            store,
            merchant,
            system_program: system_program::ID,
        },
    )
}

fn buy_token_ix(
    store: Pubkey,
    receipt: Pubkey,
    buyer: Pubkey,
    merchant: Pubkey,
    price_update: Pubkey,
    quantity: u64,
    max_lamports: u64,
) -> Instruction {
    ix(
        instruction::BuyToken {
            quantity,
            max_lamports,
        },
        accounts::BuyToken {
            store,
            receipt,
            buyer,
            merchant,
            price_update,
            system_program: system_program::ID,
        },
    )
}

struct StoreState {
    token_price_usd_cents: u64,
    sold_count: u64,
}

fn decode_store(data: &[u8]) -> StoreState {
    assert!(data.len() >= 88, "store account too small");
    StoreState {
        token_price_usd_cents: u64::from_le_bytes(data[72..80].try_into().unwrap()),
        sold_count: u64::from_le_bytes(data[80..88].try_into().unwrap()),
    }
}

struct ReceiptState {
    buyer: Address,
    total_quantity: u64,
    total_paid_lamports: u64,
    last_unit_price_usd_cents: u64,
    last_paid_lamports: u64,
    oracle_price: i64,
    oracle_exponent: i32,
}

fn decode_receipt(data: &[u8]) -> ReceiptState {
    assert!(data.len() >= 88, "receipt account too small");
    ReceiptState {
        buyer: Address::from(<[u8; 32]>::try_from(&data[8..40]).unwrap()),
        total_quantity: u64::from_le_bytes(data[40..48].try_into().unwrap()),
        total_paid_lamports: u64::from_le_bytes(data[48..56].try_into().unwrap()),
        last_unit_price_usd_cents: u64::from_le_bytes(data[56..64].try_into().unwrap()),
        last_paid_lamports: u64::from_le_bytes(data[64..72].try_into().unwrap()),
        oracle_price: i64::from_le_bytes(data[72..80].try_into().unwrap()),
        oracle_exponent: i32::from_le_bytes(data[80..84].try_into().unwrap()),
    }
}

fn setup() -> (MagicSVM, Keypair, Keypair, Address, Address) {
    let merchant = Keypair::new();
    let buyer = Keypair::new();
    let mut svm = MagicSVM::new();
    svm.add_program(program_address(), &program_so()).unwrap();
    svm.airdrop(&merchant.pubkey(), 10 * LAMPORTS_PER_SOL)
        .unwrap();
    svm.airdrop(&buyer.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();

    let publish_time = load_oracle_fixtures(&mut svm);
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = publish_time;
    svm.set_sysvar(&clock);

    let (store, _) = Pubkey::find_program_address(&[STORE_SEED], &program_id());
    let (receipt, _) =
        Pubkey::find_program_address(&[RECEIPT_SEED, buyer.pubkey().as_ref()], &program_id());

    send_base(
        &mut svm,
        &[&merchant],
        initialize_store_ix(
            store,
            as_pubkey(&merchant.pubkey()),
            2_500,
            SOL_USD_100_FEED_ID,
        ),
    );

    (svm, merchant, buyer, as_address(store), as_address(receipt))
}

#[test]
fn uses_the_sol_usd_oracle_price_to_charge_a_usd_priced_token_purchase() {
    let (mut svm, merchant, buyer, store, receipt) = setup();

    send_base(
        &mut svm,
        &[&merchant, &buyer],
        buy_token_ix(
            as_pubkey(&store),
            as_pubkey(&receipt),
            as_pubkey(&buyer.pubkey()),
            as_pubkey(&merchant.pubkey()),
            as_pubkey(&SOL_USD_100_PRICE),
            2,
            600_000_000,
        ),
    );

    let store_state = decode_store(&svm.get_account(&store).unwrap().data);
    assert_eq!(store_state.token_price_usd_cents.to_string(), "2500");
    assert_eq!(store_state.sold_count.to_string(), "2");

    let receipt_state = decode_receipt(&svm.get_account(&receipt).unwrap().data);
    assert_eq!(receipt_state.buyer, buyer.pubkey());
    assert_eq!(receipt_state.total_quantity.to_string(), "2");
    assert_eq!(receipt_state.total_paid_lamports.to_string(), "500000000");
    assert_eq!(receipt_state.last_unit_price_usd_cents.to_string(), "2500");
    assert_eq!(receipt_state.last_paid_lamports.to_string(), "500000000");
    assert_eq!(receipt_state.oracle_price.to_string(), "10000");
    assert_eq!(receipt_state.oracle_exponent, -2);
}

#[test]
fn rejects_a_purchase_when_the_oracle_derived_sol_cost_exceeds_max_lamports() {
    let (mut svm, merchant, buyer, store, receipt) = setup();

    send_base(
        &mut svm,
        &[&merchant],
        initialize_store_ix(
            as_pubkey(&store),
            as_pubkey(&merchant.pubkey()),
            2_500,
            SOL_USD_50_FEED_ID,
        ),
    );

    let tx = Transaction::new(
        &[&merchant, &buyer],
        Message::new(
            &[buy_token_ix(
                as_pubkey(&store),
                as_pubkey(&receipt),
                as_pubkey(&buyer.pubkey()),
                as_pubkey(&merchant.pubkey()),
                as_pubkey(&SOL_USD_50_PRICE),
                1,
                400_000_000,
            )],
            Some(&merchant.pubkey()),
        ),
        svm.latest_blockhash_for(TransactionTarget::Base),
    );
    let err = svm
        .send_transaction_to(TransactionTarget::Base, tx)
        .expect_err("expected max_lamports check to reject the purchase");
    let logs = err.meta.logs.join("\n");
    assert!(
        logs.contains("PaymentTooHigh"),
        "expected PaymentTooHigh, got:\n{logs}"
    );
}
