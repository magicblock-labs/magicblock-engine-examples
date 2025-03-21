use anchor_lang::prelude::ProgramError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use ephemeral_rollups_sdk::anchor::{delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

declare_id!("LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab");

const ORACLE_IDENTITY: Pubkey = pubkey!("A1ooMmN1fz6LbEFrjh6GukFS2ZeRYFzdyFjeafyyS7Ca");

#[ephemeral]
#[program]
pub mod solana_gpt_oracle {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    pub fn create_llm_context(ctx: Context<CreateLlmContext>, text: String) -> Result<()> {
        let context_account = &mut ctx.accounts.context_account;
        context_account.text = text;
        ctx.accounts.counter.count += 1;
        Ok(())
    }

    pub fn interact_with_llm(
        ctx: Context<InteractWithLlm>,
        text: String,
        callback_program_id: Pubkey,
        callback_discriminator: [u8; 8],
        account_metas: Option<Vec<AccountMeta>>,
    ) -> Result<()> {
        let interaction = &mut ctx.accounts.interaction;
        let current_len = interaction.to_account_info().data_len();
        let space = Interaction::space(&text, account_metas.as_ref().map_or(0, |m| m.len()));
        let rent = Rent::get()?;

        let mut additional_rent = rent.minimum_balance(space);

        let interaction_info = interaction.to_account_info();
        let payer_info = ctx.accounts.payer.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();

        if interaction_info.owner.eq(&anchor_lang::system_program::ID) {
            let create_instruction =
                anchor_lang::solana_program::system_instruction::create_account(
                    &ctx.accounts.payer.key(),
                    &interaction.key(),
                    additional_rent,
                    space as u64,
                    &crate::ID,
                );

            let payer = ctx.accounts.payer.key();
            let context_account = ctx.accounts.context_account.key();
            let signer_seeds: &[&[&[u8]]] = &[&[
                Interaction::seed(),
                payer.as_ref(),
                context_account.as_ref(),
                &[ctx.bumps.interaction],
            ]];

            anchor_lang::solana_program::program::invoke_signed(
                &create_instruction,
                &[
                    payer_info.clone(),
                    interaction_info.clone(),
                    system_program_info.clone(),
                ],
                signer_seeds,
            )?;
        } else {
            additional_rent = additional_rent.saturating_sub(rent.minimum_balance(current_len));
            interaction_info.realloc(space, false)?;
            if additional_rent > 0 {
                let cpi_context = CpiContext::new(
                    system_program_info,
                    anchor_lang::system_program::Transfer {
                        from: payer_info.clone(),
                        to: interaction_info.clone(),
                    },
                );
                anchor_lang::system_program::transfer(cpi_context, additional_rent)?;
            }
        }

        let mut interaction_data = interaction.try_borrow_mut_data()?;
        let mut interaction =
            Interaction::try_deserialize_unchecked(&mut interaction_data.as_ref())
                .unwrap_or_default();

        interaction.context = ctx.accounts.context_account.key();
        interaction.user = ctx.accounts.payer.key();
        interaction.text = text;
        interaction.callback_program_id = callback_program_id;
        interaction.callback_discriminator = callback_discriminator;
        interaction.callback_account_metas = account_metas.unwrap_or_default();
        interaction.is_processed = false;

        interaction.try_serialize(&mut interaction_data.as_mut())?;
        Ok(())
    }

    pub fn callback_from_llm<'info>(
        ctx: Context<'_, '_, '_, 'info, CallbackFromLlm<'info>>,
        response: String,
    ) -> Result<()> {
        let response_data = [
            ctx.accounts.interaction.callback_discriminator.to_vec(),
            response.try_to_vec()?,
        ]
        .concat();

        // Prepare accounts metas
        let mut accounts_metas: Vec<anchor_lang::solana_program::instruction::AccountMeta> =
            vec![anchor_lang::solana_program::instruction::AccountMeta {
                pubkey: ctx.accounts.identity.key(),
                is_signer: true,
                is_writable: false,
            }];
        accounts_metas.extend(
            ctx.accounts
                .interaction
                .callback_account_metas
                .iter()
                .map(
                    |meta| anchor_lang::solana_program::instruction::AccountMeta {
                        pubkey: meta.pubkey,
                        is_signer: meta.is_signer,
                        is_writable: meta.is_writable,
                    },
                ),
        );

        // Verify payer is not in remaining accounts
        if ctx
            .remaining_accounts
            .iter()
            .any(|acc| acc.key().eq(&ctx.accounts.payer.key()))
        {
            return Err(ProgramError::InvalidAccountData.into());
        }

        // Set processed flag
        ctx.accounts.interaction.is_processed = true;

        // CPI to the callback program
        let instruction = Instruction {
            program_id: ctx.accounts.program.key(),
            accounts: accounts_metas,
            data: response_data.to_vec(),
        };
        let mut remaining_accounts: Vec<AccountInfo<'info>> = ctx.remaining_accounts.to_vec();
        remaining_accounts.push(ctx.accounts.identity.to_account_info());
        remaining_accounts.push(ctx.accounts.program.to_account_info());
        let identity_bump = ctx.bumps.identity;
        invoke_signed(
            &instruction,
            &remaining_accounts,
            &[&[b"identity", &[identity_bump]]],
        )?;
        Ok(())
    }

    pub fn callback_from_oracle(ctx: Context<CallbackFromOracle>, response: String) -> Result<()> {
        if !ctx.accounts.identity.to_account_info().is_signer {
            return Err(ProgramError::InvalidAccountData.into());
        }
        msg!("Callback response: {:?}", response);
        Ok(())
    }

    pub fn delegate_interaction(ctx: Context<DelegateInteraction>) -> Result<()> {
        ctx.accounts.delegate_interaction(
            &ctx.accounts.payer,
            &[
                Interaction::seed(),
                &ctx.accounts.payer.key().to_bytes(),
                &ctx.accounts.context_account.key().to_bytes(),
            ],
            DelegateConfig::default(),
        )?;
        Ok(())
    }
}

/// Contexts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8,
        seeds = [b"identity"],
        bump
    )]
    pub identity: Account<'info, Identity>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32,
        seeds = [b"counter"],
        bump
    )]
    pub counter: Account<'info, Counter>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(text: String)]
pub struct CreateLlmContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut,
        seeds = [b"counter"],
        bump
    )]
    pub counter: Account<'info, Counter>,
    #[account(
        init,
        payer = payer,
        space = 8 + text.as_bytes().len() + 8,
        seeds = [ContextAccount::seed(), &counter.count.to_le_bytes()],
        bump
    )]
    pub context_account: Account<'info, ContextAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(text: String, callback_program_id: Pubkey, callback_discriminator: [u8; 8], account_metas: Option<Vec<AccountMeta>>)]
pub struct InteractWithLlm<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the correct interaction account
    #[account(
        mut,
        seeds = [Interaction::seed(), payer.key().as_ref(), context_account.key().as_ref()],
        bump
    )]
    pub interaction: AccountInfo<'info>,
    /// CHECK: we accept any context
    pub context_account: Account<'info, ContextAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CallbackFromLlm<'info> {
    #[account(mut, address = ORACLE_IDENTITY)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"identity"], bump)]
    pub identity: Account<'info, Identity>,
    /// CHECK: we accept any context
    #[account(mut)]
    pub interaction: Account<'info, Interaction>,
    /// CHECK: the callback program
    pub program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CallbackFromOracle<'info> {
    #[account(seeds = [b"identity"], bump)]
    pub identity: Account<'info, Identity>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateInteraction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the correct interaction account
    #[account(
        mut, del,
        seeds = [Interaction::seed(), payer.key().as_ref(), context_account.key().as_ref()],
        bump
    )]
    pub interaction: AccountInfo<'info>,
    /// CHECK: we accept any context
    pub context_account: Account<'info, ContextAccount>,
}

/// Accounts

#[account]
pub struct ContextAccount {
    pub text: String,
}

impl ContextAccount {
    pub fn seed() -> &'static [u8] {
        b"test-context"
    }
}

#[account]
#[derive(Default, Debug)]
pub struct Interaction {
    pub context: Pubkey,
    pub user: Pubkey,
    pub text: String,
    pub callback_program_id: Pubkey,
    pub callback_discriminator: [u8; 8],
    pub callback_account_metas: Vec<AccountMeta>,
    pub is_processed: bool,
}

impl Interaction {
    pub fn seed() -> &'static [u8] {
        b"interaction"
    }

    pub fn space(text: &String, account_metas_len: usize) -> usize {
        121 + text.as_bytes().len() + account_metas_len * AccountMeta::size()
    }
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccountMeta {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

impl AccountMeta {
    pub fn size() -> usize {
        8 + AccountMeta::INIT_SPACE
    }
}

#[account]
pub struct Counter {
    pub count: u32,
}

#[account]
pub struct Identity {}
