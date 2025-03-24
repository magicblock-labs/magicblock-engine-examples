use crate::blockhash_cache::BlockhashCache;
use crate::instructions::update_price_feed;
use crate::pyth_lazer::price_parser::parse_price_update;
use crate::types::{ChainPusher, UpdateData};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use tracing::info;

pub struct PythChainPusher {
    rpc_client: RpcClient,
    payer: Keypair,
    provider: String,
    blockhash_cache: BlockhashCache,
}

#[async_trait]
impl ChainPusher for PythChainPusher {
    async fn new(rpc_url: &str, payer_keypair: Keypair) -> Self {
        let rpc_client = RpcClient::new(rpc_url.to_string());
        let rpc_clone = rpc_client.get_inner_client().clone();

        PythChainPusher {
            rpc_client,
            payer: payer_keypair,
            provider: "pyth-lazer".to_string(),
            blockhash_cache: BlockhashCache::new(rpc_clone).await,
        }
    }

    async fn feeds_subscription_msg(
        &self,
        price_feeds: &[String],
    ) -> Result<String, Box<dyn std::error::Error>> {
        let symbols = PythChainPusher::get_pyth_symbols().await?;
        let price_feed_ids: Vec<i32> = price_feeds
            .iter()
            .filter_map(|feed| {
                symbols
                    .iter()
                    .find(|symbol| symbol.name == *feed)
                    .map(|symbol| symbol.pyth_lazer_id)
            })
            .collect();
        let subscribe_message = serde_json::json!({
            "type": "subscribe",
            "subscriptionId": 0,
            "priceFeedIds": price_feed_ids,
            "properties": ["price"],
            "chains": ["solana"],
            "channel": "real_time"
        });
        Ok(serde_json::to_string(&subscribe_message).expect("Failed to serialize message"))
    }

    async fn process_update(&self, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        let updates = parse_price_update(message)?;
        self.send_price_updates(&updates).await
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PythSymbol {
    pyth_lazer_id: i32,
    name: String,
    symbol: String,
    description: String,
    asset_type: String,
    exponent: i32,
    cmc_id: i32,
}

impl PythChainPusher {
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

    async fn get_pyth_symbols() -> Result<Vec<PythSymbol>, reqwest::Error> {
        let symbols = reqwest::Client::new()
            .get("https://pyth-lazer-staging.dourolabs.app/history/v1/symbols")
            .send()
            .await?
            .json::<Vec<PythSymbol>>()
            .await?;
        Ok(symbols)
    }
}
