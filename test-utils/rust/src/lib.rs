use magicsvm::{MagicSVM, TransactionTarget};
use solana_address::Address;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::{Path, PathBuf};

#[cfg(feature = "anchor")]
mod anchor_ix;
#[cfg(feature = "anchor")]
pub use anchor_ix::*;

#[cfg(feature = "anchor")]
pub use ephemeral_rollups_sdk::anchor::{DelegationProgram, MagicProgram};
#[cfg(feature = "anchor")]
pub use ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID;
#[cfg(feature = "anchor")]
pub use ephemeral_rollups_sdk::pda::{
    delegate_buffer_pda_from_delegated_account_and_owner_program,
    delegation_metadata_pda_from_delegated_account, delegation_record_pda_from_delegated_account,
};

pub fn send_tx(svm: &mut MagicSVM, target: TransactionTarget, tx: Transaction, label: &str) {
    if let Err(failed) = svm.send_transaction_to(target, tx) {
        panic!(
            "{label} failed on {target:?}: {:?}\nlogs: {:#?}",
            failed.err, failed.meta.logs
        );
    }
    svm.expire_blockhash_for(target);
}

pub fn sign_tx(signers: &[&Keypair], instructions: &[Instruction], blockhash: Hash) -> Transaction {
    Transaction::new(
        signers,
        Message::new(instructions, Some(&signers[0].pubkey())),
        blockhash,
    )
}

fn unique_signers<'a>(signers: &[&'a Keypair]) -> Vec<&'a Keypair> {
    let mut unique = Vec::with_capacity(signers.len());
    for signer in signers {
        if unique
            .iter()
            .any(|existing: &&Keypair| existing.pubkey() == signer.pubkey())
        {
            continue;
        }
        unique.push(*signer);
    }
    unique
}

pub fn send_ixs(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    signers: &[&Keypair],
    instructions: impl AsRef<[Instruction]>,
    label: &str,
) {
    let unique = unique_signers(signers);
    let tx = sign_tx(
        &unique,
        instructions.as_ref(),
        svm.latest_blockhash_for(target),
    );
    send_tx(svm, target, tx, label);
}

pub fn send_ix(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    signers: &[&Keypair],
    instruction: Instruction,
    label: &str,
) {
    send_ixs(svm, target, signers, &[instruction], label);
}

pub fn add_program(svm: &mut MagicSVM, program_id: Address, so: impl AsRef<Path>) {
    let so = so.as_ref();
    svm.add_program_from_file(program_id, so)
        .unwrap_or_else(|err| panic!("load {}: {err}", so.display()));
}

pub fn airdrop(svm: &mut MagicSVM, address: &Address, lamports: u64) {
    svm.airdrop(address, lamports)
        .unwrap_or_else(|err| panic!("airdrop {address}: {err:?}"));
}

pub fn boot(
    manifest_dir: impl AsRef<Path>,
    program_name: &str,
    program_id: Address,
    payer: &Keypair,
    lamports: u64,
) -> MagicSVM {
    let mut svm = MagicSVM::new();
    add_program(
        &mut svm,
        program_id,
        program_so_path(manifest_dir, program_name),
    );
    airdrop(&mut svm, &payer.pubkey(), lamports);
    svm
}

pub fn read_u64_le(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().expect("u64"))
}

pub fn account_u64(
    svm: &MagicSVM,
    target: TransactionTarget,
    address: &Address,
    offset: usize,
) -> u64 {
    let account = svm
        .get_account_for(target, address)
        .unwrap_or_else(|| panic!("missing {address} on {target:?}"));
    read_u64_le(&account.data, offset)
}

pub fn account_owner(svm: &MagicSVM, target: TransactionTarget, address: &Address) -> Address {
    svm.get_account_for(target, address)
        .unwrap_or_else(|| panic!("missing {address} on {target:?}"))
        .owner
}

#[cfg(feature = "sdk")]
pub fn is_delegated(svm: &MagicSVM, address: &Address) -> bool {
    svm.get_account_for(TransactionTarget::Base, address)
        .is_some_and(|account| {
            account.owner == ephemeral_rollups_sdk::consts::DELEGATION_PROGRAM_ID
        })
}

pub fn example_dir(manifest_dir: impl AsRef<Path>) -> PathBuf {
    manifest_dir.as_ref().join("..")
}

pub fn program_so_path(manifest_dir: impl AsRef<Path>, program_name: &str) -> PathBuf {
    example_dir(manifest_dir)
        .join("target/deploy")
        .join(format!("{program_name}.so"))
}

pub fn program_id_from_keypair(manifest_dir: impl AsRef<Path>, program_name: &str) -> Address {
    let path = example_dir(manifest_dir)
        .join("target/deploy")
        .join(format!("{program_name}-keypair.json"));
    let bytes: Vec<u8> = serde_json::from_slice(
        &std::fs::read(&path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display())),
    )
    .unwrap_or_else(|err| panic!("invalid keypair {}: {err}", path.display()));
    Address::new_from_array(bytes[32..64].try_into().expect("keypair pubkey"))
}

pub fn program_id_from_idl(manifest_dir: impl AsRef<Path>, idl_name: &str) -> Address {
    let path = example_dir(manifest_dir).join("target/idl").join(idl_name);
    let value: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display())),
    )
    .unwrap_or_else(|err| panic!("invalid IDL {}: {err}", path.display()));
    let address = value
        .get("address")
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| panic!("{} missing address", path.display()));
    address
        .parse()
        .unwrap_or_else(|err| panic!("invalid program address in {}: {err}", path.display()))
}
