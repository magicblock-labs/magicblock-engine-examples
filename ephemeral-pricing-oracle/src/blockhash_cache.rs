use solana_client::nonblocking;
use solana_sdk::hash::Hash;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct BlockhashCache {
    inner: Arc<RwLock<CacheData>>,
    client: Arc<nonblocking::rpc_client::RpcClient>,
}

struct CacheData {
    blockhash: Hash,
    timestamp: Instant,
    counter: u8,
}

impl BlockhashCache {
    pub async fn new(client: Arc<nonblocking::rpc_client::RpcClient>) -> Self {
        let initial_blockhash = client.get_latest_blockhash().await.unwrap();
        let inner = Arc::new(RwLock::new(CacheData {
            blockhash: initial_blockhash,
            timestamp: Instant::now(),
            counter: 0,
        }));

        let cache = Self { inner, client };

        cache.spawn_refresh_task();
        cache
    }

    fn spawn_refresh_task(&self) {
        let inner = self.inner.clone();
        let client = self.client.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;

                let should_refresh = {
                    let cache = inner.read().await;
                    cache.counter >= 10 || cache.timestamp.elapsed() > Duration::from_secs(60)
                };

                if should_refresh {
                    if let Ok(new_blockhash) = client.get_latest_blockhash().await {
                        let mut cache = inner.write().await;
                        cache.blockhash = new_blockhash;
                        cache.timestamp = Instant::now();
                        cache.counter = 0;
                    }
                }
            }
        });
    }

    pub async fn get_blockhash(&self) -> Hash {
        let mut cache = self.inner.write().await;
        cache.counter = (cache.counter + 1) % 11;
        cache.blockhash
    }
}
