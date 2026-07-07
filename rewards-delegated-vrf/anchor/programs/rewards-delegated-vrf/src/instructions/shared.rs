use anchor_lang::prelude::*;
use anchor_lang::InstructionData;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::metadata::mpl_token_metadata;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ephem::CallHandler, ActionArgs, ShortAccountMeta};

use crate::errors::RewardError;
use crate::state::{RewardType, SourceKind, TransferLookupTable};

/// Workaround for ephemeral-rollups-sdk ≥0.11: `MagicIntentBundleBuilder::build()`
/// copies `is_signer` verbatim from each input AccountInfo
/// (ephem/mod.rs:233). For PDA payers and PDA escrow authorities that arrive via
/// callbacks (e.g. VRF) with `is_signer=false`, the SDK then builds the Magic
/// CPI with `is_signer=false` — and Magic rejects with `MissingRequiredSignature`.
/// We return a fresh AccountInfo with `is_signer=true`; the seeds passed to
/// `build_and_invoke_signed` give the runtime authority to honor the claim.
///
/// Inconsistent with the same builder's `build_callback_ixs`, which already
/// hardcodes `is_signer=true` for the payer (ephem/mod.rs:189). Remove once the
/// SDK applies the same convention in `build()`.
fn as_signer<'info>(signer: AccountInfo<'info>) -> AccountInfo<'info> {
    AccountInfo {
        is_signer: true,
        ..signer
    }
}

/// Which PDA owns the source ATA — and therefore which seed components
/// the post-commit handler signs with. Both source kinds share a single
/// `transfer_spl_token` / `transfer_programmable_nft` post-commit handler;
/// the kind + second-seed pubkey + bump are passed via instruction data
/// so the handler can derive the correct signer seeds at runtime without
/// needing a typed `Account` field in its context.
pub enum TransferSource<'info> {
    RewardDistributor {
        authority: AccountInfo<'info>,
    },
    WhitelistDistributor {
        authority: AccountInfo<'info>,
    },
}

impl<'info> TransferSource<'info> {
    fn authority_key(&self) -> Pubkey {
        match self {
            Self::RewardDistributor { authority } => authority.key(),
            Self::WhitelistDistributor { authority } => authority.key(),
        }
    }

    fn authority_info(&self) -> AccountInfo<'info> {
        match self {
            Self::RewardDistributor { authority } => authority.clone(),
            Self::WhitelistDistributor { authority } => authority.clone(),
        }
    }

    fn kind(&self) -> SourceKind {
        match self {
            Self::RewardDistributor { .. } => SourceKind::RewardDistributor,
            Self::WhitelistDistributor { .. } => SourceKind::WhitelistDistributor,
        }
    }

    fn spl_token_instruction_data(&self, amount: u64) -> Vec<u8> {
        crate::instruction::TransferSplToken {
            amount,
            source: self.kind(),
        }
        .data()
    }

    fn programmable_nft_instruction_data(&self, amount: u64) -> Vec<u8> {
        crate::instruction::TransferProgrammableNft {
            amount,
            source: self.kind(),
        }
        .data()
    }
}

pub fn schedule_transfer_action<'info>(
    source: TransferSource<'info>,
    transfer_lookup_table: &Account<'info, TransferLookupTable>,
    reward_list: &AccountInfo<'info>,
    magic_context: &AccountInfo<'info>,
    magic_program: &AccountInfo<'info>,
    mint: Pubkey,
    reward_type: RewardType,
    ruleset_pda: Option<Pubkey>,
    amount: u64,
    payer: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    magic_fee_vault: AccountInfo<'info>,
    // Seeds for PDA signing — reward_list is the payer so it must sign via
    // seeds, and the escrow authority (reward_distributor OR whitelist_distributor
    // depending on `source`) is also a PDA so its seeds are bundled here too.
    payer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let token_program = transfer_lookup_table.lookup_accounts[0];
    let ata_program = transfer_lookup_table.lookup_accounts[1];
    let system_program = transfer_lookup_table.lookup_accounts[2];
    let token_metadata_program = transfer_lookup_table.lookup_accounts[3];
    let sysvar_instructions_program = transfer_lookup_table.lookup_accounts[4];
    let auth_rule_program = transfer_lookup_table.lookup_accounts[5];

    // See `as_signer` doc — both PDAs sign the Magic CPI via `payer_seeds`.
    let payer = as_signer(payer);
    let source_authority_key = source.authority_key();
    msg!(
        "Scheduling transfer of mint: {} | amount: {} | source: {} | destination: {}",
        mint,
        amount,
        source_authority_key,
        destination.key()
    );

    match reward_type {
        RewardType::SplToken | RewardType::LegacyNft => {
            let instruction_data = source.spl_token_instruction_data(amount);

            let source_token_address =
                get_associated_token_address(&source_authority_key, &mint);
            let destination_token_address = get_associated_token_address(&destination.key(), &mint);

            let action_args = ActionArgs::new(instruction_data);
            let action_accounts = vec![
                ShortAccountMeta {
                    pubkey: token_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: source_token_address.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: mint,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: destination_token_address,
                    is_writable: true,
                },
                // source_authority — RewardDistributor or WhitelistDistributor
                // PDA. The handler reads its on-chain data to recover the
                // bump + second-seed and uses them to sign the SPL CPI.
                ShortAccountMeta {
                    pubkey: source_authority_key,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: destination.key(),
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: ata_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: system_program,
                    is_writable: false,
                },
            ];

            let action = CallHandler {
                destination_program: crate::ID,
                accounts: action_accounts,
                args: action_args,
                escrow_authority: as_signer(source.authority_info()),
                compute_units: 200_000,
            };

            MagicIntentBundleBuilder::new(
                payer.to_account_info(),
                magic_context.to_account_info(),
                magic_program.to_account_info(),
            )
            .magic_fee_vault(magic_fee_vault.to_account_info())
            .commit(&[reward_list.to_account_info()])
            .add_post_commit_actions([action])
            .build_and_invoke_signed(payer_seeds)?;
        }
        RewardType::ProgrammableNft => {
            let instruction_data = source.programmable_nft_instruction_data(amount);

            let source_token_address =
                get_associated_token_address(&source_authority_key, &mint);
            let destination_token_address = get_associated_token_address(&destination.key(), &mint);

            let (metadata_pda, _) = mpl_token_metadata::accounts::Metadata::find_pda(&mint);
            let (edition_pda, _) = mpl_token_metadata::accounts::MasterEdition::find_pda(&mint);
            let (source_token_record_pda, _) =
                mpl_token_metadata::accounts::TokenRecord::find_pda(&mint, &source_token_address);
            let (destination_token_record_pda, _) =
                mpl_token_metadata::accounts::TokenRecord::find_pda(
                    &mint,
                    &destination_token_address,
                );

            let auth_rule_pda = ruleset_pda.ok_or(RewardError::InvalidRewardType)?;

            let action_args = ActionArgs::new(instruction_data);
            let action_accounts = vec![
                ShortAccountMeta {
                    pubkey: token_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: source_token_address.key(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: mint,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: destination_token_address,
                    is_writable: true,
                },
                // source_authority — see SPL/LegacyNFT branch comment.
                ShortAccountMeta {
                    pubkey: source_authority_key,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: destination.key(),
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: ata_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: system_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: token_metadata_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: sysvar_instructions_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: auth_rule_program,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: metadata_pda,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: edition_pda,
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: source_token_record_pda,
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: destination_token_record_pda,
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: auth_rule_pda,
                    is_writable: false,
                },
            ];

            let action = CallHandler {
                destination_program: crate::ID,
                accounts: action_accounts,
                args: action_args,
                escrow_authority: as_signer(source.authority_info()),
                compute_units: 200_000,
            };

            MagicIntentBundleBuilder::new(
                payer.to_account_info(),
                magic_context.to_account_info(),
                magic_program.to_account_info(),
            )
            .magic_fee_vault(magic_fee_vault.to_account_info())
            .commit(&[reward_list.to_account_info()])
            .add_post_commit_actions([action])
            .build_and_invoke_signed(payer_seeds)?;
        }
        _ => return Err(RewardError::UnsupportedAssetType.into()),
    }

    Ok(())
}
