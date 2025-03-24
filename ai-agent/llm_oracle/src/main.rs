use anchor_lang::prelude::AccountMeta;
use anchor_lang::{AccountDeserialize, AnchorSerialize, Discriminator};
use chatgpt::client::ChatGPT;
use chatgpt::config::ModelConfiguration;
use chatgpt::types::{ChatMessage, CompletionResponse, Role};
use futures::StreamExt;
use memory::InteractionMemory;
use solana_account_decoder::UiAccountEncoding;
use solana_client::pubsub_client::PubsubClient;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::env;
use std::error::Error;
use std::str::FromStr;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

mod memory;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let (rpc_url, websocket_url, open_api_key, payer, identity_pda) = load_config();
    let mut interaction_memory = InteractionMemory::new(20);
    println!(" Oracle identity: {:?}", payer.pubkey());
    println!(" RPC: {:?}", rpc_url.as_str());
    println!(" WS: {:?}", websocket_url.as_str());
    loop {
        if let Err(e) = run_oracle(
            rpc_url.as_str(),
            websocket_url.as_str(),
            open_api_key.as_str(),
            &payer,
            &identity_pda,
            &mut interaction_memory,
        )
        .await
        {
            eprintln!("Error encountered: {:?}. Restarting...", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    }
}

async fn run_oracle(
    rpc_url: &str,
    websocket_url: &str,
    open_api_key: &str,
    payer: &Keypair,
    identity_pda: &Pubkey,
    interaction_memory: &mut InteractionMemory,
) -> Result<(), Box<dyn Error>> {
    let open_ai_client = ChatGPT::new_with_config(
        open_api_key,
        ModelConfiguration {
            engine: chatgpt::config::ChatGPTEngine::Custom("gpt-4o"),
            presence_penalty: 0.3,
            frequency_penalty: 0.3,
            max_tokens: Some(100),
            ..Default::default()
        },
    )?;
    let rpc_client = RpcClient::new_with_commitment(rpc_url, CommitmentConfig::processed());

    let (tx, rx) = mpsc::channel(100);
    let mut stream = ReceiverStream::new(rx);

    let rpc_config = RpcAccountInfoConfig {
        commitment: Some(CommitmentConfig::processed()),
        encoding: Some(UiAccountEncoding::Base64),
        ..Default::default()
    };

    let filters = vec![solana_client::rpc_filter::RpcFilterType::Memcmp(
        solana_client::rpc_filter::Memcmp::new(
            0,
            solana_client::rpc_filter::MemcmpEncodedBytes::Bytes(
                solana_gpt_oracle::Interaction::discriminator().to_vec(),
            ),
        ),
    )];

    fetch_and_process_program_accounts(
        &rpc_client,
        filters.clone(),
        payer,
        identity_pda,
        &open_ai_client,
        interaction_memory,
    )
    .await?;

    let program_config = RpcProgramAccountsConfig {
        account_config: rpc_config,
        filters: Some(filters),
        ..Default::default()
    };

    let subscription = PubsubClient::program_subscribe(
        &websocket_url,
        &solana_gpt_oracle::ID,
        Some(program_config),
    )?;

    tokio::spawn(async move {
        for update in subscription.1 {
            if tx.send(update).await.is_err() {
                eprintln!("Receiver dropped");
                break;
            }
        }
    });

    while let Some(update) = stream.next().await {
        if let Ok(interaction_pubkey) = Pubkey::from_str(&update.value.pubkey) {
            if let Some(data) = update.value.account.data.decode() {
                process_interaction(
                    payer,
                    identity_pda,
                    &open_ai_client,
                    &rpc_client,
                    interaction_pubkey,
                    data,
                    interaction_memory,
                )
                .await?;
            }
        }
    }

    Ok(())
}

/// Process an interaction and respond to it
async fn process_interaction(
    payer: &Keypair,
    identity_pda: &Pubkey,
    open_ai_client: &ChatGPT,
    rpc_client: &RpcClient,
    interaction_pubkey: Pubkey,
    data: Vec<u8>,
    interaction_memory: &mut InteractionMemory,
) -> Result<(), Box<dyn Error>> {
    if let Ok(interaction) =
        solana_gpt_oracle::Interaction::try_deserialize_unchecked(&mut data.as_slice())
    {
        if interaction.is_processed == true {
            return Ok(());
        }
        println!("Processing interaction: {:?}", interaction_pubkey);
        if let Ok(context_data) = rpc_client.get_account(&interaction.context) {
            if let Ok(context) = solana_gpt_oracle::ContextAccount::try_deserialize_unchecked(
                &mut context_data.data.as_slice(),
            ) {
                println!(
                    "Interaction: {:?}, Pubkey: {:?}",
                    interaction, interaction_pubkey
                );

                // Get a response from the OpenAI API
                let mut previous_history = interaction_memory
                    .get_history(&interaction_pubkey)
                    .unwrap_or(Vec::new())
                    .clone();
                interaction_memory.add_interaction(
                    interaction_pubkey,
                    interaction.text.clone(),
                    Role::User,
                );
                previous_history.push(ChatMessage {
                    role: Role::User,
                    content: format!(
                        "With context: {:?}, respond to: {:?}",
                        context.text, interaction.text
                    ),
                });
                let response: CompletionResponse =
                    open_ai_client.send_history(&previous_history).await?;
                let response = response.message().content.clone();
                interaction_memory.add_interaction(
                    interaction_pubkey,
                    response.clone(),
                    Role::System,
                );

                let response_data = [
                    solana_gpt_oracle::instruction::CallbackFromLlm::discriminator().to_vec(),
                    response.try_to_vec()?,
                ]
                .concat();

                let mut callback_instruction = Instruction {
                    program_id: solana_gpt_oracle::ID,
                    accounts: vec![
                        AccountMeta::new(payer.pubkey(), true),
                        AccountMeta::new_readonly(*identity_pda, false),
                        AccountMeta::new(interaction_pubkey, false),
                        AccountMeta::new_readonly(interaction.callback_program_id, false),
                    ],
                    data: response_data,
                };

                // Add the remaining accounts from the callback_account_metas
                let remaining_accounts: Vec<AccountMeta> = interaction
                    .callback_account_metas
                    .iter()
                    .map(|meta| AccountMeta {
                        pubkey: meta.pubkey,
                        is_signer: meta.is_signer,
                        is_writable: meta.is_writable,
                    })
                    .collect();
                callback_instruction.accounts.extend(remaining_accounts);

                // Send the response with the callback transaction
                if let Ok(recent_blockhash) =
                    rpc_client.get_latest_blockhash_with_commitment(CommitmentConfig::confirmed())
                {
                    let compute_budget_instruction =
                        ComputeBudgetInstruction::set_compute_unit_limit(300_000);
                    let priority_fee_instruction =
                        ComputeBudgetInstruction::set_compute_unit_price(1_000_000);

                    let transaction = Transaction::new_signed_with_payer(
                        &[
                            compute_budget_instruction,
                            priority_fee_instruction,
                            callback_instruction,
                        ],
                        Some(&payer.pubkey()),
                        &[&payer],
                        recent_blockhash.0,
                    );

                    match rpc_client.send_and_confirm_transaction(&transaction) {
                        Ok(signature) => {
                            println!("Transaction signature: {}\n", signature)
                        }
                        Err(e) => eprintln!("Failed to send transaction: {:?}\n", e),
                    }
                }
            }
        }
    }
    Ok(())
}

/// Fetch all open interactions and process them
async fn fetch_and_process_program_accounts(
    rpc_client: &RpcClient,
    filters: Vec<solana_client::rpc_filter::RpcFilterType>,
    payer: &Keypair,
    identity_pda: &Pubkey,
    open_ai_client: &ChatGPT,
    interaction_memory: &mut InteractionMemory,
) -> Result<(), Box<dyn Error>> {
    let rpc_config = RpcAccountInfoConfig {
        commitment: Some(CommitmentConfig::processed()),
        encoding: Some(UiAccountEncoding::Base64),
        ..Default::default()
    };

    let program_config = RpcProgramAccountsConfig {
        account_config: rpc_config,
        filters: Some(filters),
        ..Default::default()
    };

    let accounts =
        rpc_client.get_program_accounts_with_config(&solana_gpt_oracle::ID, program_config)?;

    for (pubkey, account) in accounts {
        process_interaction(
            payer,
            identity_pda,
            open_ai_client,
            rpc_client,
            pubkey,
            account.data,
            interaction_memory,
        )
        .await?;
    }

    Ok(())
}

/// Load the Oracle configuration
fn load_config() -> (String, String, String, Keypair, Pubkey) {
    let identity = env::var("IDENTITY").unwrap_or(
        "62LxqpAW6SWhp7iKBjCQneapn1w6btAhW7xHeREWSpPzw3xZbHCfAFesSR4R76ejQXCLWrndn37cKCCLFvx6Swps"
            .to_string(),
    );
    let rpc_url = env::var("RPC_URL").unwrap_or("http://localhost:8899".to_string());
    let websocket_url = env::var("WEBSOCKET_URL").unwrap_or("ws://localhost:8900".to_string());
    let open_api_key = env::var("OPENAI_API_KEY").unwrap_or("OPENAI_API_KEY not set".to_string());
    let payer = Keypair::from_base58_string(&identity);
    let identity_pda = Pubkey::find_program_address(&[b"identity"], &solana_gpt_oracle::ID).0;
    (rpc_url, websocket_url, open_api_key, payer, identity_pda)
}
