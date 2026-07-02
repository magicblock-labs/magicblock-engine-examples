# Oracle Trading

Simple Anchor example that consumes the
[real-time-pricing-oracle](https://github.com/magicblock-labs/real-time-pricing-oracle)
price account format to sell a USD-priced token for SOL.

The program models a minimal storefront-style purchase:

- configure a token price in USD cents
- bind the store to a SOL/USD `PriceUpdateV2` feed account
- read a fresh oracle price at purchase time
- convert the USD token price into the required SOL lamports
- reject the purchase if the required lamports exceed the buyer's `max_lamports`
- transfer SOL to the merchant and record a purchase receipt

It intentionally uses a receipt-style token instead of minting SPL tokens. That
keeps the example focused on the oracle integration. You can extend the same
flow with SPL minting, inventory, or checkout logic after the pricing path is
clear.

## Software Packages

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

```sh
agave-install init 3.1.9
rustup install 1.89.0
avm use 1.0.2
```

## Build and Test

Install dependencies and build the program:

```bash
yarn
yarn build
```

This example runs against a **local MagicBlock cluster** with static
`PriceUpdateV2` account fixtures preloaded by the repo test harness. Start the
cluster in one terminal and leave it running:

```bash
yarn setup
```

`yarn setup` runs `SETUP_ONLY=1 ./scripts/test-locally.sh oracle-trading` from
the repo root: it builds this example, boots the validators, preloads the oracle
fixtures, and holds them until you press a key.

Then, in a second terminal, run this example's tests against that cluster:

```bash
yarn test:local
```

`test:local` sources `scripts/local-env.sh` so the SDK targets the local cluster
(without it the tests fall back to devnet).

> Tip: to build and run **every** example end-to-end (what CI does), run the
> repo-root `./scripts/test-locally.sh` directly.

For a live MagicBlock feed, run the chain pusher from the oracle repository and
pass the delegated SOL/USD price feed account to `initialize_store`:

```bash
cargo run -- --auth-header "Bearer <your_auth_token>" \
  --ws-urls "wss://..." \
  --cluster "https://devnet.magicblock.app"
```

## Purchase Flow

1. Initialize the store with a USD-denominated token price and a SOL/USD feed
   account.
2. A buyer calls `buy_token(quantity, max_lamports)`.
3. The program requires the passed price account to match the configured feed,
   deserializes `PriceUpdateV2`, and requires a fully verified price no older
   than 60 seconds.
4. The program converts `token_price_usd_cents * quantity` into lamports using
   the oracle price.
5. If the required lamports are greater than `max_lamports`, the purchase is
   rejected. Otherwise, SOL is transferred to the merchant and the buyer's
   receipt is updated.

The test uses a token price of `2_500` cents (`$25.00`) and a SOL/USD price of
`10_000` with exponent `-2` (`$100.00`). Buying two tokens costs
`500_000_000` lamports (`0.5 SOL`).
