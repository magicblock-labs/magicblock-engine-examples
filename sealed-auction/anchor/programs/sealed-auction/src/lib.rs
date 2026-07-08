use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_lang::system_program::{transfer as transfer_lamports, Transfer as LamportsTransfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi},
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, AUTHORITY_FLAG, PERMISSION_SEED,
            TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{commit, delegate, ephemeral, ephemeral_accounts},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
};

mod error;
mod state;

use error::ErrorCode;
use state::{Auction, AuctionStatus, Bid, MAX_BIDDERS};

declare_id!("F4vB5Ki7ZWnkht1shp2TCHG7GszLxRZ6pbizGNQecmor");

pub const AUCTION_SEED: &[u8] = b"auction";
pub const BID_SEED: &[u8] = b"bid";
pub const EPHEMERAL_SPL_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
pub const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

#[ephemeral]
#[program]
pub mod sealed_auction {
    use super::*;

    pub fn initialize_auction(
        ctx: Context<InitializeAuction>,
        auction_id: u64,
        lot_amount: u64,
        deadline_ts: i64,
        sponsor_lamports: u64,
    ) -> Result<()> {
        require!(lot_amount > 0, ErrorCode::InvalidAmount);
        require!(
            deadline_ts > Clock::get()?.unix_timestamp,
            ErrorCode::DeadlineInPast
        );

        transfer_lamports(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                LamportsTransfer {
                    from: ctx.accounts.auctioneer.to_account_info(),
                    to: ctx.accounts.auction.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(
                MAX_BIDDERS + 1,
            ) as u32)
            .checked_add(sponsor_lamports)
            .ok_or(ErrorCode::InvalidAmount)?,
        )?;

        let auction_key = ctx.accounts.auction.key();
        let auction = &mut ctx.accounts.auction;
        auction.auctioneer = ctx.accounts.auctioneer.key();
        auction.auction_id = auction_id;
        auction.token_a_mint = ctx.accounts.token_a_mint.key();
        auction.token_b_mint = ctx.accounts.token_b_mint.key();
        auction.lot_amount = lot_amount;
        auction.deadline_ts = deadline_ts;
        auction.bid_count = 0;
        auction.closed_bid_count = 0;
        auction.highest_bid = 0;
        auction.highest_bidder = Pubkey::default();
        auction.status = AuctionStatus::Open;
        auction.lot_claimed = false;
        auction.bump = ctx.bumps.auction;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.seller_token_a_account.to_account_info(),
                    to: ctx.accounts.auction_token_a_account.to_account_info(),
                    authority: ctx.accounts.auctioneer.to_account_info(),
                },
            ),
            lot_amount,
        )?;

        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        init_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.auction_token_b_ephemeral_ata,
            ctx.accounts.auction.to_account_info(),
            &ctx.accounts.token_b_mint,
            &ctx.accounts.auctioneer,
            &ctx.accounts.system_program,
        )?;
        delegate_ephemeral_ata(
            &ctx.accounts.ephemeral_token_program,
            &ctx.accounts.auctioneer,
            &ctx.accounts.auction_token_b_ephemeral_ata,
            &ctx.accounts.auction_token_b_eata_buffer,
            &ctx.accounts.auction_token_b_eata_record,
            &ctx.accounts.auction_token_b_eata_metadata,
            &ctx.accounts.delegation_program,
            &ctx.accounts.system_program,
            validator,
        )?;

        msg!(
            "Initialized auction {} with Token A lot {} held on L1",
            auction_key,
            lot_amount
        );
        Ok(())
    }

    pub fn delegate_auction(ctx: Context<DelegateAuction>, auction_id: u64) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        let auctioneer = ctx.accounts.auctioneer.key();
        let auction_id_bytes = auction_id.to_le_bytes();
        ctx.accounts.delegate_auction(
            &ctx.accounts.auctioneer,
            &[AUCTION_SEED, auctioneer.as_ref(), &auction_id_bytes],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn init_auction_permission(ctx: Context<AuctionPermission>, auction_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Auction permission already exists");
            return Ok(());
        }

        let auction_id_bytes = ctx.accounts.auction.auction_id.to_le_bytes();
        let bump = [ctx.bumps.auction];
        let signers: &[&[u8]] = &[
            AUCTION_SEED,
            ctx.accounts.auction.auctioneer.as_ref(),
            &auction_id_bytes,
            &bump,
        ];
        let members = vec![permission_member(ctx.accounts.auction.auctioneer)];

        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.auction.to_account_info(),
            permissioned_account: ctx.accounts.auction.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members,
            },
        }
        .invoke_signed(&[signers])?;
        Ok(())
    }

    pub fn place_bid(ctx: Context<PlaceBid>, auction_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        require!(
            ctx.accounts.auction.status == AuctionStatus::Open,
            ErrorCode::AuctionClosed
        );
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.auction.deadline_ts,
            ErrorCode::AuctionClosed
        );
        require!(
            (ctx.accounts.auction.bid_count as usize) < MAX_BIDDERS,
            ErrorCode::TooManyBidders
        );

        let auction_key = ctx.accounts.auction.key();
        let bidder = ctx.accounts.bidder.key();

        ctx.accounts.create_ephemeral_bid((8 + Bid::LEN) as u32)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.bidder_token_b_account.to_account_info(),
                    to: ctx.accounts.auction_token_b_account.to_account_info(),
                    authority: ctx.accounts.bidder.to_account_info(),
                },
            ),
            amount,
        )?;

        let bidder_index = ctx.accounts.auction.bid_count;
        let bid = Bid {
            auction: auction_key,
            bidder,
            amount,
            bidder_index,
            refunded: false,
            escrow: ctx.accounts.auction_token_b_account.key(),
            bump: ctx.bumps.bid,
        };
        write_bid(&ctx.accounts.bid.to_account_info(), &bid)?;

        ctx.accounts.auction.bid_count = bidder_index + 1;

        msg!("Bid {} placed for auction {}", amount, auction_key);
        Ok(())
    }

    pub fn init_bid_permission(ctx: Context<InitBidPermission>, auction_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        require_keys_eq!(
            ctx.accounts.bid.auction,
            ctx.accounts.auction.key(),
            ErrorCode::InvalidBid
        );
        if !ctx.accounts.bid_permission.data_is_empty() {
            msg!("Bid permission already exists");
            return Ok(());
        }

        let auction_id_bytes = ctx.accounts.auction.auction_id.to_le_bytes();
        let auction_bump = [ctx.accounts.auction.bump];
        let auction_signers: &[&[u8]] = &[
            AUCTION_SEED,
            ctx.accounts.auction.auctioneer.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ];
        let auction_key = ctx.accounts.auction.key();
        let bid_bump = [ctx.accounts.bid.bump];
        let bid_signers: &[&[u8]] = &[
            BID_SEED,
            auction_key.as_ref(),
            ctx.accounts.bid.bidder.as_ref(),
            &bid_bump,
        ];
        let bid_members = vec![
            permission_member(ctx.accounts.auction.auctioneer),
            permission_member(ctx.accounts.bid.bidder),
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.auction.to_account_info(),
            permissioned_account: ctx.accounts.bid.to_account_info(),
            permission: ctx.accounts.bid_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: bid_members,
            },
        }
        .invoke_signed(&[auction_signers, bid_signers])?;

        msg!("Bid permission created for {}", ctx.accounts.bid.key());
        Ok(())
    }

    pub fn end_auction(ctx: Context<EndAuction>, auction_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        require!(
            ctx.accounts.auction.status == AuctionStatus::Open,
            ErrorCode::AuctionClosed
        );
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.auction.deadline_ts,
            ErrorCode::DeadlineInPast
        );

        let auction_key = ctx.accounts.auction.key();
        let bid_count = ctx.accounts.auction.bid_count as usize;
        require!(
            ctx.remaining_accounts.len() == bid_count,
            ErrorCode::MissingBid
        );

        let mut highest_bid = 0;
        let mut highest_bidder = Pubkey::default();
        let mut highest_index = u8::MAX;

        for index in 0..bid_count {
            let bid_info = &ctx.remaining_accounts[index];
            let bid = Account::<Bid>::try_from(bid_info)?;
            require_keys_eq!(bid.auction, auction_key, ErrorCode::InvalidBid);
            let expected_bid = Pubkey::find_program_address(
                &[BID_SEED, auction_key.as_ref(), bid.bidder.as_ref()],
                ctx.program_id,
            )
            .0;
            require_keys_eq!(bid_info.key(), expected_bid, ErrorCode::InvalidBid);
            require!(
                (bid.bidder_index as usize) < bid_count,
                ErrorCode::InvalidBid
            );

            for previous_index in 0..index {
                let previous_info = &ctx.remaining_accounts[previous_index];
                require_keys_neq!(bid_info.key(), previous_info.key(), ErrorCode::DuplicateBid);
                let previous_bid = Account::<Bid>::try_from(previous_info)?;
                require!(
                    bid.bidder_index != previous_bid.bidder_index,
                    ErrorCode::DuplicateBid
                );
            }

            if bid.amount > highest_bid
                || (bid.amount == highest_bid && bid.bidder_index < highest_index)
            {
                highest_bid = bid.amount;
                highest_bidder = bid.bidder;
                highest_index = bid.bidder_index;
            }
        }

        let auction = &mut ctx.accounts.auction;
        auction.highest_bid = highest_bid;
        auction.highest_bidder = highest_bidder;
        auction.status = AuctionStatus::Ended;
        msg!(
            "Ended auction {} with winner {}",
            auction_key,
            highest_bidder
        );
        Ok(())
    }

    pub fn undelegate_auction(ctx: Context<UndelegateAuction>, auction_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        require!(
            ctx.accounts.auction.status == AuctionStatus::Ended,
            ErrorCode::AuctionNotEnded
        );
        require_eq!(
            ctx.accounts.auction.closed_bid_count,
            ctx.accounts.auction.bid_count,
            ErrorCode::UnclosedBids
        );
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.auction.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    pub fn finalize(ctx: Context<Finalize>, auction_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        require!(
            ctx.accounts.auction.status == AuctionStatus::Ended,
            ErrorCode::AuctionNotEnded
        );
        require!(
            ctx.accounts.auction.highest_bidder != Pubkey::default(),
            ErrorCode::MissingBid
        );

        let auction_id_bytes = ctx.accounts.auction.auction_id.to_le_bytes();
        let auction_bump = [ctx.accounts.auction.bump];
        let auction_seeds: &[&[u8]] = &[
            AUCTION_SEED,
            ctx.accounts.auction.auctioneer.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.auction_token_a_account.to_account_info(),
                    to: ctx.accounts.winner_token_a_account.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &[auction_seeds],
            ),
            ctx.accounts.auction.lot_amount,
        )?;

        let auction = &mut ctx.accounts.auction;
        auction.status = AuctionStatus::Settled;
        auction.lot_claimed = true;
        Ok(())
    }

    pub fn reclaim_unsold_lot(ctx: Context<ReclaimUnsoldLot>, auction_id: u64) -> Result<()> {
        require_eq!(ctx.accounts.auction.auction_id, auction_id);
        require!(
            ctx.accounts.auction.status == AuctionStatus::Ended,
            ErrorCode::AuctionNotEnded
        );
        require!(
            ctx.accounts.auction.highest_bidder == Pubkey::default(),
            ErrorCode::InvalidBid
        );

        let auction_id_bytes = ctx.accounts.auction.auction_id.to_le_bytes();
        let auction_bump = [ctx.accounts.auction.bump];
        let auction_seeds: &[&[u8]] = &[
            AUCTION_SEED,
            ctx.accounts.auction.auctioneer.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.auction_token_a_account.to_account_info(),
                    to: ctx.accounts.seller_token_a_account.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &[auction_seeds],
            ),
            ctx.accounts.auction.lot_amount,
        )?;

        let auction = &mut ctx.accounts.auction;
        auction.status = AuctionStatus::Settled;
        auction.lot_claimed = true;
        Ok(())
    }

    pub fn settle_winning_bid(ctx: Context<SettleWinningBid>) -> Result<()> {
        require!(
            ctx.accounts.auction.status == AuctionStatus::Ended,
            ErrorCode::AuctionNotEnded
        );
        require!(
            ctx.accounts.auction.highest_bidder != Pubkey::default(),
            ErrorCode::MissingBid
        );

        let auction = ctx.accounts.auction.key();
        let winner = ctx.accounts.auction.highest_bidder;
        let winning_bid_info = ctx.accounts.winning_bid.to_account_info();
        let bid = read_bid(&winning_bid_info)?;
        require_keys_eq!(bid.auction, auction, ErrorCode::InvalidBid);
        require_keys_eq!(bid.bidder, winner, ErrorCode::InvalidBid);
        require_eq!(
            bid.amount,
            ctx.accounts.auction.highest_bid,
            ErrorCode::InvalidBid
        );
        require_keys_eq!(
            bid.escrow,
            ctx.accounts.auction_token_b_account.key(),
            ErrorCode::InvalidBidEscrow
        );

        let auction_id_bytes = ctx.accounts.auction.auction_id.to_le_bytes();
        let auction_bump = [ctx.accounts.auction.bump];
        let auction_signers: &[&[u8]] = &[
            AUCTION_SEED,
            ctx.accounts.auction.auctioneer.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ];
        let bid_bump = [bid.bump];
        let bid_seeds: &[&[u8]] = &[BID_SEED, auction.as_ref(), winner.as_ref(), &bid_bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.auction_token_b_account.to_account_info(),
                    to: ctx.accounts.seller_token_b_account.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &[auction_signers],
            ),
            bid.amount,
        )?;

        close_bid_permission(&CloseBidPermissionAccounts {
            sponsor: ctx.accounts.auction.to_account_info(),
            bid: ctx.accounts.winning_bid.to_account_info(),
            permission: ctx.accounts.bid_permission.to_account_info(),
            ephemeral_vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            sponsor_signers: auction_signers,
            bid_signers: bid_seeds,
        })?;
        ctx.accounts.close_ephemeral_winning_bid()?;
        ctx.accounts.auction.closed_bid_count = ctx
            .accounts
            .auction
            .closed_bid_count
            .checked_add(1)
            .ok_or(ErrorCode::TooManyBidders)?;
        Ok(())
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        require!(
            ctx.accounts.auction.status == AuctionStatus::Ended,
            ErrorCode::AuctionNotEnded
        );
        let auction = ctx.accounts.auction.key();
        let bid_info = ctx.accounts.bid.to_account_info();
        let bid = read_bid(&bid_info)?;
        require_keys_eq!(bid.auction, auction, ErrorCode::InvalidBid);
        require_keys_eq!(bid.bidder, ctx.accounts.bidder.key(), ErrorCode::InvalidBid);
        require!(
            bid.bidder != ctx.accounts.auction.highest_bidder,
            ErrorCode::WinnerCannotRefund
        );
        require!(!bid.refunded, ErrorCode::AlreadyRefunded);
        require_keys_eq!(
            bid.escrow,
            ctx.accounts.auction_token_b_account.key(),
            ErrorCode::InvalidBidEscrow
        );

        let auction_id_bytes = ctx.accounts.auction.auction_id.to_le_bytes();
        let auction_bump = [ctx.accounts.auction.bump];
        let auction_signers: &[&[u8]] = &[
            AUCTION_SEED,
            ctx.accounts.auction.auctioneer.as_ref(),
            &auction_id_bytes,
            &auction_bump,
        ];
        let bid_bump = [bid.bump];
        let bid_seeds: &[&[u8]] = &[
            BID_SEED,
            bid.auction.as_ref(),
            bid.bidder.as_ref(),
            &bid_bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.auction_token_b_account.to_account_info(),
                    to: ctx.accounts.bidder_token_b_account.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &[auction_signers],
            ),
            bid.amount,
        )?;

        close_bid_permission(&CloseBidPermissionAccounts {
            sponsor: ctx.accounts.auction.to_account_info(),
            bid: ctx.accounts.bid.to_account_info(),
            permission: ctx.accounts.bid_permission.to_account_info(),
            ephemeral_vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            sponsor_signers: auction_signers,
            bid_signers: bid_seeds,
        })?;
        ctx.accounts.close_ephemeral_bid()?;
        ctx.accounts.auction.closed_bid_count = ctx
            .accounts
            .auction
            .closed_bid_count
            .checked_add(1)
            .ok_or(ErrorCode::TooManyBidders)?;
        Ok(())
    }
}

fn permission_member(pubkey: Pubkey) -> Member {
    Member {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
        pubkey,
    }
}

fn write_bid(account_info: &AccountInfo, bid: &Bid) -> Result<()> {
    let mut data = account_info.try_borrow_mut_data()?;
    bid.try_serialize(&mut &mut data[..])?;
    Ok(())
}

fn read_bid(account_info: &AccountInfo) -> Result<Bid> {
    let data = account_info.try_borrow_data()?;
    let mut cursor = &data[..];
    Bid::try_deserialize(&mut cursor)
}

fn init_ephemeral_ata<'info>(
    program: &UncheckedAccount<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    owner: AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(owner.key(), false),
            AccountMeta::new_readonly(mint.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data: vec![0],
    };
    invoke(
        &instruction,
        &[
            ephemeral_ata.to_account_info(),
            payer.to_account_info(),
            owner,
            mint.to_account_info(),
            system_program.to_account_info(),
            program.to_account_info(),
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn delegate_ephemeral_ata<'info>(
    program: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    ephemeral_ata: &UncheckedAccount<'info>,
    buffer: &UncheckedAccount<'info>,
    record: &UncheckedAccount<'info>,
    metadata: &UncheckedAccount<'info>,
    delegation_program: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    validator: Option<Pubkey>,
) -> Result<()> {
    let mut data = vec![4];
    if let Some(validator) = validator {
        data.extend_from_slice(validator.as_ref());
    }

    let instruction = Instruction {
        program_id: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer.key(), true),
            AccountMeta::new(ephemeral_ata.key(), false),
            AccountMeta::new_readonly(EPHEMERAL_SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new(buffer.key(), false),
            AccountMeta::new(record.key(), false),
            AccountMeta::new(metadata.key(), false),
            AccountMeta::new_readonly(delegation_program.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
        ],
        data,
    };
    invoke(
        &instruction,
        &[
            payer.to_account_info(),
            ephemeral_ata.to_account_info(),
            program.to_account_info(),
            buffer.to_account_info(),
            record.to_account_info(),
            metadata.to_account_info(),
            delegation_program.to_account_info(),
            system_program.to_account_info(),
        ],
    )?;
    Ok(())
}

fn ephemeral_ata_pda(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), mint.as_ref()],
        &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    )
    .0
}

fn eata_buffer_address(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"buffer", delegated_account.as_ref()],
        &EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    )
    .0
}

fn record_pda(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation", delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}

fn metadata_pda(delegated_account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"delegation-metadata", delegated_account.as_ref()],
        &DELEGATION_PROGRAM_ID,
    )
    .0
}

struct CloseBidPermissionAccounts<'a, 'info> {
    sponsor: AccountInfo<'info>,
    bid: AccountInfo<'info>,
    permission: AccountInfo<'info>,
    ephemeral_vault: AccountInfo<'info>,
    magic_program: AccountInfo<'info>,
    permission_program: AccountInfo<'info>,
    sponsor_signers: &'a [&'a [u8]],
    bid_signers: &'a [&'a [u8]],
}

fn close_bid_permission(accounts: &CloseBidPermissionAccounts<'_, '_>) -> Result<()> {
    CloseEphemeralPermissionCpi {
        payer: accounts.sponsor.clone(),
        authority: accounts.bid.clone(),
        permissioned_account: accounts.bid.clone(),
        permission: accounts.permission.clone(),
        vault: accounts.ephemeral_vault.clone(),
        magic_program: accounts.magic_program.clone(),
        permission_program: accounts.permission_program.clone(),
        authority_is_signer: false,
    }
    .invoke_signed(&[accounts.sponsor_signers, accounts.bid_signers])?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct InitializeAuction<'info> {
    #[account(mut)]
    pub auctioneer: Signer<'info>,
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = auctioneer,
        space = 8 + Auction::LEN,
        seeds = [AUCTION_SEED, auctioneer.key().as_ref(), &auction_id.to_le_bytes()],
        bump
    )]
    pub auction: Box<Account<'info, Auction>>,
    #[account(
        init,
        payer = auctioneer,
        associated_token::mint = token_a_mint,
        associated_token::authority = auction
    )]
    pub auction_token_a_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = auctioneer,
        associated_token::mint = token_b_mint,
        associated_token::authority = auction
    )]
    pub auction_token_b_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = auction_token_b_ephemeral_ata.key() == ephemeral_ata_pda(&auction.key(), &token_b_mint.key()) @ ErrorCode::InvalidBidEscrow
    )]
    /// CHECK: Auction PDA's e-token balance account for Token B.
    pub auction_token_b_ephemeral_ata: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = auction_token_b_eata_buffer.key() == eata_buffer_address(&auction_token_b_ephemeral_ata.key()) @ ErrorCode::InvalidBidEscrow
    )]
    /// CHECK: Delegation buffer PDA for the auction Token-B eATA.
    pub auction_token_b_eata_buffer: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = auction_token_b_eata_record.key() == record_pda(&auction_token_b_ephemeral_ata.key()) @ ErrorCode::InvalidBidEscrow
    )]
    /// CHECK: Delegation record PDA for the auction Token-B eATA.
    pub auction_token_b_eata_record: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = auction_token_b_eata_metadata.key() == metadata_pda(&auction_token_b_ephemeral_ata.key()) @ ErrorCode::InvalidBidEscrow
    )]
    /// CHECK: Delegation metadata PDA for the auction Token-B eATA.
    pub auction_token_b_eata_metadata: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = auctioneer
    )]
    pub seller_token_a_account: Account<'info, TokenAccount>,
    #[account(address = EPHEMERAL_SPL_TOKEN_PROGRAM_ID)]
    /// CHECK: Fixed Ephemeral SPL Token program id.
    pub ephemeral_token_program: UncheckedAccount<'info>,
    #[account(address = DELEGATION_PROGRAM_ID)]
    /// CHECK: Fixed delegation program id.
    pub delegation_program: UncheckedAccount<'info>,
    /// CHECK: Optional ER validator account used by the e-token delegation CPI.
    pub validator: Option<UncheckedAccount<'info>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub bidder: Signer<'info>,
    pub token_b_mint: Account<'info, Mint>,
    #[account(
        mut,
        sponsor,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction.auction_id.to_le_bytes()],
        constraint = auction.auctioneer == payer.key() @ ErrorCode::InvalidBid,
        constraint = auction.token_b_mint == token_b_mint.key() @ ErrorCode::MintMismatch,
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
    /// CHECK: Ephemeral bid PDA sponsored by the auction.
    #[account(
        mut,
        eph,
        seeds = [BID_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = bidder_token_b_account.owner == bidder.key() @ ErrorCode::InvalidTokenOwner,
        constraint = bidder_token_b_account.mint == token_b_mint.key() @ ErrorCode::MintMismatch
    )]
    pub bidder_token_b_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = auction
    )]
    pub auction_token_b_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct InitBidPermission<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
    #[account(
        mut,
        seeds = [BID_SEED, auction.key().as_ref(), bid.bidder.as_ref()],
        constraint = bid.auction == auction.key() @ ErrorCode::InvalidBid,
        bump = bid.bump
    )]
    pub bid: Account<'info, Bid>,
    #[account(mut)]
    /// CHECK: Verified by the Permission Program.
    pub bid_permission: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program id.
    pub permission_program: UncheckedAccount<'info>,
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    /// CHECK: Verified by the Magic Program.
    pub ephemeral_vault: UncheckedAccount<'info>,
    #[account(address = MAGIC_PROGRAM_ID)]
    /// CHECK: Fixed Magic Program id.
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct EndAuction<'info> {
    #[account(mut)]
    pub auctioneer: Signer<'info>,
    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction_id.to_le_bytes()],
        has_one = auctioneer,
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
}

#[commit]
#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct UndelegateAuction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct Finalize<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
    #[account(constraint = token_a_mint.key() == auction.token_a_mint @ ErrorCode::MintMismatch)]
    pub token_a_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = auction
    )]
    pub auction_token_a_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = auction.highest_bidder
    )]
    pub winner_token_a_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct ReclaimUnsoldLot<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Box<Account<'info, Auction>>,
    #[account(constraint = token_a_mint.key() == auction.token_a_mint @ ErrorCode::MintMismatch)]
    pub token_a_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = auction
    )]
    pub auction_token_a_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = auction.auctioneer
    )]
    pub seller_token_a_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct SettleWinningBid<'info> {
    #[account(mut)]
    /// CHECK: Anyone can crank this, but payment is constrained to the auctioneer token account.
    pub crank: UncheckedAccount<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
    /// CHECK: Ephemeral winning bid PDA sponsored by the auction.
    #[account(
        mut,
        eph,
        seeds = [
            BID_SEED,
            auction.key().as_ref(),
            auction.highest_bidder.as_ref()
        ],
        bump
    )]
    pub winning_bid: UncheckedAccount<'info>,
    #[account(constraint = token_b_mint.key() == auction.token_b_mint @ ErrorCode::MintMismatch)]
    pub token_b_mint: Account<'info, Mint>,
    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = auction
    )]
    pub auction_token_b_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = auction.auctioneer
    )]
    pub seller_token_b_account: Account<'info, TokenAccount>,
    #[account(mut)]
    /// CHECK: Verified by the Permission Program.
    pub bid_permission: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program id.
    pub permission_program: UncheckedAccount<'info>,
    #[account(address = MAGIC_PROGRAM_ID)]
    /// CHECK: Fixed Magic Program id.
    pub magic_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[ephemeral_accounts]
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    /// CHECK: Bidder identity is verified against the Bid account and token destination authority.
    pub bidder: UncheckedAccount<'info>,
    #[account(
        mut,
        sponsor,
        seeds = [AUCTION_SEED, auction.auctioneer.as_ref(), &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, Auction>,
    /// CHECK: Ephemeral bid PDA sponsored by the auction.
    #[account(
        mut,
        eph,
        seeds = [
            BID_SEED,
            auction.key().as_ref(),
            bidder.key().as_ref()
        ],
        bump
    )]
    pub bid: UncheckedAccount<'info>,
    #[account(constraint = token_b_mint.key() == auction.token_b_mint @ ErrorCode::MintMismatch)]
    pub token_b_mint: Account<'info, Mint>,
    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = auction
    )]
    pub auction_token_b_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = bidder
    )]
    pub bidder_token_b_account: Account<'info, TokenAccount>,
    #[account(mut)]
    /// CHECK: Verified by the Permission Program.
    pub bid_permission: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program id.
    pub permission_program: UncheckedAccount<'info>,
    #[account(address = MAGIC_PROGRAM_ID)]
    /// CHECK: Fixed Magic Program id.
    pub magic_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct DelegateAuction<'info> {
    #[account(mut)]
    pub auctioneer: Signer<'info>,
    #[account(
        mut,
        del,
        seeds = [AUCTION_SEED, auctioneer.key().as_ref(), &auction_id.to_le_bytes()],
        bump
    )]
    /// CHECK: Delegated account is deserialized by later ER instructions.
    pub auction: UncheckedAccount<'info>,
    /// CHECK: Checked by the delegation program.
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct AuctionPermission<'info> {
    #[account(mut)]
    pub auctioneer: Signer<'info>,
    #[account(
        mut,
        seeds = [AUCTION_SEED, auctioneer.key().as_ref(), &auction_id.to_le_bytes()],
        has_one = auctioneer,
        bump
    )]
    pub auction: Account<'info, Auction>,
    #[account(
        mut,
        seeds = [PERMISSION_SEED, auction.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    /// CHECK: Verified by the Permission Program.
    pub permission: UncheckedAccount<'info>,
    #[account(address = PERMISSION_PROGRAM_ID)]
    /// CHECK: Fixed Permission Program id.
    pub permission_program: UncheckedAccount<'info>,
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    /// CHECK: Verified by the Magic Program.
    pub ephemeral_vault: UncheckedAccount<'info>,
    #[account(address = MAGIC_PROGRAM_ID)]
    /// CHECK: Fixed Magic Program id.
    pub magic_program: UncheckedAccount<'info>,
}
