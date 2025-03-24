use clap::Parser;
use solana_sdk::signature::Keypair;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
pub struct Args {
    #[arg(long, help = "Private key for the Solana wallet")]
    pub private_key: Option<String>,
    #[arg(long, help = "Authorization header for the WebSocket connection")]
    pub auth_header: Option<String>,
    #[arg(long, help = "WebSocket URL for the price feed")]
    pub ws_url: Option<String>,
    #[arg(long, help = "Solana cluster URL")]
    pub cluster: Option<String>,
    #[arg(long, help = "Comma-separated list of price feeds")]
    pub price_feeds: Option<String>,
}

pub fn get_ws_url(cli_url: Option<String>) -> String {
    std::env::var("ORACLE_WS_URL")
        .ok()
        .or(cli_url)
        .unwrap_or_else(|| "ws://localhost:8765".to_string())
}

pub fn get_auth_header(cli_auth: Option<String>) -> String {
    std::env::var("ORACLE_AUTH_HEADER")
        .ok()
        .or(cli_auth)
        .expect(
            "ORACLE_AUTH_HEADER environment variable or --auth-header argument must be provided",
        )
}

pub fn get_solana_cluster(cli_cluster: Option<String>) -> String {
    std::env::var("SOLANA_CLUSTER")
        .ok()
        .or(cli_cluster)
        .unwrap_or_else(|| "https://devnet.magicblock.app/".to_string())
}

pub fn get_price_feeds(cli_feeds: Option<String>) -> Vec<String> {
    std::env::var("ORACLE_PRICE_FEEDS")
        .ok()
        .or(cli_feeds)
        .unwrap_or_else(|| "SOLUSD".to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .collect()
}

pub fn get_private_key(cli_key: Option<String>) -> String {
    std::env::var("ORACLE_PRIVATE_KEY")
        .ok()
        .or(cli_key)
        .unwrap_or(Keypair::new().to_base58_string())
}
