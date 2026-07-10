# Sealed Auction

Private first-price sealed-bid auction using a MagicBlock private Ephemeral Rollup and SPL Token
escrow.

The seller escrows a fixed Token A lot in an L1 SPL token account owned by the auction PDA. Bidders
pre-fund Token B however they want, can consolidate balances on the ER, and then submit hidden,
fully collateralized Token B bids on the private ER. After the deadline, the program reads the
private bid accounts on-chain, selects the highest bid, and releases the L1 Token A lot to the
winner. Token B proceeds and loser refunds are settled on the ER from a delegated auction-owned
Token B escrow, while auction-sponsored private bid accounts are closed before the auction PDA is
undelegated.

## What This Teaches

- Private ER permissions for hidden bid state.
- L1 SPL Token escrow for a public seller lot.
- Auction-sponsored ER-only bid PDAs plus an auction-owned delegated Token B escrow.
- Count-checked bid scanning and cleanup-gated auction undelegation.

## Flow

1. `initialize_auction` creates the auction, parks the seller's Token A in an auction PDA ATA,
   creates the auction PDA's Token B ATA/eATA, delegates that Token B escrow to the ER, and preloads
   sponsor lamports into the auction PDA.
2. Bidders can pre-fund and consolidate Token B outside the auction using normal delegated SPL token
   transfers.
3. `delegate_auction` moves the count-only auction state to ER; auction state remains public because
   it does not store bid amounts or bidder keys.
4. `place_bid` creates an auction-sponsored `Bid` PDA and moves Token B from the bidder's ER balance
   into the auction-owned Token B escrow.
5. `init_bid_permission` immediately attaches private PER access to the created bid PDA.
6. `end_auction` requires exactly `bid_count` unique valid bid PDAs, scans them on ER, and records
   the winner without undelegating the auction.
7. `settle_winning_bid` pays the winning Token B amount from the auction escrow to the seller on ER
   and closes the winning bid account back to the auction PDA.
8. Losing bidders run `claim_refund` on ER; refunds are paid from the auction escrow and close losing
   bid accounts back to the auction PDA.
9. `undelegate_auction` is allowed only after every accepted bid has been closed.
10. `finalize` runs on L1 after auction undelegation and transfers Token A to the winner.

No-bid auctions can be undelegated immediately after `end_auction`, then use `reclaim_unsold_lot`.

## Run

From this directory:

```bash
yarn build
yarn test:local
```

`yarn test:local` runs the deterministic account-graph checks without requiring a live local stack.
Those checks assert the auction-sponsored count-only instruction surface: no separate sponsor PDA,
no bidder key array in auction state, `end_auction` stays on ER, and `undelegate_auction` remains the
only commit/undelegate step. Under the repository harness, the localnet tests also verify Token A L1
custody and that sponsor lamports are preloaded into the auction PDA during initialization.
The full privacy and settlement walkthrough needs the standard MagicBlock local stack and QFS/TEE
endpoints from `../../scripts/local-env.sh`:

```bash
yarn setup
RUN_SEALED_AUCTION_LIVE=1 yarn test:local
```

## Out Of Scope

Reserve prices, Vickrey pricing, Dutch auctions, cranks, session keys, unbounded bidder sets, and a
frontend UI.
