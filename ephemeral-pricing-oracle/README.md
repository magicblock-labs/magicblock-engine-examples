# Ephemeral Pricing Oracle

This repository contains a Solana program designed to inject price feeds into ephemeral rollups. It includes a chain pusher that subscribes to and posts price updates on-chain, as well as an example of how to consume price data in a Solana program.

Currently supports:
- [Stork price feeds](https://www.stork.network/)
- [Pyth lazer](https://docs.pyth.network/lazer)

## Overview

The project is structured as follows:

- Solana Program: A program that allow to create and update price feeds in the ephemeral rollups.
- Chain Pusher: A component that subscribes to price updates from a price feed and posts these updates on-chain.
- Example Consumer: An example demonstrating how to consume and utilize the price data within a Solana program.

## Running the chain pusher

```bash
cargo run -- --auth_header "Bearer <your_auth_token>" --ws_url "ws_url" --cluster "https://devnet.magicblock.app"
```

## Consuming Price Data in a Solana Program


1. Add pyth sdk

```bash
cargo add pyth_solana_receiver_sdk
```

2. Define the instruction context, passing the account as AccountInfo

```rust
#[derive(Accounts)]
pub struct Sample<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the correct price feed
    pub price_update: AccountInfo<'info>,
}
```

3. Deserialize and use the price data

```rust
    pub fn sample(ctx: Context<Sample>) -> Result<()> {
        // Deserialize the price feed
        let price_update = PriceUpdateV2::try_deserialize_unchecked
            (&mut (*ctx.accounts.price_update.data.borrow()).as_ref(),
            ).map_err(Into::<Error>::into)?;

        // get_price_no_older_than will fail if the price update is more than 30 seconds old
        let maximum_age: u64 = 60;

        // Get the price feed id
        let feed_id: [u8; 32] = ctx.accounts.price_update.key().to_bytes();

        msg!("The price update is: {}", price_update.price_message.price);
        let price = price_update.get_price_no_older_than(&Clock::get()?, maximum_age, &feed_id)?;

        // Sample output:
        // The price is (7160106530699 ± 5129162301) * 10^-8
        msg!("The price is ({} ± {}) * 10^{}", price.price, price.conf, price.exponent);
        msg!("The price is: {}", price.price as f64 * 10_f64.powi(price.exponent));

        Ok(())
    }
```

- [programs/ephemeral-oracle/programs/ephemeral-oracle/src/lib.rs](programs/ephemeral-oracle/programs/ephemeral-oracle/src/lib.rs)

## Example Price Feeds

| Asset Pair | Feed Provider | Address | Endpoint |
|------------|--------------|---------|-----------|
| SOL/USD | Stork | `BGkCTVG77Q2MFyEE3KypfZ8EUzw72VZZvDpjV98Zj7iJ` | https://devnet.magicblock.app |
| SOL/USD | Pyth Lazer | `7AxV2515SwLFVxWSpCngQ3TNqY17JERwcCfULc464u7D` | https://devnet.magicblock.app |
| BTC/USD | Pyth Lazer | `74UjNSaPWH8W72HNZDgKiMXkiKt5o2s6evSkVm9CsZpD` | https://devnet.magicblock.app |
| ETH/USD | Pyth Lazer | `NY1S3R56xVou4YTAmUxXjvKwNmYgQXeWPqFmLss4ihg` | https://devnet.magicblock.app |
| USDC/USD | Pyth Lazer | `J5kD2RwveK5w7HjhDZQdiymDDyWH72yjtaYtD55YyoGu` | https://devnet.magicblock.app |

### Subcribe to a price feed

Connect:

```bash
wscat -c "wss://devnet.magicblock.app"
```

Subscribe:

```bash
{"jsonrpc":"2.0","id":1,"method":"accountSubscribe","params":["7AxV2515SwLFVxWSpCngQ3TNqY17JERwcCfULc464u7D",{"encoding":"jsonParsed","commitment":"confirmed"}]}
```




