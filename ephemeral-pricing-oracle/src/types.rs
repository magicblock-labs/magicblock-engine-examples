use async_trait::async_trait;
use borsh::{BorshDeserialize, BorshSerialize};
use byteorder::{ReadBytesExt, LE};
use solana_sdk::signature::Keypair;
use std::io::{Cursor, Read};

#[derive(BorshSerialize, BorshDeserialize, Clone, Default, Debug)]
pub struct TemporalNumericValue {
    pub timestamp_ns: u64,
    pub quantized_value: i128,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, Default)]
pub struct UpdateData {
    pub symbol: String,
    pub id: [u8; 32],
    pub temporal_numeric_value: TemporalNumericValue,
    pub publisher_merkle_root: [u8; 32],
    pub value_compute_alg_hash: [u8; 32],
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub v: u8,
}

#[async_trait]
pub trait ChainPusher {
    async fn new(rpc_url: &str, payer_keypair: Keypair) -> Self
    where
        Self: Sized;

    async fn feeds_subscription_msg(
        &self,
        price_feeds: &[String],
    ) -> Result<String, Box<dyn std::error::Error>>;

    async fn process_update(&self, message: &str) -> Result<(), Box<dyn std::error::Error>>;
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SolanaMessage {
    pub payload: Vec<u8>,
    pub signature: [u8; 64],
    pub public_key: [u8; 32],
}

const SOLANA_FORMAT_MAGIC_LE: u32 = 2182742457;

impl SolanaMessage {
    pub fn deserialize_slice(data: &[u8]) -> Result<Self, Box<dyn std::error::Error>> {
        Self::deserialize(Cursor::new(data))
    }

    pub fn deserialize(mut reader: impl Read) -> Result<Self, Box<dyn std::error::Error>> {
        let magic = reader.read_u32::<LE>()?;
        if magic != SOLANA_FORMAT_MAGIC_LE {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "magic mismatch",
            )));
        }
        let mut signature = [0u8; 64];
        reader.read_exact(&mut signature)?;
        let mut public_key = [0u8; 32];
        reader.read_exact(&mut public_key)?;
        let payload_len: usize = reader.read_u16::<LE>()?.into();
        let mut payload = vec![0u8; payload_len];
        reader.read_exact(&mut payload)?;

        Ok(Self {
            payload,
            signature,
            public_key,
        })
    }
}
