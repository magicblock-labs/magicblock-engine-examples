use anchor_lang::{prelude::Pubkey, InstructionData, ToAccountMetas};
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};

pub fn as_pubkey(address: &Address) -> Pubkey {
    Pubkey::new_from_array(address.to_bytes())
}

pub fn as_address(pubkey: Pubkey) -> Address {
    Address::new_from_array(pubkey.to_bytes())
}

pub fn client_ix(
    program_id: Address,
    data: impl InstructionData,
    accounts: impl ToAccountMetas,
) -> Instruction {
    Instruction {
        program_id,
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: as_address(meta.pubkey),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data: data.data(),
    }
}
