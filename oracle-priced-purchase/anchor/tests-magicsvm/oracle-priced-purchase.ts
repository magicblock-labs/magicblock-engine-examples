import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MagicSVM } from "@magicblock-labs/magicsvm";
import {
  airdropOrThrow,
  bootAnchorSvm,
  sendSvmIx,
  setUnixTimestamp,
} from "@magicblock-labs/test-utils";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import { OraclePricedPurchase } from "../target/types/oracle_priced_purchase";

const RECEIPT_SEED = "receipt";
const STORE_SEED = "store";
const SOL_USD_100_PRICE = new PublicKey(
  "B8vx8v7SwZsmFYz3fkSJphr7uq34LoiVr18pimLG5FJM",
);
const SOL_USD_50_PRICE = new PublicKey(
  "EpdAP2KHQAXPccREjM1WsLiyKVcchYj82pv9sWZhYUY1",
);
const SOL_USD_100_FEED_ID = Array.from(
  Buffer.from(
    "969cefe5a1c3dc424aeaf191893d642799b8545431b5e2560e1cc78ccfdd91d6",
    "hex",
  ),
);
const SOL_USD_50_FEED_ID = Array.from(
  Buffer.from(
    "cd5b1dc2e5486ee8a1fa93a76ad56a1d15fef45c54fac50c7b489f1f3be0136a",
    "hex",
  ),
);
const PRICE_PUBLISH_TIME_OFFSET = 93;
const FIXTURES_DIR = path.join(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "accounts",
);

type FixtureAccount = {
  pubkey: string;
  account: {
    lamports: number;
    data: [string, string];
    owner: string;
    executable: boolean;
    rentEpoch?: number;
  };
};

function loadOracleFixtures(svm: MagicSVM): bigint {
  let publishTime = 0n;
  for (const file of fs.readdirSync(FIXTURES_DIR)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const fixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"),
    ) as FixtureAccount;
    const encoding = fixture.account.data[1] as BufferEncoding;
    const data = Buffer.from(fixture.account.data[0], encoding);
    svm.setAccount({
      address: fixture.pubkey,
      executable: fixture.account.executable,
      lamports: BigInt(fixture.account.lamports),
      programAddress: fixture.account.owner,
      space: BigInt(data.length),
      data: new Uint8Array(data),
    });
    if (data.length > PRICE_PUBLISH_TIME_OFFSET + 8) {
      publishTime = data.readBigInt64LE(PRICE_PUBLISH_TIME_OFFSET);
    }
  }
  return publishTime;
}

function decodeAccount<T>(
  program: Program<OraclePricedPurchase>,
  name: string,
  address: PublicKey,
  svm: MagicSVM,
): T {
  const account = svm.getAccountFor(address, { target: "base" });
  if (!account.exists) {
    throw new Error(`account ${address.toBase58()} does not exist`);
  }
  return program.coder.accounts.decode(name, Buffer.from(account.data)) as T;
}

describe("oracle-priced-purchase", () => {
  const merchant = Keypair.generate();
  const buyer = Keypair.generate();
  const { svm, program } = bootAnchorSvm<OraclePricedPurchase>({
    fromDir: __dirname,
    programName: "oracle_priced_purchase",
    payer: merchant,
    airdropLamports: BigInt(10 * LAMPORTS_PER_SOL),
  });
  const [store] = PublicKey.findProgramAddressSync(
    [Buffer.from(STORE_SEED)],
    program.programId,
  );
  const [receipt] = PublicKey.findProgramAddressSync(
    [Buffer.from(RECEIPT_SEED), buyer.publicKey.toBuffer()],
    program.programId,
  );

  before(async () => {
    airdropOrThrow(
      svm,
      buyer.publicKey,
      BigInt(2 * LAMPORTS_PER_SOL),
      "airdrop buyer",
    );
    setUnixTimestamp(svm, loadOracleFixtures(svm));
    sendSvmIx(
      svm,
      [merchant],
      await program.methods
        .initializeStore(new anchor.BN(2_500), SOL_USD_100_FEED_ID)
        .accountsPartial({
          store,
          merchant: merchant.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      "base",
    );
  });

  it("uses the SOL/USD oracle price to charge a USD-priced token purchase", async () => {
    sendSvmIx(
      svm,
      [merchant, buyer],
      await program.methods
        .buyToken(new anchor.BN(2), new anchor.BN(600_000_000))
        .accountsPartial({
          store,
          receipt,
          buyer: buyer.publicKey,
          merchant: merchant.publicKey,
          priceUpdate: SOL_USD_100_PRICE,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      "base",
    );

    const storeState = decodeAccount<{
      tokenPriceUsdCents: { toString(): string };
      soldCount: { toString(): string };
    }>(program, "store", store, svm);
    assert.equal(storeState.tokenPriceUsdCents.toString(), "2500");
    assert.equal(storeState.soldCount.toString(), "2");

    const receiptState = decodeAccount<{
      buyer: PublicKey;
      totalQuantity: { toString(): string };
      totalPaidLamports: { toString(): string };
      lastUnitPriceUsdCents: { toString(): string };
      lastPaidLamports: { toString(): string };
      oraclePrice: { toString(): string };
      oracleExponent: number;
    }>(program, "purchaseReceipt", receipt, svm);
    assert.equal(receiptState.buyer.toBase58(), buyer.publicKey.toBase58());
    assert.equal(receiptState.totalQuantity.toString(), "2");
    assert.equal(receiptState.totalPaidLamports.toString(), "500000000");
    assert.equal(receiptState.lastUnitPriceUsdCents.toString(), "2500");
    assert.equal(receiptState.lastPaidLamports.toString(), "500000000");
    assert.equal(receiptState.oraclePrice.toString(), "10000");
    assert.equal(receiptState.oracleExponent, -2);
  });

  it("rejects a purchase when the oracle-derived SOL cost exceeds max_lamports", async () => {
    sendSvmIx(
      svm,
      [merchant],
      await program.methods
        .initializeStore(new anchor.BN(2_500), SOL_USD_50_FEED_ID)
        .accountsPartial({
          store,
          merchant: merchant.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      "base",
    );

    try {
      sendSvmIx(
        svm,
        [merchant, buyer],
        await program.methods
          .buyToken(new anchor.BN(1), new anchor.BN(400_000_000))
          .accountsPartial({
            store,
            receipt,
            buyer: buyer.publicKey,
            merchant: merchant.publicKey,
            priceUpdate: SOL_USD_50_PRICE,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
        "base",
      );
      assert.fail("expected max_lamports check to reject the purchase");
    } catch (error) {
      assert.include(String(error), "PaymentTooHigh");
    }
  });
});
