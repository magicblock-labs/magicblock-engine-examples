use {
    anchor_lang::{prelude::Pubkey, system_program, InstructionData, ToAccountMetas},
    binary_prediction::{
        self, accounts, instruction, Direction, ASSOCIATED_TOKEN_PROGRAM_ID as PROGRAM_ATA_ID,
        BET_SEED, DELEGATION_PROGRAM_ID as PROGRAM_DLP_ID,
        EPHEMERAL_SPL_TOKEN_PROGRAM_ID as PROGRAM_ESPL_ID, POOL_SEED,
    },
    ephemeral_rollups_sdk::pda::{
        delegate_buffer_pda_from_delegated_account_and_owner_program,
        delegation_metadata_pda_from_delegated_account,
        delegation_record_pda_from_delegated_account,
    },
    magicsvm::{MagicSVM, TransactionTarget},
    session_keys::{self, SessionTokenV2},
    solana_address::{address, Address},
    solana_clock::Clock,
    solana_instruction::{account_meta::AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    },
    test_utils::{as_address, as_pubkey, program_id_from_idl, send_ixs},
};

fn program_id() -> Address {
    program_id_from_idl(env!("CARGO_MANIFEST_DIR"), "binary_prediction.json")
}

fn program_pubkey() -> Pubkey {
    as_pubkey(&program_id())
}

fn session_program_id() -> Address {
    as_address(session_keys::ID)
}

fn client_ix(
    program: Pubkey,
    data: impl InstructionData,
    accounts: impl ToAccountMetas,
) -> Instruction {
    test_utils::client_ix(as_address(program), data, accounts)
}

const ORACLE_PROGRAM_ID: Address = address!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
const DELEGATION_PROGRAM_ID: Address = address!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const ESPL_TOKEN_PROGRAM_ID: Address = address!("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
const TOKEN_PROGRAM_ID: Address = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID: Address =
    address!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const COMPUTE_BUDGET_PROGRAM_ID: Address = address!("ComputeBudget111111111111111111111111111111");
const MAGIC_PROGRAM_ID: Address = address!("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID: Address = address!("MagicContext1111111111111111111111111111111");
const PRICE_FEED_SEED: &[u8] = b"price_feed";
const ORACLE_PROVIDER: &str = "pyth-lazer";
const ORACLE_SYMBOL: &str = "6";
const STAKE: u64 = 100;
const USER_DELEGATION: u64 = 300;
const POOL_SEED_AMOUNT: u64 = 10_000;
const BET_DURATION_SECONDS: i64 = 5;
const MIN_STAKE: u64 = 10;
const PAYOUT_BPS: u64 = 19_000;
const MINT_SIZE: u64 = 82;

const INITIALIZE_PRICE_FEED_DISCRIMINATOR: [u8; 8] = [68, 180, 81, 20, 102, 213, 145, 233];
const UPDATE_PRICE_FEED_DISCRIMINATOR: [u8; 8] = [28, 9, 93, 150, 86, 153, 188, 115];
const DELEGATE_PRICE_FEED_DISCRIMINATOR: [u8; 8] = [15, 179, 172, 145, 42, 73, 160, 241];

fn program_so_path() -> PathBuf {
    test_utils::program_so_path(env!("CARGO_MANIFEST_DIR"), "binary_prediction")
}

fn oracle_so_path() -> PathBuf {
    let mut so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    so_path.push("../tests/fixtures/ephemeral_oracle.so");
    so_path
}

fn session_so_path() -> PathBuf {
    let mut so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    so_path.push("../tests/fixtures/session-keys.so");
    so_path
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_secs() as i64
}

fn set_clock(svm: &mut MagicSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
    svm.ephemeral_mut().set_sysvar(&clock);
}

fn warp_clock(svm: &mut MagicSVM, seconds: i64) {
    let clock: Clock = svm.get_sysvar();
    set_clock(svm, clock.unix_timestamp + seconds);
}

fn hydrate(_svm: &mut MagicSVM, _keys: &[Address]) {}

fn pda(seeds: &[&[u8]], program_id: &Address) -> Address {
    Address::find_program_address(seeds, program_id).0
}

fn eata(owner: &Address, mint: &Address) -> Address {
    pda(&[owner.as_ref(), mint.as_ref()], &ESPL_TOKEN_PROGRAM_ID)
}

fn vault(mint: &Address) -> Address {
    pda(&[mint.as_ref()], &ESPL_TOKEN_PROGRAM_ID)
}

fn ata(owner: &Address, mint: &Address) -> Address {
    pda(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
}

fn delegation_buffer(account: &Address, owner_program: &Address) -> Address {
    pda(&[b"buffer", account.as_ref()], owner_program)
}

fn delegation_record(account: &Address) -> Address {
    pda(&[b"delegation", account.as_ref()], &DELEGATION_PROGRAM_ID)
}

fn delegation_metadata(account: &Address) -> Address {
    pda(
        &[b"delegation-metadata", account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
}

fn price_feed() -> Address {
    pda(
        &[
            PRICE_FEED_SEED,
            ORACLE_PROVIDER.as_bytes(),
            ORACLE_SYMBOL.as_bytes(),
        ],
        &ORACLE_PROGRAM_ID,
    )
}

fn push_borsh_str(buf: &mut Vec<u8>, value: &str) {
    buf.extend_from_slice(&(value.len() as u32).to_le_bytes());
    buf.extend_from_slice(value.as_bytes());
}

fn cu_limit_ix(units: u32) -> Instruction {
    let mut data = vec![2];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: COMPUTE_BUDGET_PROGRAM_ID,
        accounts: vec![],
        data,
    }
}

fn initialize_price_feed_ix(payer: Address, feed: Address) -> Instruction {
    let mut data = INITIALIZE_PRICE_FEED_DISCRIMINATOR.to_vec();
    push_borsh_str(&mut data, ORACLE_PROVIDER);
    push_borsh_str(&mut data, ORACLE_SYMBOL);
    data.extend_from_slice(feed.as_ref());
    data.extend_from_slice(&0i32.to_le_bytes());
    Instruction {
        program_id: ORACLE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(feed, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data,
    }
}

fn update_price_feed_ix(
    payer: Address,
    feed: Address,
    price: i128,
    timestamp_ns: u64,
) -> Instruction {
    let mut data = UPDATE_PRICE_FEED_DISCRIMINATOR.to_vec();
    push_borsh_str(&mut data, ORACLE_PROVIDER);
    push_borsh_str(&mut data, ORACLE_SYMBOL);
    data.extend_from_slice(feed.as_ref());
    data.extend_from_slice(&timestamp_ns.to_le_bytes());
    data.extend_from_slice(&price.to_le_bytes());
    data.extend_from_slice(&[0u8; 32]);
    data.extend_from_slice(&[0u8; 32]);
    data.extend_from_slice(&[0u8; 32]);
    data.extend_from_slice(&[0u8; 32]);
    data.push(0);
    Instruction {
        program_id: ORACLE_PROGRAM_ID,
        accounts: vec![AccountMeta::new(payer, true), AccountMeta::new(feed, false)],
        data,
    }
}

fn delegate_price_feed_ix(payer: Address, feed: Address) -> Instruction {
    let mut data = DELEGATE_PRICE_FEED_DISCRIMINATOR.to_vec();
    push_borsh_str(&mut data, ORACLE_PROVIDER);
    push_borsh_str(&mut data, ORACLE_SYMBOL);
    Instruction {
        program_id: ORACLE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(feed, false),
            AccountMeta::new(delegation_buffer(&feed, &ORACLE_PROGRAM_ID), false),
            AccountMeta::new(delegation_record(&feed), false),
            AccountMeta::new(delegation_metadata(&feed), false),
            AccountMeta::new_readonly(ORACLE_PROGRAM_ID, false),
            AccountMeta::new_readonly(DELEGATION_PROGRAM_ID, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data,
    }
}

fn create_mint_ixs(payer: Address, mint: Address, lamports: u64) -> Vec<Instruction> {
    let create = solana_system_interface::instruction::create_account(
        &payer,
        &mint,
        lamports,
        MINT_SIZE,
        &TOKEN_PROGRAM_ID,
    );
    let mut init_data = vec![20, 0];
    init_data.extend_from_slice(payer.as_ref());
    init_data.push(0);
    let init = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![AccountMeta::new(mint, false)],
        data: init_data,
    };
    vec![create, init]
}

fn create_ata_ix(payer: Address, owner: Address, mint: Address) -> Instruction {
    Instruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(ata(&owner, &mint), false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data: vec![],
    }
}

fn mint_to_ix(mint: Address, dest: Address, authority: Address, amount: u64) -> Instruction {
    let mut data = vec![7];
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

fn approve_ix(source: Address, delegate: Address, owner: Address, amount: u64) -> Instruction {
    let mut data = vec![4];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(source, false),
            AccountMeta::new_readonly(delegate, false),
            AccountMeta::new_readonly(owner, true),
        ],
        data,
    }
}

fn initialize_ix(
    admin: Address,
    mint: Address,
    pool: Address,
    feed: Address,
    validator: Address,
) -> Instruction {
    let pool_ata = ata(&pool, &mint);
    let pool_eata = eata(&pool, &mint);
    let vault_pda = vault(&mint);
    let vault_eata = eata(&vault_pda, &mint);
    let vault_ata = ata(&vault_pda, &mint);
    let mut instruction = client_ix(
        program_pubkey(),
        instruction::Initialize {
            price_feed: as_pubkey(&feed),
            price_feed_id: feed.to_bytes(),
            seed_amount: POOL_SEED_AMOUNT,
            bet_duration_seconds: BET_DURATION_SECONDS,
            min_stake: MIN_STAKE,
            payout_bps: PAYOUT_BPS,
        },
        accounts::Initialize {
            admin: as_pubkey(&admin),
            mint: as_pubkey(&mint),
            pool: as_pubkey(&pool),
            pool_token_account: as_pubkey(&pool_ata),
            admin_token_account: as_pubkey(&ata(&admin, &mint)),
            pool_ephemeral_ata: as_pubkey(&pool_eata),
            vault: as_pubkey(&vault_pda),
            vault_ephemeral_ata: as_pubkey(&vault_eata),
            vault_token_account: as_pubkey(&vault_ata),
            pool_eata_buffer: as_pubkey(&delegation_buffer(&pool_eata, &ESPL_TOKEN_PROGRAM_ID)),
            pool_eata_record: as_pubkey(&delegation_record(&pool_eata)),
            pool_eata_metadata: as_pubkey(&delegation_metadata(&pool_eata)),
            vault_eata_buffer: as_pubkey(&delegation_buffer(&vault_eata, &ESPL_TOKEN_PROGRAM_ID)),
            vault_eata_record: as_pubkey(&delegation_record(&vault_eata)),
            vault_eata_metadata: as_pubkey(&delegation_metadata(&vault_eata)),
            ephemeral_token_program: PROGRAM_ESPL_ID,
            delegation_program: PROGRAM_DLP_ID,
            token_program: as_pubkey(&TOKEN_PROGRAM_ID),
            associated_token_program: PROGRAM_ATA_ID,
            system_program: system_program::ID,
        },
    );
    instruction
        .accounts
        .push(AccountMeta::new_readonly(validator, false));
    instruction
}

fn initialize_bet_ix(payer: Address, user: Address, bet: Address) -> Instruction {
    client_ix(
        program_pubkey(),
        instruction::InitializeBet {},
        accounts::InitializeBet {
            payer: as_pubkey(&payer),
            user: as_pubkey(&user),
            bet: as_pubkey(&bet),
            system_program: system_program::ID,
        },
    )
}

fn delegate_bet_ix(payer: Address, user: Address, bet: Address, validator: Address) -> Instruction {
    let bet_pk = as_pubkey(&bet);
    let mut instruction = client_ix(
        program_pubkey(),
        instruction::DelegateBet {},
        accounts::DelegateBet {
            payer: as_pubkey(&payer),
            user: as_pubkey(&user),
            buffer_bet: delegate_buffer_pda_from_delegated_account_and_owner_program(
                &bet_pk,
                &program_pubkey(),
            ),
            delegation_record_bet: delegation_record_pda_from_delegated_account(&bet_pk),
            delegation_metadata_bet: delegation_metadata_pda_from_delegated_account(&bet_pk),
            bet: bet_pk,
            owner_program: program_pubkey(),
            delegation_program: PROGRAM_DLP_ID,
            system_program: system_program::ID,
        },
    );
    instruction
        .accounts
        .push(AccountMeta::new_readonly(validator, false));
    instruction
}

fn init_eata_ix(payer: Address, owner: Address, mint: Address) -> Instruction {
    Instruction {
        program_id: ESPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(eata(&owner, &mint), false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data: vec![0],
    }
}

fn transfer_to_vault_ix(owner: Address, mint: Address, amount: u64) -> Instruction {
    let owner_ata = ata(&owner, &mint);
    let vault_pda = vault(&mint);
    let mut data = vec![2];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ESPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(eata(&owner, &mint), false),
            AccountMeta::new_readonly(vault_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(owner_ata, false),
            AccountMeta::new(ata(&vault_pda, &mint), false),
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data,
    }
}

fn delegate_eata_ix(
    payer: Address,
    owner: Address,
    mint: Address,
    validator: Address,
) -> Instruction {
    let eata_addr = eata(&owner, &mint);
    let mut data = vec![4];
    data.extend_from_slice(validator.as_ref());
    Instruction {
        program_id: ESPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(eata_addr, false),
            AccountMeta::new_readonly(ESPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new(delegation_buffer(&eata_addr, &ESPL_TOKEN_PROGRAM_ID), false),
            AccountMeta::new(delegation_record(&eata_addr), false),
            AccountMeta::new(delegation_metadata(&eata_addr), false),
            AccountMeta::new_readonly(DELEGATION_PROGRAM_ID, false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn place_bet_ix(
    payer: Address,
    user: Address,
    mint: Address,
    pool: Address,
    bet: Address,
    feed: Address,
    session_token: Option<Address>,
    direction: Direction,
    stake: u64,
) -> Instruction {
    client_ix(
        program_pubkey(),
        instruction::PlaceBet { direction, stake },
        accounts::PlaceBet {
            payer: as_pubkey(&payer),
            user: as_pubkey(&user),
            mint: as_pubkey(&mint),
            pool: as_pubkey(&pool),
            bet: as_pubkey(&bet),
            user_token_account: as_pubkey(&ata(&user, &mint)),
            pool_token_account: as_pubkey(&ata(&pool, &mint)),
            price_update: as_pubkey(&feed),
            token_program: as_pubkey(&TOKEN_PROGRAM_ID),
            session_token: Some(as_pubkey(&session_token.unwrap_or_else(program_id))),
        },
    )
}

fn settle_ix(
    payer: Address,
    user: Address,
    mint: Address,
    pool: Address,
    bet: Address,
    feed: Address,
) -> Instruction {
    client_ix(
        program_pubkey(),
        instruction::Settle {},
        accounts::Settle {
            payer: as_pubkey(&payer),
            user: as_pubkey(&user),
            mint: as_pubkey(&mint),
            pool: as_pubkey(&pool),
            bet: as_pubkey(&bet),
            user_token_account: as_pubkey(&ata(&user, &mint)),
            pool_token_account: as_pubkey(&ata(&pool, &mint)),
            price_update: as_pubkey(&feed),
            token_program: as_pubkey(&TOKEN_PROGRAM_ID),
        },
    )
}

fn create_session_v2_ix(
    session_token: Address,
    session_signer: Address,
    fee_payer: Address,
    authority: Address,
    valid_until: i64,
    lamports: u64,
) -> Instruction {
    client_ix(
        session_keys::ID,
        session_keys::instruction::CreateSessionV2 {
            top_up: Some(true),
            valid_until: Some(valid_until),
            lamports: Some(lamports),
        },
        session_keys::accounts::CreateSessionTokenV2 {
            session_token: as_pubkey(&session_token),
            session_signer: as_pubkey(&session_signer),
            fee_payer: as_pubkey(&fee_payer),
            authority: as_pubkey(&authority),
            target_program: program_pubkey(),
            system_program: system_program::ID,
        },
    )
}

fn undelegate_user_ix(owner: Address, mint: Address) -> Instruction {
    Instruction {
        program_id: ESPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new(ata(&owner, &mint), false),
            AccountMeta::new_readonly(eata(&owner, &mint), false),
            AccountMeta::new(MAGIC_CONTEXT_ID, false),
            AccountMeta::new_readonly(MAGIC_PROGRAM_ID, false),
        ],
        data: vec![5],
    }
}

fn withdraw_spl_ix(user: Address, mint: Address, amount: u64) -> Instruction {
    let vault_pda = vault(&mint);
    let mut data = vec![3];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ESPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(user, true),
            AccountMeta::new(eata(&user, &mint), false),
            AccountMeta::new_readonly(vault_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(ata(&vault_pda, &mint), false),
            AccountMeta::new(ata(&user, &mint), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data,
    }
}

fn token_amount(svm: &MagicSVM, address: &Address, target: TransactionTarget) -> u64 {
    let data = svm
        .get_account_for(target, address)
        .unwrap_or_else(|| panic!("token account {address} missing on {target:?}"))
        .data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn oracle_timestamp_ns(svm: &MagicSVM) -> u64 {
    let clock: Clock = svm.get_sysvar();
    clock.unix_timestamp as u64 * 1_000_000_000
}

#[test]
fn binary_prediction_initialize_bet_settle_withdraw() {
    let admin = Keypair::new();
    let user = Keypair::new();
    let session_signer = Keypair::new();
    let mint_kp = Keypair::new();
    let mint = mint_kp.pubkey();
    let mut svm = MagicSVM::new();
    set_clock(&mut svm, now_unix());

    svm.add_program_from_file(program_id(), program_so_path())
        .unwrap();
    svm.add_program_from_file(ORACLE_PROGRAM_ID, oracle_so_path())
        .unwrap();
    svm.add_program_from_file(session_program_id(), session_so_path())
        .unwrap();
    svm.airdrop(&admin.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
    svm.airdrop(&user.pubkey(), 2 * LAMPORTS_PER_SOL).unwrap();

    let validator = svm.validator_identity();
    let feed = price_feed();
    let pool = pda(&[POOL_SEED, mint.as_ref()], &program_id());
    let user_bet = pda(&[BET_SEED, user.pubkey().as_ref()], &program_id());
    let user_ata = ata(&user.pubkey(), &mint);
    let admin_ata = ata(&admin.pubkey(), &mint);
    let pool_ata = ata(&pool, &mint);
    let session_token = pda(
        &[
            SessionTokenV2::SEED_PREFIX.as_bytes(),
            program_id().as_ref(),
            session_signer.pubkey().as_ref(),
            user.pubkey().as_ref(),
        ],
        &session_program_id(),
    );

    let mint_rent = svm.minimum_balance_for_rent_exemption(MINT_SIZE as usize);
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin, &mint_kp],
        create_mint_ixs(admin.pubkey(), mint, mint_rent),
        "create mint",
    );
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![
            create_ata_ix(admin.pubkey(), user.pubkey(), mint),
            create_ata_ix(admin.pubkey(), admin.pubkey(), mint),
        ],
        "create ATAs",
    );
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![
            mint_to_ix(mint, user_ata, admin.pubkey(), 1_000),
            mint_to_ix(mint, admin_ata, admin.pubkey(), POOL_SEED_AMOUNT),
        ],
        "mint tokens",
    );

    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![initialize_price_feed_ix(admin.pubkey(), feed)],
        "initialize price feed",
    );
    let price_ts = oracle_timestamp_ns(&svm);
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![update_price_feed_ix(admin.pubkey(), feed, 100, price_ts)],
        "update price feed 100",
    );

    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![
            cu_limit_ix(1_400_000),
            initialize_ix(admin.pubkey(), mint, pool, feed, validator),
        ],
        "initialize",
    );

    let pool_data = svm.get_account(&pool).expect("pool").data;
    assert_eq!(
        i64::from_le_bytes(pool_data[136..144].try_into().unwrap()),
        BET_DURATION_SECONDS
    );
    assert_eq!(&pool_data[104..136], feed.as_ref());
    assert_eq!(
        u64::from_le_bytes(pool_data[144..152].try_into().unwrap()),
        MIN_STAKE
    );
    assert_eq!(
        u64::from_le_bytes(pool_data[152..160].try_into().unwrap()),
        PAYOUT_BPS
    );
    assert_eq!(token_amount(&svm, &pool_ata, TransactionTarget::Base), 0);

    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![initialize_bet_ix(admin.pubkey(), user.pubkey(), user_bet)],
        "initialize bet",
    );
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin],
        vec![delegate_price_feed_ix(admin.pubkey(), feed)],
        "delegate price feed",
    );
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin, &user],
        vec![delegate_bet_ix(
            admin.pubkey(),
            user.pubkey(),
            user_bet,
            validator,
        )],
        "delegate bet",
    );
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin, &user],
        vec![
            init_eata_ix(admin.pubkey(), user.pubkey(), mint),
            transfer_to_vault_ix(user.pubkey(), mint, USER_DELEGATION),
            delegate_eata_ix(admin.pubkey(), user.pubkey(), mint, validator),
        ],
        "delegate user SPL",
    );

    hydrate(&mut svm, &[pool, mint, TOKEN_PROGRAM_ID]);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&admin, &user],
        vec![place_bet_ix(
            user.pubkey(),
            user.pubkey(),
            mint,
            pool,
            user_bet,
            feed,
            None,
            Direction::Up,
            STAKE,
        )],
        "place wallet bet",
    );

    let bet = svm
        .get_account_for(TransactionTarget::Ephemeral, &user_bet)
        .expect("bet");
    assert_eq!(i64::from_le_bytes(bet.data[8..16].try_into().unwrap()), 100);
    assert_eq!(
        u64::from_le_bytes(bet.data[25..33].try_into().unwrap()),
        STAKE
    );
    assert_eq!(bet.data[33], 1);

    let price_ts = oracle_timestamp_ns(&svm);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&admin],
        vec![update_price_feed_ix(admin.pubkey(), feed, 110, price_ts)],
        "update price feed 110",
    );
    warp_clock(&mut svm, BET_DURATION_SECONDS + 1);

    hydrate(&mut svm, &[pool, mint]);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&admin],
        vec![settle_ix(
            admin.pubkey(),
            user.pubkey(),
            mint,
            pool,
            user_bet,
            feed,
        )],
        "settle win",
    );
    let bet = svm
        .get_account_for(TransactionTarget::Ephemeral, &user_bet)
        .expect("bet");
    assert_eq!(bet.data[33], 0);

    let clock: Clock = svm.get_sysvar();
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin, &user, &session_signer],
        vec![create_session_v2_ix(
            session_token,
            session_signer.pubkey(),
            admin.pubkey(),
            user.pubkey(),
            clock.unix_timestamp + 3600,
            (0.005 * LAMPORTS_PER_SOL as f64) as u64,
        )],
        "create session",
    );

    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&user],
        vec![approve_ix(
            user_ata,
            session_signer.pubkey(),
            user.pubkey(),
            STAKE,
        )],
        "approve session delegate",
    );

    hydrate(&mut svm, &[pool, mint, session_token]);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&session_signer],
        vec![place_bet_ix(
            session_signer.pubkey(),
            user.pubkey(),
            mint,
            pool,
            user_bet,
            feed,
            Some(session_token),
            Direction::Down,
            STAKE,
        )],
        "place session bet",
    );

    let price_ts = oracle_timestamp_ns(&svm);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&admin],
        vec![update_price_feed_ix(admin.pubkey(), feed, 120, price_ts)],
        "update price feed 120",
    );
    warp_clock(&mut svm, BET_DURATION_SECONDS + 1);

    hydrate(&mut svm, &[pool, mint]);
    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&admin],
        vec![settle_ix(
            admin.pubkey(),
            user.pubkey(),
            mint,
            pool,
            user_bet,
            feed,
        )],
        "settle loss",
    );

    let er_user_balance = token_amount(&svm, &user_ata, TransactionTarget::Ephemeral);
    let er_pool_balance = token_amount(&svm, &pool_ata, TransactionTarget::Ephemeral);
    assert_eq!(er_user_balance, 290);
    assert_eq!(er_pool_balance, 10_010);

    send_ixs(
        &mut svm,
        TransactionTarget::Ephemeral,
        &[&user],
        vec![undelegate_user_ix(user.pubkey(), mint)],
        "user undelegate",
    );
    send_ixs(
        &mut svm,
        TransactionTarget::Base,
        &[&admin, &user],
        vec![withdraw_spl_ix(user.pubkey(), mint, er_user_balance)],
        "user withdraw",
    );

    assert_eq!(token_amount(&svm, &user_ata, TransactionTarget::Base), 990);
    assert_eq!(token_amount(&svm, &pool_ata, TransactionTarget::Base), 0);
}
