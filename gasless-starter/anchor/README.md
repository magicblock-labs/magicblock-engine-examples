# Gasless Starter

How to make your Solana program **gasless**: users act with a wallet that holds
no SOL, and nobody runs a relayer or fee-payer server.

The pattern has three parts:

1. **Funds move with the Payments API.** Users deposit to and withdraw from a
   MagicBlock Ephemeral Rollup (ER) through the hosted
   [Payments API](https://payments.magicblock.app/reference) with
   `gasless: true`. MagicBlock's sponsor pays the SOL fee, and the user pays a
   0.20 USDC relay fee instead.
2. **Your program runs on the ER.** ER transactions are free, so the user's own
   wallet can be the fee payer while holding 0 SOL.
3. **You pay for setup once.** Anything that creates or delegates accounts on
   Solana needs SOL. You do it once, from a developer key, before users arrive.

This folder applies the pattern to a small **tip jar**. You don't need the tip
jar itself. Copy the pieces described below into your own program and app.

```text
            Solana (base layer)                       Ephemeral Rollup
            ───────────────────                       ────────────────
setup       create + delegate your accounts ── once, you pay SOL ──▶ your accounts are live

deposit     POST /v1/spl/deposit ─▶ user co-signs ─────────────────▶ user's USDC on the ER
            (sponsor pays SOL, user pays 0.20 USDC)

use                                                       your instructions (free, 0-SOL payer)

withdraw    POST /v1/spl/withdraw ─▶ user co-signs ◀─────────────── USDC back on Solana
            (sponsor pays SOL, user pays 0.20 USDC)
```

| Step                         | Where  | Signs                 | Pays SOL | User pays     |
| ---------------------------- | ------ | --------------------- | -------- | ------------- |
| Create and delegate accounts | Solana | your developer key    | you      | –             |
| Deposit USDC                 | Solana | sponsor (first), user | sponsor  | 0.20 USDC fee |
| Your instructions            | ER     | user (as fee payer)   | nobody   | –             |
| Withdraw USDC                | Solana | sponsor (first), user | sponsor  | 0.20 USDC fee |

## Add it to your program

### 1. Move user funds to the ER with the Payments API

Copy `app/src/lib/payments.ts`, `sponsored.ts` and `config.ts` into your client.
They need no changes for devnet USDC.

```ts
import { SponsoredPayments } from "./lib/sponsored";

const payments = new SponsoredPayments(baseConnection, readBalances);

await payments.pay(wallet, "deposit", 5_000_000n); // 5 USDC to the ER
await payments.pay(wallet, "withdraw", 5_000_000n); // and back to Solana
```

`pay` asks the API for a sponsored transaction and rebuilds it locally with the
SDK. It signs only if the bytes match exactly: amount, owner, validator, relay
fee and the sponsor's signature. It then saves a receipt, sends the transaction,
and waits until the funds arrive. `readBalances` reports the user's USDC on
Solana and on the ER; copy it from `app/src/lib/chain.ts`.

The first deposit delegates the user's ephemeral ATA. From then on, the ER holds
a live, writable copy of the user's normal USDC token account (their ATA).

### 2. Write instructions that run on the ER

Your program never calls the ephemeral SPL token program. On the ER it uses
plain SPL `transfer`s between ordinary token accounts. A user pays into your
program like this (from `tip`):

```rust
#[derive(Accounts)]
pub struct Tip<'info> {
    /// Signs and pays the (zero) ER fee. Needs no SOL.
    pub tipper: Signer<'info>,
    #[account(mut, token::mint = jar.mint, token::authority = tipper)]
    pub tipper_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [JAR_SEED, jar.authority.as_ref()], bump = jar.bump)]
    pub jar: Account<'info, Jar>,
    #[account(mut, associated_token::mint = jar.mint, associated_token::authority = jar)]
    pub jar_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
```

To hold or pay out funds, give a PDA its own token account and sign with the
PDA's seeds (from `withdraw_tips`):

```rust
let jar = &ctx.accounts.jar;
let signer_seeds: &[&[&[u8]]] = &[&[JAR_SEED, jar.authority.as_ref(), &[jar.bump]]];
token::transfer(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.jar_token.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.jar.to_account_info(),
        },
        signer_seeds,
    ),
    amount,
)?;
```

Two rules:

- **Every token account an ER instruction writes must be delegated.** User
  accounts are delegated by their first deposit. Your PDA's token account is
  delegated in setup (step 3). Writing to an undelegated account fails on the ER.
- **Mark your program `#[ephemeral]`.** Delegate your state accounts with
  `#[delegate]`, and commit them back to Solana with `MagicIntentBundleBuilder`.
  `commit_jar` and `undelegate_jar` show both.

### 3. Set up your accounts once

Run this from a developer key on Solana. It is the only step that costs SOL.
Every write account your ER instructions touch needs it once: state PDAs and the
token accounts your PDAs own. From `scripts/create-jar.ts`:

```ts
const [jarEata] = deriveEphemeralAta(jar, USDC_MINT);
const tx = new Transaction().add(
  // Your program's init: creates the PDA and its token account (ATA).
  createJarIx,
  // Delegate the PDA's ephemeral ATA, so its token account is writable on the ER.
  initEphemeralAtaIx(jarEata, jar, USDC_MINT, payer),
  delegateEphemeralAtaIx(payer, jarEata, VALIDATOR),
  // Delegate the PDA itself (#[delegate]), so ER instructions can update it.
  delegateJarIx,
);
```

The ephemeral ATA calls need only the payer's signature, so they work for PDAs.
Pin the validator: in `delegate_jar` the jar can only go to the validator saved
at creation.

If your program creates PDAs that are keyed to a wallet, make that wallet sign
the creation. Otherwise anyone can create the PDA first with bad settings and
block the real owner. `create_jar` requires the authority's signature for this
reason.

### 4. Send ER transactions from a 0-SOL wallet

Set the user's wallet as fee payer and send to the ER endpoint
(`sendOnEr` in `app/src/lib/chain.ts`):

```ts
const tx = new Transaction({
  feePayer: wallet.publicKey,
  blockhash,
  lastValidBlockHeight,
}).add(ix);
tx.sign(wallet);
await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
```

The ER is free, so this works with 0 SOL. To keep each action to two round
trips, `sendOnEr` fetches the next blockhash in the background (using each one
once) and polls `getSignatureStatuses` right after sending. The ER executes on
arrival, so the first poll usually confirms; `confirmTransaction` would open a
new websocket every time.

An embedded keypair
(`app/src/lib/wallet.ts`) signs with no popup, which makes each action feel
instant. A browser wallet works too, but it asks for approval every time.

### 5. Settle and withdraw

Users take USDC out with `payments.pay(wallet, "withdraw", amount)`. If your
program pays users from a PDA account, the payout lands in their ER token
account first; they then withdraw it like any other balance. Commit your state
whenever Solana needs to see it.

## Things to know

- **Mints and amounts.** Gasless payments work only for approved stablecoins:
  USDC on devnet, and USDC or USDT on mainnet. The API rejects other mints
  (`INVALID_GASLESS_DEPOSIT_MINT`). Each deposit or withdrawal must be at least
  0.50.
- **Fees come from Solana.** The 0.20 relay fee is taken from the user's
  **Solana** balance, for withdrawals too. `pay` refuses a deposit that would
  leave less than 0.20 behind, so the next withdrawal fee is covered as long as
  the user doesn't spend that reserve elsewhere.
- **Small leftovers get stuck.** Less than 0.50 left on the ER can't be
  withdrawn gaslessly. Have users withdraw their full balance, or keep it above
  0.50.
- **Check before signing.** Never sign a sponsored transaction without
  rebuilding it first, as `validatePayment` does.
- **One payment at a time.** A signed payment is saved before it is sent, and no
  other payment is built until it settles or provably fails. A dropped response
  must not lead to a second charge.
- **One validator.** Deposits, your delegated accounts and your ER endpoint must
  all use the same validator. On devnet that is `MAS1Dt9q…`, served at
  `devnet-as.magicblock.app`.
- **The embedded wallet is a devnet convenience.** Anyone with access to the
  browser profile can use it. Prompt users to export the key, and use a real
  wallet for real funds.
- **Mainnet.** In `config.ts`, set `PAYMENTS_CLUSTER` to `"mainnet"`, the mint
  to mainnet USDC (`EPjFWdd5…`) or USDT, `BASE_RPC` to a mainnet RPC, and
  `ER_RPC` to the mainnet ER endpoint for validator `MAS1Dt9q…`. Then deploy
  your program and run your setup on mainnet.

## The example: a tip jar

| Pattern step                  | Tip jar                                                 |
| ----------------------------- | ------------------------------------------------------- |
| 1. Gasless deposit / withdraw | `app/src/lib/payments.ts`, `app/src/lib/sponsored.ts`   |
| 2. ER instructions            | `tip`, `withdraw_tips` in `programs/tip-jar/src/lib.rs` |
| 3. One-time setup             | `create_jar`, `delegate_jar`, `scripts/create-jar.ts`   |
| 4. 0-SOL ER transactions      | `app/src/lib/chain.ts`, `app/src/lib/wallet.ts`         |
| 5. Settle                     | `commit_jar`, `undelegate_jar`                          |

```text
programs/tip-jar/     Anchor program
tests/tip-jar.ts      Local ER test. The local wallet plays the sponsor; the tipper
                      and the jar authority hold 0 SOL throughout
scripts/create-jar.ts One-time devnet setup
app/                  React + Vite app
  src/lib/payments.ts   Payments API client with local rebuild check
  src/lib/sponsored.ts  Sign, save a receipt, send, reconcile until settled
  src/lib/chain.ts      Balances, ER transactions, program instructions
  src/lib/wallet.ts     Embedded keypair in IndexedDB, with export and import
  test/                 Unit tests for the payment checks and receipts
```

### Software packages

| Software   | Version | Installation Guide                                              |
| ---------- | ------- | --------------------------------------------------------------- |
| **Solana** | 3.1.9   | [Install Solana](https://docs.anza.xyz/cli/install)             |
| **Rust**   | 1.89.0  | [Install Rust](https://www.rust-lang.org/tools/install)         |
| **Anchor** | 1.0.2   | [Install Anchor](https://www.anchor-lang.com/docs/installation) |
| **Node**   | 24.10.0 | [Install Node](https://nodejs.org/en/download/current)          |

### Build and test locally

```bash
yarn
yarn build
```

Start a local MagicBlock cluster (base validator, ER and Query Filtering
Service) in one terminal and leave it running:

```bash
yarn setup
```

Then, in a second terminal, run the program test:

```bash
yarn test:local
```

The Payments API only runs against devnet and mainnet, so the local test does
the sponsor's part itself: it builds the same deposit instructions with the SDK
and pays the fee from the local wallet.

The payment logic has its own unit tests, which need no network:

```bash
cd app && yarn && yarn test
```

### Run it on devnet

1. Deploy the program and copy its IDL into the app:

   ```bash
   anchor deploy --provider.cluster devnet
   yarn copy-idl
   ```

2. Create a jar. Its authority collects the tips and must sign. To collect
   from the app, open the app once, click **Export key**, and pass that file:

   ```bash
   yarn create-jar                      # jar owned by your CLI wallet
   yarn create-jar ./exported-key.json  # jar owned by the app's wallet
   ```

3. Start the app with the printed jar address:

   ```bash
   cd app
   echo "VITE_JAR_ADDRESS=<jar>" > .env
   yarn dev
   ```

4. Get devnet USDC from [faucet.circle.com](https://faucet.circle.com) for the
   address in the Wallet panel. Deposit, tip, then withdraw. The SOL balance
   stays at 0.
