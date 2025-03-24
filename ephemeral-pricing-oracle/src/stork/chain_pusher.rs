use crate::blockhash_cache::BlockhashCache;
use crate::instructions::update_price_feed;
use crate::stork::price_parser::parse_price_update;
use crate::types::{ChainPusher, UpdateData};
use async_trait::async_trait;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use tracing::info;

pub struct StorkChainPusher {
    rpc_client: RpcClient,
    payer: Keypair,
    provider: String,
    blockhash_cache: BlockhashCache,
}

#[async_trait]
impl ChainPusher for StorkChainPusher {
    async fn new(rpc_url: &str, payer_keypair: Keypair) -> Self {
        let rpc_client = RpcClient::new(rpc_url.to_string());
        let rpc_clone = rpc_client.get_inner_client().clone();

        StorkChainPusher {
            rpc_client,
            payer: payer_keypair,
            provider: "stork".to_string(),
            blockhash_cache: BlockhashCache::new(rpc_clone).await,
        }
    }

    async fn feeds_subscription_msg(
        &self,
        price_feeds: &[String],
    ) -> Result<String, Box<dyn std::error::Error>> {
        let subscribe_message = serde_json::json!({
            "type": "subscribe",
            "data": price_feeds,
        });
        Ok(serde_json::to_string(&subscribe_message).expect("Failed to serialize message"))
    }

    async fn process_update(&self, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        let updates = parse_price_update(message)?;
        self.send_price_updates(&updates).await
    }
}

impl StorkChainPusher {
    async fn send_price_updates(
        &self,
        updates: &Vec<UpdateData>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut ixs = vec![];
        for update in updates {
            let ix = update_price_feed(&self.payer.pubkey(), &self.provider, update);
            ixs.push(ix);
        }
        let tx = Transaction::new_signed_with_payer(
            &ixs,
            Some(&self.payer.pubkey()),
            &[&self.payer],
            self.blockhash_cache.get_blockhash().await,
        );

        let options = RpcSendTransactionConfig {
            skip_preflight: true,
            ..Default::default()
        };
        let rpc_client = self.rpc_client.get_inner_client().clone();
        tokio::spawn(async move {
            if let Ok(signature) = rpc_client.send_transaction_with_config(&tx, options).await {
                info!("\nTransaction sent: {}", signature);
            }
        });
        Ok(())
    }
}
