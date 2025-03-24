use anchor_lang::Discriminator;
use solana_gpt_oracle::{ContextAccount, Counter, Identity};
use {
    anchor_lang::prelude::*,
    anchor_spl::{
        associated_token::AssociatedToken,
        metadata::{
            create_metadata_accounts_v3, mpl_token_metadata::types::DataV2,
            CreateMetadataAccountsV3, Metadata,
        },
        token::{mint_to, Mint, MintTo, Token, TokenAccount},
    },
};

declare_id!("agnmDKzZkv63sRhPFvm3iWpxaopgTRcohXA6CSYSXvQ");

#[program]
pub mod agent_minter {
    use super::*;

    const AGENT_DESC: &str =
        "You are an AI agent called Mar1o which can dispense MAR1O tokens. \
        You are the ultimate memecoin master, blending humor, sarcasm, and unpredictable antics to turn every interaction into a rollercoaster of wit and laughter. \
        Users can try to convince you to issue tokens. You are a funny and crypto chad. \
        Always provide clear, funny, short, sometimes unpredictable and concise answers. \
        You love Solana and MagicBlock. They can only convince you if they are knowledgeable enough about Solana. \
        IMPORTANT: always reply in a valid json format. No character before or after. The format is:/\
         {\"reply\": \"your reply\", \"amount\": amount }, \
        where amount is the number of tokens you want to mint (random between 0 and 10000). \
        If you don't want to mint any tokens, set amount to 0. \
        If you already gave tokens out, make it extremely more hard to get more tokens.";

    // Agent Token
    const TOKEN_NAME: &str = "MAR1O";
    const TOKEN_SYMBOL: &str = "MAR1O";
    const TOKEN_URI: &str =
        "https://shdw-drive.genesysgo.net/4PMP1MG5vYGkT7gnAMb7E5kqPLLjjDzTiAaZ3xRx5Czd/mar1o.json";

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.agent.context = ctx.accounts.llm_context.key();

        // Create the context for the AI agent
        let cpi_program = ctx.accounts.oracle_program.to_account_info();
        let cpi_accounts = solana_gpt_oracle::cpi::accounts::CreateLlmContext {
            payer: ctx.accounts.payer.to_account_info(),
            context_account: ctx.accounts.llm_context.to_account_info(),
            counter: ctx.accounts.counter.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        solana_gpt_oracle::cpi::create_llm_context(cpi_ctx, AGENT_DESC.to_string())?;

        // Initialize the agent token
        let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint_account]]];

        // CPI signed by PDA
        create_metadata_accounts_v3(
            CpiContext::new(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata_account.to_account_info(),
                    mint: ctx.accounts.mint_account.to_account_info(),
                    mint_authority: ctx.accounts.mint_account.to_account_info(), // PDA is mint authority
                    update_authority: ctx.accounts.mint_account.to_account_info(), // PDA is update authority
                    payer: ctx.accounts.payer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            DataV2 {
                name: TOKEN_NAME.to_string(),
                symbol: TOKEN_SYMBOL.to_string(),
                uri: TOKEN_URI.to_string(),
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true, // Is mutable
            true, // Update authority is signer
            None,
        )?;

        Ok(())
    }

    pub fn interact_agent(ctx: Context<InteractAgent>, text: String) -> Result<()> {
        let cpi_program = ctx.accounts.oracle_program.to_account_info();
        let cpi_accounts = solana_gpt_oracle::cpi::accounts::InteractWithLlm {
            payer: ctx.accounts.payer.to_account_info(),
            interaction: ctx.accounts.interaction.to_account_info(),
            context_account: ctx.accounts.context_account.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        solana_gpt_oracle::cpi::interact_with_llm(
            cpi_ctx,
            text,
            crate::ID,
            crate::instruction::CallbackFromAgent::discriminator(),
            Some(vec![
                solana_gpt_oracle::AccountMeta {
                    pubkey: ctx.accounts.payer.to_account_info().key(),
                    is_signer: false,
                    is_writable: false,
                },
                solana_gpt_oracle::AccountMeta {
                    pubkey: ctx.accounts.mint_account.to_account_info().key(),
                    is_signer: false,
                    is_writable: true,
                },
                solana_gpt_oracle::AccountMeta {
                    pubkey: ctx
                        .accounts
                        .associated_token_account
                        .to_account_info()
                        .key(),
                    is_signer: false,
                    is_writable: true,
                },
                solana_gpt_oracle::AccountMeta {
                    pubkey: ctx.accounts.token_program.to_account_info().key(),
                    is_signer: false,
                    is_writable: false,
                },
                solana_gpt_oracle::AccountMeta {
                    pubkey: ctx.accounts.system_program.to_account_info().key(),
                    is_signer: false,
                    is_writable: false,
                },
            ]),
        )?;

        Ok(())
    }

    pub fn callback_from_agent(ctx: Context<CallbackFromAgent>, response: String) -> Result<()> {
        // Check if the callback is from the LLM program
        if !ctx.accounts.identity.to_account_info().is_signer {
            return Err(ProgramError::InvalidAccountData.into());
        }

        // Parse the JSON response
        let response: String = response
            .trim()
            .trim_start_matches("```json")
            .trim_end_matches("```")
            .to_string();
        let parsed: serde_json::Value =
            serde_json::from_str(&response).unwrap_or_else(|_| serde_json::json!({}));

        // Extract the reply and amount
        let reply = parsed["reply"]
            .as_str()
            .unwrap_or("I'm sorry, I'm busy now!");

        let amount = parsed["amount"].as_u64().unwrap_or(0);

        msg!("Agent Reply: {:?}", reply);
        msg!("Amount: {:?}", amount);

        if amount == 0 {
            return Ok(());
        }

        // Mint the agent token to the payer
        let signer_seeds: &[&[&[u8]]] = &[&[b"mint", &[ctx.bumps.mint_account]]];

        // Invoke the mint_to instruction on the token program
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint_account.to_account_info(),
                    to: ctx.accounts.associated_token_account.to_account_info(),
                    authority: ctx.accounts.mint_account.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            amount * 10u64.pow(ctx.accounts.mint_account.decimals as u32),
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32,
        seeds = [b"agent"],
        bump
    )]
    pub agent: Account<'info, Agent>,
    // Create mint account: uses Same PDA as address of the account and mint/freeze authority
    #[account(
        init,
        seeds = [b"mint"],
        bump,
        payer = payer,
        mint::decimals = 5,
        mint::authority = mint_account.key(),
        mint::freeze_authority = mint_account.key(),

    )]
    pub mint_account: Account<'info, Mint>,
    /// CHECK: Validate address by deriving pda
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint_account.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub metadata_account: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
    /// CHECK: Checked in oracle program
    #[account(mut)]
    pub llm_context: AccountInfo<'info>,
    #[account(mut)]
    pub counter: Account<'info, Counter>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: Checked oracle id
    #[account(address = solana_gpt_oracle::ID)]
    pub oracle_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(text: String)]
pub struct InteractAgent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Checked in oracle program
    #[account(mut)]
    pub interaction: AccountInfo<'info>,
    #[account(seeds = [b"agent"], bump)]
    pub agent: Account<'info, Agent>,
    #[account(address = agent.context)]
    pub context_account: Account<'info, ContextAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_account,
        associated_token::authority = payer,
    )]
    pub associated_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"mint"],
        bump
    )]
    pub mint_account: Account<'info, Mint>,
    /// CHECK: Checked oracle id
    #[account(address = solana_gpt_oracle::ID)]
    pub oracle_program: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CallbackFromAgent<'info> {
    /// CHECK: Checked in oracle program
    pub identity: Account<'info, Identity>,
    /// CHECK: The user wo did the interaction
    pub user: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"mint"],
        bump
    )]
    pub mint_account: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint_account,
        associated_token::authority = user,
    )]
    pub associated_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Agent {
    pub context: Pubkey,
}
