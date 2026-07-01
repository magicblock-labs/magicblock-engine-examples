import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import { OracleTrading } from "../target/types/oracle_trading";

const MOCK_PRICE_SEED = "mock_price";
const RECEIPT_SEED = "receipt";
const STORE_SEED = "store";

describe("oracle-trading", () => {
  const provider = process.env.PROVIDER_ENDPOINT
    ? new anchor.AnchorProvider(
        new anchor.web3.Connection(process.env.PROVIDER_ENDPOINT, {
          wsEndpoint: process.env.WS_ENDPOINT || undefined,
          commitment: "confirmed",
        }),
        anchor.Wallet.local(),
      )
    : anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program = anchor.workspace.OracleTrading as Program<OracleTrading>;
  const merchant = provider.wallet.publicKey;
  const buyer = Keypair.generate();
  const [store] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(STORE_SEED)],
    program.programId,
  );
  const [receipt] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(RECEIPT_SEED), buyer.publicKey.toBuffer()],
    program.programId,
  );
  const [mockPrice] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(MOCK_PRICE_SEED)],
    program.programId,
  );

  before(async () => {
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: merchant,
          toPubkey: buyer.publicKey,
          lamports: 2 * LAMPORTS_PER_SOL,
        }),
      ),
    );

    await program.methods
      .initializeStore(new anchor.BN(2_500), mockPrice)
      .accountsPartial({
        store,
        merchant,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("uses the SOL/USD oracle price to charge a USD-priced token purchase", async () => {
    await program.methods
      .upsertMockPrice(new anchor.BN(10_000), -2, new anchor.BN(10))
      .accountsPartial({
        payer: merchant,
        priceUpdate: mockPrice,
      })
      .rpc({ commitment: "confirmed" });

    await program.methods
      .buyToken(new anchor.BN(2), new anchor.BN(600_000_000))
      .accountsPartial({
        store,
        receipt,
        buyer: buyer.publicKey,
        merchant,
        priceUpdate: mockPrice,
      })
      .signers([buyer])
      .rpc({ commitment: "confirmed" });

    const storeState = await program.account.store.fetch(store);
    assert.equal(storeState.tokenPriceUsdCents.toString(), "2500");
    assert.equal(storeState.soldCount.toString(), "2");

    const receiptState = await program.account.purchaseReceipt.fetch(receipt);
    assert.equal(receiptState.buyer.toBase58(), buyer.publicKey.toBase58());
    assert.equal(receiptState.totalQuantity.toString(), "2");
    assert.equal(receiptState.totalPaidLamports.toString(), "500000000");
    assert.equal(receiptState.lastUnitPriceUsdCents.toString(), "2500");
    assert.equal(receiptState.lastPaidLamports.toString(), "500000000");
    assert.equal(receiptState.oraclePrice.toString(), "10000");
    assert.equal(receiptState.oracleExponent, -2);
  });

  it("rejects a purchase when the oracle-derived SOL cost exceeds max_lamports", async () => {
    await program.methods
      .upsertMockPrice(new anchor.BN(5_000), -2, new anchor.BN(10))
      .accountsPartial({
        payer: merchant,
        priceUpdate: mockPrice,
      })
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .buyToken(new anchor.BN(1), new anchor.BN(400_000_000))
        .accountsPartial({
          store,
          receipt,
          buyer: buyer.publicKey,
          merchant,
          priceUpdate: mockPrice,
        })
        .signers([buyer])
        .rpc({ commitment: "confirmed" });
      assert.fail("expected max_lamports check to reject the purchase");
    } catch (error) {
      assert.include(String(error), "PaymentTooHigh");
    }
  });
});
