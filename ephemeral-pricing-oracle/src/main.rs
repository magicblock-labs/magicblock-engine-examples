mod args;
mod blockhash_cache;
mod instructions;
mod types;

mod stork {
    pub mod chain_pusher;
    pub mod price_parser;
}
mod pyth_lazer {
    pub mod chain_pusher;
    pub mod price_parser;
}

use bytes::BytesMut;
use clap::Parser;
use native_tls::TlsConnector as NativeTlsConnector;
use ratchet_rs::{
    deflate::DeflateExtProvider, HeaderValue, Message, PayloadType, TryIntoRequest, UpgradedClient,
    WebSocketClientBuilder, WebSocketStream,
};
use solana_sdk::signature::{Keypair, Signer};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::time::{self, Duration};
use tokio_native_tls::TlsConnector;
use tracing::{debug, error, info, warn};
use url::Url;

use crate::args::{
    get_auth_header, get_price_feeds, get_private_key, get_solana_cluster, get_ws_url, Args,
};
use crate::pyth_lazer::chain_pusher::PythChainPusher;
use crate::stork::chain_pusher::StorkChainPusher;
use crate::types::ChainPusher;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();
    dotenvy::dotenv().ok();
    let args = Args::parse();
    let private_key = get_private_key(args.private_key);
    let auth_header = get_auth_header(args.auth_header);
    let ws_url = get_ws_url(args.ws_url);
    let cluster_url = get_solana_cluster(args.cluster);
    let price_feeds = get_price_feeds(args.price_feeds);

    let payer = Keypair::from_base58_string(&private_key);
    info!(wallet_pubkey = ?payer.pubkey(), "Identity initialized");

    let chain_pusher: Arc<dyn ChainPusher> = if ws_url.contains("stork") {
        Arc::new(StorkChainPusher::new(&cluster_url, payer).await)
    } else {
        Arc::new(PythChainPusher::new(&cluster_url, payer).await)
    };

    loop {
        if let Err(e) =
            run_websocket_client(&chain_pusher, &ws_url, &auth_header, &price_feeds).await
        {
            error!(error = ?e, "WebSocket connection error, attempting reconnection");
        }
        time::sleep(Duration::from_secs(5)).await;
    }
}

async fn run_websocket_client(
    chain_pusher: &Arc<dyn ChainPusher>,
    url: &str,
    auth_header: &str,
    price_feeds: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    info!(url = %url, "Establishing WebSocket connection");

    let url = Url::parse(url)?;
    let host = url.host_str().ok_or("Missing host in URL")?;
    let address = format!("{}:{}", host, url.port().unwrap_or(443));
    let stream = TcpStream::connect(address).await?;

    let mut request = url.clone().try_into_request()?;
    request
        .headers_mut()
        .insert("AUTHORIZATION", HeaderValue::from_str(auth_header)?);

    let stream: Box<dyn WebSocketStream> = if url.scheme() == "wss" {
        let tls_connector = TlsConnector::from(NativeTlsConnector::new()?);
        Box::new(tls_connector.connect(host, stream).await?)
    } else {
        Box::new(stream)
    };

    let upgraded = WebSocketClientBuilder::default()
        .extension(DeflateExtProvider::default())
        .subscribe(stream, request)
        .await?;

    let UpgradedClient { mut websocket, .. } = upgraded;
    info!("WebSocket connected.");

    let mut buf = BytesMut::new();
    let message_text = chain_pusher.feeds_subscription_msg(price_feeds).await?;
    websocket
        .write(message_text.as_bytes(), PayloadType::Text)
        .await?;

    info!("Subscribed to price feeds.");

    while let Ok(message) = websocket.read(&mut buf).await {
        match message {
            Message::Text => match chain_pusher
                .process_update(&String::from_utf8_lossy(&buf))
                .await
            {
                Ok(..) => debug!("Processed price updates"),
                Err(e) => warn!(error = ?e, "Failed to parse price update"),
            },
            Message::Close(_) => return Err("WebSocket closed".into()),
            _ => {}
        }
        buf.clear();
    }
    Ok(())
}
