use crate::types::UpdateData;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;
use solana_sdk::pubkey;

const ID: Pubkey = pubkey!("orayZ4JuarAK33zEcRUqiKAXgwj7WSC8eKWCwiMHhTQ");

pub fn update_price_feed(
    payer: &Pubkey,
    provider: &String,
    update_data: &UpdateData,
) -> Instruction {
    let price_feed = Pubkey::find_program_address(
        &[
            b"price_feed",
            provider.as_bytes(),
            update_data.symbol.as_bytes(),
        ],
        &ID,
    )
    .0;
    Instruction {
        program_id: ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(price_feed, false),
        ],
        data: UpdatePriceFeed {
            provider: provider.clone(),
            update_data: update_data.clone(),
        }
        .data(),
    }
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UpdatePriceFeed {
    pub provider: String,
    pub update_data: UpdateData,
}

impl UpdatePriceFeed {
    pub fn data(&self) -> Vec<u8> {
        let mut data = vec![28, 9, 93, 150, 86, 153, 188, 115];
        data.extend(borsh::to_vec(&self).unwrap());
        data
    }
}
