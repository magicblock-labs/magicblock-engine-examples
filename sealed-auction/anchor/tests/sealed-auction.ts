import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import {
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  delegateSpl,
  getAuthToken,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { expect } from "chai";
import * as nacl from "tweetnacl";

import { SealedAuction } from "../target/types/sealed_auction";

type IdlInstruction = {
  name: string;
  args: { name: string }[];
  accounts: { name: string }[];
};

const idl = require("../target/idl/sealed_auction.json") as {
  instructions: IdlInstruction[];
  types: {
    name: string;
    type: {
      kind: string;
      fields?: { name: string }[];
    };
  }[];
};

const AUCTION_SEED = Buffer.from("auction");
const BID_SEED = Buffer.from("bid");
const LOT_AMOUNT = new BN(100);
const BID_ONE = new BN(40);
const BID_TWO = new BN(55);
const SPONSOR_LAMPORTS = new BN(100_000_000);
const RUN_E2E = process.env.RUN_SEALED_AUCTION_E2E === "1";
const RUN_LIVE = process.env.RUN_SEALED_AUCTION_LIVE === "1";
const VALIDATOR = new web3.PublicKey(
  process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);
const EPHEMERAL_SPL_TOKEN_PROGRAM_ID = new web3.PublicKey(
  "SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2",
);
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const SCHEDULED_COMMIT_PREFIX = "ScheduledCommitSent signature: ";
const COMMIT_PREFIX = "ScheduledCommitSent signature[0]: ";

function pda(seeds: Buffer[], programId: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function u64(value: BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

function auctionPda(
  programId: web3.PublicKey,
  auctioneer: web3.PublicKey,
  auctionId: BN,
): web3.PublicKey {
  return pda([AUCTION_SEED, auctioneer.toBuffer(), u64(auctionId)], programId);
}

function bidPda(
  programId: web3.PublicKey,
  auction: web3.PublicKey,
  bidder: web3.PublicKey,
): web3.PublicKey {
  return pda([BID_SEED, auction.toBuffer(), bidder.toBuffer()], programId);
}

function ephemeralAtaPda(
  owner: web3.PublicKey,
  mint: web3.PublicKey,
): web3.PublicKey {
  return pda(
    [owner.toBuffer(), mint.toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  );
}

function eataBufferPda(ephemeralAta: web3.PublicKey): web3.PublicKey {
  return pda(
    [Buffer.from("buffer"), ephemeralAta.toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  );
}

function delegationRecordPda(ephemeralAta: web3.PublicKey): web3.PublicKey {
  return pda(
    [Buffer.from("delegation"), ephemeralAta.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
}

function delegationMetadataPda(ephemeralAta: web3.PublicKey): web3.PublicKey {
  return pda(
    [Buffer.from("delegation-metadata"), ephemeralAta.toBuffer()],
    DELEGATION_PROGRAM_ID,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntilUnixTimestamp(timestamp: BN): Promise<void> {
  const waitMs = timestamp.toNumber() * 1_000 - Date.now() + 1_000;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function uniqueAuctionId(): BN {
  return new BN(Date.now()).add(new BN(Math.floor(Math.random() * 1_000_000)));
}

function statusName(status: Record<string, unknown>): string {
  return Object.keys(status)[0];
}

async function expectAnchorError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const anchorError = error as {
      error?: { errorCode?: { code?: string } };
    };
    const code = anchorError.error?.errorCode?.code;
    if (code) {
      expect(code).to.equal(expectedCode);
      return;
    }

    expect(String(error)).to.include(expectedCode);
    return;
  }

  throw new Error(`Expected ${expectedCode} but instruction succeeded`);
}

async function sendLocalTransaction(
  connection: web3.Connection,
  transaction: web3.Transaction,
  feePayer: web3.Keypair,
  signers: web3.Keypair[] = [],
  label = "transaction",
): Promise<string> {
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const signerMap = new Map<string, web3.Keypair>();
  [feePayer, ...signers].forEach((signer) =>
    signerMap.set(signer.publicKey.toBase58(), signer),
  );

  transaction.feePayer = feePayer.publicKey;
  transaction.recentBlockhash = blockhash.blockhash;
  transaction.partialSign(...signerMap.values());

  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: true },
  );
  const status = await connection.confirmTransaction(
    { signature, ...blockhash },
    "confirmed",
  );
  if (status.value.err) {
    throw new Error(
      `${label} ${signature} failed: ${JSON.stringify(status.value.err)}`,
    );
  }

  return signature;
}

function findLogValue(logMessages: string[], prefix: string): string | null {
  const message = logMessages.find((log) => log.includes(prefix));
  return message ? message.split(prefix)[1] : null;
}

async function getCommitmentSignature(
  label: string,
  transactionSignature: string,
  ephemeralConnection: web3.Connection,
): Promise<string> {
  const schedulingTransaction = await ephemeralConnection.getTransaction(
    transactionSignature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  );
  if (!schedulingTransaction?.meta) {
    throw new Error(`${label}: scheduling transaction not found`);
  }

  const scheduledCommitSignature = findLogValue(
    schedulingTransaction.meta.logMessages ?? [],
    SCHEDULED_COMMIT_PREFIX,
  );
  if (!scheduledCommitSignature) {
    throw new Error(`${label}: scheduled commit signature not found`);
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const scheduledTransaction = await ephemeralConnection.getTransaction(
      scheduledCommitSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    const commitmentSignature = findLogValue(
      scheduledTransaction?.meta?.logMessages ?? [],
      COMMIT_PREFIX,
    );
    if (commitmentSignature) {
      return commitmentSignature;
    }
    await sleep(1_000);
  }

  throw new Error(`${label}: committed base transaction not found`);
}

describe("sealed-auction", () => {
  const provider = anchor.AnchorProvider.local(
    process.env.PROVIDER_ENDPOINT || "http://localhost:8899",
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.SealedAuction as Program<SealedAuction>;
  const erConnection = new web3.Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "http://localhost:7799",
    {
      wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "ws://localhost:7800",
      commitment: "confirmed",
    },
  );
  const erProvider = new anchor.AnchorProvider(erConnection, provider.wallet);
  const erProgram = new Program(
    program.idl,
    erProvider,
  ) as Program<SealedAuction>;
  const auctioneer = provider.wallet.payer;
  const bidderOne = web3.Keypair.generate();
  const bidderTwo = web3.Keypair.generate();
  const auctionId = new BN(Date.now());
  const deadlineTs = new BN(Math.floor(Date.now() / 1000) + 3);

  const teeUrl = process.env.TEE_PROVIDER_ENDPOINT || "http://localhost:6699";
  const teeWsUrl = process.env.TEE_WS_ENDPOINT || "ws://localhost:6700";

  let tokenA: web3.PublicKey;
  let tokenB: web3.PublicKey;
  let auction: web3.PublicKey;
  let bidOne: web3.PublicKey;
  let bidTwo: web3.PublicKey;
  let localE2eAvailable = false;
  let localE2eSkipReason = "local validator availability was not checked";

  type BaseAuctionFixture = {
    auctionId: BN;
    deadlineTs: BN;
    tokenA: web3.PublicKey;
    tokenB: web3.PublicKey;
    auction: web3.PublicKey;
    auctionTokenA: web3.PublicKey;
    auctionTokenB: web3.PublicKey;
    auctionTokenBEphemeralAta: web3.PublicKey;
    auctionTokenBEataBuffer: web3.PublicKey;
    auctionTokenBEataRecord: web3.PublicKey;
    auctionTokenBEataMetadata: web3.PublicKey;
    sellerTokenA: web3.PublicKey;
    lotAmount: BN;
  };

  before(async () => {
    try {
      await provider.connection.getLatestBlockhash("confirmed");
      const programInfo = await provider.connection.getAccountInfo(
        program.programId,
        "confirmed",
      );
      if (!programInfo) {
        localE2eSkipReason = `program ${program.programId.toBase58()} is not deployed`;
        return;
      }
      localE2eAvailable = true;
      localE2eSkipReason = "";
    } catch (error) {
      localE2eSkipReason = `local validator unavailable: ${String(error)}`;
    }
  });

  function requireLocalE2e(ctx: Mocha.Context): void {
    if (localE2eAvailable) {
      return;
    }
    if (RUN_E2E) {
      throw new Error(localE2eSkipReason);
    }
    ctx.skip();
  }

  async function authenticatedErConnection(
    authority: web3.Keypair,
  ): Promise<web3.Connection> {
    const teeBase = teeUrl.replace(/\/$/, "");
    const teeWsBase = teeWsUrl.replace(/\/$/, "");
    const authToken = await getAuthToken(
      teeBase,
      authority.publicKey,
      (message: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(message, authority.secretKey)),
    );
    return new web3.Connection(`${teeBase}?token=${authToken.token}`, {
      wsEndpoint: `${teeWsBase}?token=${authToken.token}`,
      commitment: "confirmed",
    });
  }

  async function createBaseAuctionFixture(
    deadlineOffsetSeconds: number,
    lotAmount = LOT_AMOUNT,
  ): Promise<BaseAuctionFixture> {
    const tokenAMint = await createMint(
      provider.connection,
      auctioneer,
      auctioneer.publicKey,
      null,
      0,
    );
    const tokenBMint = await createMint(
      provider.connection,
      auctioneer,
      auctioneer.publicKey,
      null,
      0,
    );
    const sellerTokenA = await createAssociatedTokenAccount(
      provider.connection,
      auctioneer,
      tokenAMint,
      auctioneer.publicKey,
    );
    await mintTo(
      provider.connection,
      auctioneer,
      tokenAMint,
      sellerTokenA,
      auctioneer,
      BigInt(lotAmount.toString()),
    );

    const localAuctionId = uniqueAuctionId();
    const localAuction = auctionPda(
      program.programId,
      auctioneer.publicKey,
      localAuctionId,
    );
    const auctionTokenA = getAssociatedTokenAddressSync(
      tokenAMint,
      localAuction,
      true,
    );
    const auctionTokenB = getAssociatedTokenAddressSync(
      tokenBMint,
      localAuction,
      true,
    );
    const auctionTokenBEphemeralAta = ephemeralAtaPda(localAuction, tokenBMint);

    return {
      auctionId: localAuctionId,
      deadlineTs: new BN(Math.floor(Date.now() / 1000) + deadlineOffsetSeconds),
      tokenA: tokenAMint,
      tokenB: tokenBMint,
      auction: localAuction,
      auctionTokenA,
      auctionTokenB,
      auctionTokenBEphemeralAta,
      auctionTokenBEataBuffer: eataBufferPda(auctionTokenBEphemeralAta),
      auctionTokenBEataRecord: delegationRecordPda(auctionTokenBEphemeralAta),
      auctionTokenBEataMetadata: delegationMetadataPda(
        auctionTokenBEphemeralAta,
      ),
      sellerTokenA,
      lotAmount,
    };
  }

  async function initializeAuction(
    fixture: BaseAuctionFixture,
    deadlineTs = fixture.deadlineTs,
    lotAmount = fixture.lotAmount,
  ): Promise<void> {
    await program.methods
      .initializeAuction(
        fixture.auctionId,
        lotAmount,
        deadlineTs,
        SPONSOR_LAMPORTS,
      )
      .accountsPartial({
        auctioneer: auctioneer.publicKey,
        tokenAMint: fixture.tokenA,
        tokenBMint: fixture.tokenB,
        auction: fixture.auction,
        auctionTokenAAccount: fixture.auctionTokenA,
        auctionTokenBAccount: fixture.auctionTokenB,
        auctionTokenBEphemeralAta: fixture.auctionTokenBEphemeralAta,
        auctionTokenBEataBuffer: fixture.auctionTokenBEataBuffer,
        auctionTokenBEataRecord: fixture.auctionTokenBEataRecord,
        auctionTokenBEataMetadata: fixture.auctionTokenBEataMetadata,
        sellerTokenAAccount: fixture.sellerTokenA,
        ephemeralTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        validator: VALIDATOR,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  it("keeps Token A on L1 and uses an auction Token-B ER escrow", () => {
    tokenA = web3.Keypair.generate().publicKey;
    tokenB = web3.Keypair.generate().publicKey;
    auction = auctionPda(program.programId, auctioneer.publicKey, auctionId);
    bidOne = bidPda(program.programId, auction, bidderOne.publicKey);
    bidTwo = bidPda(program.programId, auction, bidderTwo.publicKey);

    const auctionTokenA = getAssociatedTokenAddressSync(tokenA, auction, true);
    const auctionTokenB = getAssociatedTokenAddressSync(tokenB, auction, true);
    const bidderOneTokenB = getAssociatedTokenAddressSync(
      tokenB,
      bidderOne.publicKey,
    );
    const auctionTokenBEphemeralAta = ephemeralAtaPda(auction, tokenB);

    expect(auction.equals(web3.PublicKey.default)).to.equal(false);
    expect(bidOne.equals(bidTwo)).to.equal(false);
    expect(auctionTokenA.equals(auctionTokenB)).to.equal(false);
    expect(auctionTokenB.equals(bidderOneTokenB)).to.equal(false);
    expect(auctionTokenBEphemeralAta.equals(auctionTokenB)).to.equal(false);
    expect(
      eataBufferPda(auctionTokenBEphemeralAta).equals(web3.PublicKey.default),
    ).to.equal(false);

    expect(
      permissionPdaFromAccount(auction).equals(web3.PublicKey.default),
    ).to.equal(false);
    expect(
      permissionPdaFromAccount(bidOne).equals(web3.PublicKey.default),
    ).to.equal(false);
  });

  it("matches the fixed instruction surface", () => {
    const instructionNames = idl.instructions
      .map((instruction) => instruction.name)
      .sort();

    expect(instructionNames).to.deep.equal([
      "claim_refund",
      "delegate_auction",
      "end_auction",
      "finalize",
      "init_auction_permission",
      "init_bid_permission",
      "initialize_auction",
      "place_bid",
      "process_undelegation",
      "reclaim_unsold_lot",
      "settle_winning_bid",
      "undelegate_auction",
    ]);
    expect(instructionNames).not.to.include("initialize_lot_escrow");
    expect(instructionNames).not.to.include("undelegate_lot_escrow");
    expect(instructionNames).not.to.include("undelegate_bid_escrow");
    expect(instructionNames).not.to.include("top_up_auction_sponsor");
    expect(instructionNames).not.to.include("delegate_auction_sponsor");
    expect(instructionNames).not.to.include("close_winning_bid");
  });

  it("does not reintroduce Token A e-token custody accounts", () => {
    const byName = new Map(
      idl.instructions.map((instruction) => [instruction.name, instruction]),
    );
    const initializeAccounts =
      byName
        .get("initialize_auction")
        ?.accounts.map((account) => account.name) ?? [];
    const placeBidAccounts =
      byName.get("place_bid")?.accounts.map((account) => account.name) ?? [];
    const finalizeAccounts =
      byName.get("finalize")?.accounts.map((account) => account.name) ?? [];
    const settleWinningBidAccounts =
      byName
        .get("settle_winning_bid")
        ?.accounts.map((account) => account.name) ?? [];
    const claimRefundAccounts =
      byName.get("claim_refund")?.accounts.map((account) => account.name) ?? [];

    expect(initializeAccounts).to.include("auction_token_a_account");
    expect(initializeAccounts).to.include("auction_token_b_account");
    expect(initializeAccounts).to.include("auction_token_b_ephemeral_ata");
    expect(initializeAccounts).to.include("ephemeral_token_program");
    expect(initializeAccounts).not.to.include("auction_sponsor");
    expect(initializeAccounts).not.to.include("lot_ephemeral_ata");
    expect(placeBidAccounts).to.include("payer");
    expect(placeBidAccounts).to.include("auction");
    expect(placeBidAccounts).not.to.include("auction_sponsor");
    expect(placeBidAccounts).to.include("bid");
    expect(placeBidAccounts).to.include("bidder_token_b_account");
    expect(placeBidAccounts).to.include("auction_token_b_account");
    expect(placeBidAccounts).not.to.include("bid_token_b_account");
    expect(placeBidAccounts).not.to.include("token_b_vault");
    expect(finalizeAccounts).to.include("auction_token_a_account");
    expect(finalizeAccounts).not.to.include("winning_bid_token_b_account");
    expect(finalizeAccounts).not.to.include("seller_token_b_account");
    expect(settleWinningBidAccounts).to.include("auction_token_b_account");
    expect(settleWinningBidAccounts).not.to.include(
      "winning_bid_token_b_account",
    );
    expect(settleWinningBidAccounts).to.include("seller_token_b_account");
    expect(settleWinningBidAccounts).to.include("auction");
    expect(settleWinningBidAccounts).not.to.include("auction_sponsor");
    expect(claimRefundAccounts).to.include("auction");
    expect(claimRefundAccounts).to.include("auction_token_b_account");
    expect(claimRefundAccounts).not.to.include("bid_token_b_account");
    expect(claimRefundAccounts).not.to.include("auction_sponsor");
    expect(finalizeAccounts).not.to.include("lot_ephemeral_ata");
    expect(finalizeAccounts).not.to.include("token_a_vault");
  });

  it("matches the auction-sponsored count-only bid lifecycle", () => {
    const byName = new Map(
      idl.instructions.map((instruction) => [instruction.name, instruction]),
    );
    const initializeAuctionInstruction = byName.get("initialize_auction");
    const endAuctionAccounts =
      byName.get("end_auction")?.accounts.map((account) => account.name) ?? [];
    const settleWinningBidAccounts =
      byName
        .get("settle_winning_bid")
        ?.accounts.map((account) => account.name) ?? [];
    const claimRefundAccounts =
      byName.get("claim_refund")?.accounts.map((account) => account.name) ?? [];
    const undelegateAuctionAccounts =
      byName
        .get("undelegate_auction")
        ?.accounts.map((account) => account.name) ?? [];
    const auctionFields =
      idl.types
        .find((typeDef) => typeDef.name === "Auction")
        ?.type.fields?.map((field) => field.name) ?? [];
    const typeNames = idl.types.map((typeDef) => typeDef.name);

    expect(
      initializeAuctionInstruction?.args.map((arg) => arg.name),
    ).to.include("sponsor_lamports");
    expect(auctionFields).to.include("bid_count");
    expect(auctionFields).to.include("closed_bid_count");
    expect(auctionFields).not.to.include("bidders");
    expect(auctionFields).not.to.include("bidder_count");
    expect(typeNames).not.to.include("AuctionSponsor");
    expect(endAuctionAccounts).to.deep.equal(["auctioneer", "auction"]);
    expect(settleWinningBidAccounts).to.include("auction");
    expect(settleWinningBidAccounts).to.include("winning_bid");
    expect(claimRefundAccounts).to.include("auction");
    expect(claimRefundAccounts).to.include("bid");
    expect(undelegateAuctionAccounts).to.include("magic_context");
    expect(undelegateAuctionAccounts).to.include("magic_program");
  });

  it("initializes an auction and moves the Token A lot into L1 custody", async function () {
    requireLocalE2e(this);

    const fixture = await createBaseAuctionFixture(60);
    await initializeAuction(fixture);

    const auctionState = await program.account.auction.fetch(fixture.auction);
    const sellerTokenA = await getAccount(
      provider.connection,
      fixture.sellerTokenA,
    );
    const auctionTokenA = await getAccount(
      provider.connection,
      fixture.auctionTokenA,
    );
    const auctionLamports = await provider.connection.getBalance(
      fixture.auction,
    );

    expect(auctionState.auctioneer.equals(auctioneer.publicKey)).to.equal(true);
    expect(auctionState.auctionId.eq(fixture.auctionId)).to.equal(true);
    expect(auctionState.tokenAMint.equals(fixture.tokenA)).to.equal(true);
    expect(auctionState.tokenBMint.equals(fixture.tokenB)).to.equal(true);
    expect(auctionState.lotAmount.eq(fixture.lotAmount)).to.equal(true);
    expect(auctionState.bidCount).to.equal(0);
    expect(auctionState.closedBidCount).to.equal(0);
    expect(statusName(auctionState.status)).to.equal("open");
    expect(auctionState.lotClaimed).to.equal(false);
    expect(auctionLamports).to.be.at.least(SPONSOR_LAMPORTS.toNumber());
    expect(sellerTokenA.amount).to.equal(BigInt(0));
    expect(auctionTokenA.amount).to.equal(BigInt(fixture.lotAmount.toString()));
  });

  it("rejects invalid auction initialization parameters", async function () {
    requireLocalE2e(this);

    const zeroLotFixture = await createBaseAuctionFixture(60);
    await expectAnchorError(
      initializeAuction(zeroLotFixture, zeroLotFixture.deadlineTs, new BN(0)),
      "InvalidAmount",
    );

    const expiredFixture = await createBaseAuctionFixture(-1);
    await expectAnchorError(
      initializeAuction(expiredFixture),
      "DeadlineInPast",
    );
  });

  it("rejects reclaim before end_auction", async function () {
    requireLocalE2e(this);

    const fixture = await createBaseAuctionFixture(60);
    await initializeAuction(fixture);

    await expectAnchorError(
      program.methods
        .reclaimUnsoldLot(fixture.auctionId)
        .accountsPartial({
          auction: fixture.auction,
          tokenAMint: fixture.tokenA,
          auctionTokenAAccount: fixture.auctionTokenA,
          sellerTokenAAccount: fixture.sellerTokenA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "AuctionNotEnded",
    );
  });

  it("runs live ER bid settlement, refund, undelegation, and L1 finalize", async function () {
    if (!RUN_LIVE) {
      this.skip();
    }
    requireLocalE2e(this);

    const fixture = await createBaseAuctionFixture(90);
    await initializeAuction(fixture);

    await sendLocalTransaction(
      provider.connection,
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: auctioneer.publicKey,
          toPubkey: bidderOne.publicKey,
          lamports: web3.LAMPORTS_PER_SOL,
        }),
        web3.SystemProgram.transfer({
          fromPubkey: auctioneer.publicKey,
          toPubkey: bidderTwo.publicKey,
          lamports: web3.LAMPORTS_PER_SOL,
        }),
      ),
      auctioneer,
      [],
      "fund bidders",
    );

    const bidderOneTokenB = await createAssociatedTokenAccount(
      provider.connection,
      auctioneer,
      fixture.tokenB,
      bidderOne.publicKey,
    );
    const bidderTwoTokenB = await createAssociatedTokenAccount(
      provider.connection,
      auctioneer,
      fixture.tokenB,
      bidderTwo.publicKey,
    );
    const sellerTokenB = await createAssociatedTokenAccount(
      provider.connection,
      auctioneer,
      fixture.tokenB,
      auctioneer.publicKey,
    );
    const winnerTokenA = await createAssociatedTokenAccount(
      provider.connection,
      auctioneer,
      fixture.tokenA,
      bidderTwo.publicKey,
    );

    await mintTo(
      provider.connection,
      auctioneer,
      fixture.tokenB,
      bidderOneTokenB,
      auctioneer,
      BigInt(BID_ONE.toString()),
    );
    await mintTo(
      provider.connection,
      auctioneer,
      fixture.tokenB,
      bidderTwoTokenB,
      auctioneer,
      BigInt(BID_TWO.toString()),
    );
    await mintTo(
      provider.connection,
      auctioneer,
      fixture.tokenB,
      sellerTokenB,
      auctioneer,
      BigInt(1),
    );

    const delegateAuctionTx = await program.methods
      .delegateAuction(fixture.auctionId)
      .accountsPartial({
        auctioneer: auctioneer.publicKey,
        auction: fixture.auction,
        validator: VALIDATOR,
      })
      .transaction();
    await sendLocalTransaction(
      provider.connection,
      delegateAuctionTx,
      auctioneer,
      [],
      "delegate auction",
    );

    await sleep(3_000);

    const privateErConnection = await authenticatedErConnection(auctioneer);
    const privateErProvider = new anchor.AnchorProvider(
      privateErConnection,
      provider.wallet,
    );
    const privateErProgram = new Program(
      program.idl,
      privateErProvider,
    ) as Program<SealedAuction>;

    for (const [owner, amount, initVaultIfMissing, label] of [
      [bidderOne, BID_ONE, true, "delegate bidder one token B"],
      [bidderTwo, BID_TWO, false, "delegate bidder two token B"],
      [auctioneer, new BN(1), false, "delegate seller token B"],
    ] as [web3.Keypair, BN, boolean, string][]) {
      const delegateIxs = await delegateSpl(
        owner.publicKey,
        fixture.tokenB,
        BigInt(amount.toString()),
        {
          validator: VALIDATOR,
          idempotent: false,
          initVaultIfMissing,
          payer: auctioneer.publicKey,
        },
      );
      await sendLocalTransaction(
        provider.connection,
        new web3.Transaction().add(...delegateIxs),
        auctioneer,
        owner.publicKey.equals(auctioneer.publicKey) ? [] : [owner],
        label,
      );
    }

    const liveBidOne = bidPda(
      program.programId,
      fixture.auction,
      bidderOne.publicKey,
    );
    const liveBidTwo = bidPda(
      program.programId,
      fixture.auction,
      bidderTwo.publicKey,
    );
    await sleep(1_000);

    for (const [bidder, amount, bid, bidderTokenB] of [
      [bidderOne, BID_ONE, liveBidOne, bidderOneTokenB],
      [bidderTwo, BID_TWO, liveBidTwo, bidderTwoTokenB],
    ] as [web3.Keypair, BN, web3.PublicKey, web3.PublicKey][]) {
      const placeBidTx = await privateErProgram.methods
        .placeBid(fixture.auctionId, amount)
        .accountsPartial({
          payer: auctioneer.publicKey,
          bidder: bidder.publicKey,
          tokenBMint: fixture.tokenB,
          auction: fixture.auction,
          bid,
          bidderTokenBAccount: bidderTokenB,
          auctionTokenBAccount: fixture.auctionTokenB,
          tokenProgram: TOKEN_PROGRAM_ID,
          vault: EPHEMERAL_VAULT_ID,
        })
        .transaction();
      await sendLocalTransaction(
        privateErConnection,
        placeBidTx,
        auctioneer,
        [bidder],
        ["place bid", bidder.publicKey.toBase58()].join(" "),
      );

      const initBidPermissionTx = await privateErProgram.methods
        .initBidPermission(fixture.auctionId)
        .accountsPartial({
          auction: fixture.auction,
          bid,
          bidPermission: permissionPdaFromAccount(bid),
          permissionProgram: PERMISSION_PROGRAM_ID,
          ephemeralVault: EPHEMERAL_VAULT_ID,
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .transaction();
      await sendLocalTransaction(
        privateErConnection,
        initBidPermissionTx,
        auctioneer,
        [],
        ["init bid permission", bidder.publicKey.toBase58()].join(" "),
      );
    }

    let auctionState = await privateErProgram.account.auction.fetch(
      fixture.auction,
    );
    expect(auctionState.bidCount).to.equal(2);
    expect(auctionState.closedBidCount).to.equal(0);
    expect(
      (await getAccount(erConnection, fixture.auctionTokenB)).amount,
    ).to.equal(BigInt(BID_ONE.add(BID_TWO).toString()));

    await sleepUntilUnixTimestamp(fixture.deadlineTs);

    const endAuctionTx = await privateErProgram.methods
      .endAuction(fixture.auctionId)
      .accountsPartial({
        auctioneer: auctioneer.publicKey,
        auction: fixture.auction,
      })
      .remainingAccounts([
        { pubkey: liveBidOne, isSigner: false, isWritable: true },
        { pubkey: liveBidTwo, isSigner: false, isWritable: true },
      ])
      .transaction();
    await sendLocalTransaction(
      privateErConnection,
      endAuctionTx,
      auctioneer,
      [],
      "end auction",
    );

    auctionState = await privateErProgram.account.auction.fetch(
      fixture.auction,
    );
    expect(statusName(auctionState.status)).to.equal("ended");
    expect(auctionState.highestBid.eq(BID_TWO)).to.equal(true);
    expect(auctionState.highestBidder.equals(bidderTwo.publicKey)).to.equal(
      true,
    );

    const settleTx = await privateErProgram.methods
      .settleWinningBid()
      .accountsPartial({
        crank: auctioneer.publicKey,
        auction: fixture.auction,
        winningBid: liveBidTwo,
        tokenBMint: fixture.tokenB,
        auctionTokenBAccount: fixture.auctionTokenB,
        sellerTokenBAccount: sellerTokenB,
        bidPermission: permissionPdaFromAccount(liveBidTwo),
        permissionProgram: PERMISSION_PROGRAM_ID,
        magicProgram: MAGIC_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        vault: EPHEMERAL_VAULT_ID,
      })
      .transaction();
    await sendLocalTransaction(
      privateErConnection,
      settleTx,
      auctioneer,
      [],
      "settle winning bid",
    );

    expect((await getAccount(erConnection, sellerTokenB)).amount).to.equal(
      BigInt(BID_TWO.add(new BN(1)).toString()),
    );
    expect(await privateErConnection.getAccountInfo(liveBidTwo)).to.equal(null);

    const refundTx = await privateErProgram.methods
      .claimRefund()
      .accountsPartial({
        bidder: bidderOne.publicKey,
        auction: fixture.auction,
        bid: liveBidOne,
        tokenBMint: fixture.tokenB,
        auctionTokenBAccount: fixture.auctionTokenB,
        bidderTokenBAccount: bidderOneTokenB,
        bidPermission: permissionPdaFromAccount(liveBidOne),
        permissionProgram: PERMISSION_PROGRAM_ID,
        magicProgram: MAGIC_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        vault: EPHEMERAL_VAULT_ID,
      })
      .transaction();
    await sendLocalTransaction(
      privateErConnection,
      refundTx,
      auctioneer,
      [],
      "claim refund",
    );

    auctionState = await privateErProgram.account.auction.fetch(
      fixture.auction,
    );
    expect(auctionState.closedBidCount).to.equal(2);
    expect((await getAccount(erConnection, bidderOneTokenB)).amount).to.equal(
      BigInt(BID_ONE.toString()),
    );
    expect(await privateErConnection.getAccountInfo(liveBidOne)).to.equal(null);

    const undelegateTx = await privateErProgram.methods
      .undelegateAuction(fixture.auctionId)
      .accountsPartial({
        payer: auctioneer.publicKey,
        auction: fixture.auction,
        magicContext: MAGIC_CONTEXT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();
    const undelegateSig = await sendLocalTransaction(
      privateErConnection,
      undelegateTx,
      auctioneer,
      [],
      "undelegate auction",
    );
    await provider.connection.confirmTransaction(
      await getCommitmentSignature(
        "auction undelegate",
        undelegateSig,
        privateErConnection,
      ),
      "confirmed",
    );
    await sleep(1_000);

    await program.methods
      .finalize(fixture.auctionId)
      .accountsPartial({
        auction: fixture.auction,
        tokenAMint: fixture.tokenA,
        auctionTokenAAccount: fixture.auctionTokenA,
        winnerTokenAAccount: winnerTokenA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });

    const finalizedAuction = await program.account.auction.fetch(
      fixture.auction,
    );
    expect(statusName(finalizedAuction.status)).to.equal("settled");
    expect(finalizedAuction.lotClaimed).to.equal(true);
    expect(
      (await getAccount(provider.connection, winnerTokenA)).amount,
    ).to.equal(BigInt(fixture.lotAmount.toString()));
  });

  it("ends an empty auction and lets the seller reclaim the unsold lot", async function () {
    if (!RUN_LIVE) {
      this.skip();
    }
    requireLocalE2e(this);

    const fixture = await createBaseAuctionFixture(1);
    await initializeAuction(fixture);
    await sleep(1_500);

    await program.methods
      .endAuction(fixture.auctionId)
      .accountsPartial({
        auctioneer: auctioneer.publicKey,
        auction: fixture.auction,
      })
      .rpc();

    const endedAuction = await program.account.auction.fetch(fixture.auction);
    expect(statusName(endedAuction.status)).to.equal("ended");
    expect(endedAuction.highestBid.toNumber()).to.equal(0);
    expect(endedAuction.highestBidder.equals(web3.PublicKey.default)).to.equal(
      true,
    );

    await program.methods
      .reclaimUnsoldLot(fixture.auctionId)
      .accountsPartial({
        auction: fixture.auction,
        tokenAMint: fixture.tokenA,
        auctionTokenAAccount: fixture.auctionTokenA,
        sellerTokenAAccount: fixture.sellerTokenA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const settledAuction = await program.account.auction.fetch(fixture.auction);
    const sellerTokenA = await getAccount(
      provider.connection,
      fixture.sellerTokenA,
    );
    const auctionTokenA = await getAccount(
      provider.connection,
      fixture.auctionTokenA,
    );

    expect(statusName(settledAuction.status)).to.equal("settled");
    expect(settledAuction.lotClaimed).to.equal(true);
    expect(sellerTokenA.amount).to.equal(BigInt(fixture.lotAmount.toString()));
    expect(auctionTokenA.amount).to.equal(BigInt(0));
  });

  it("can create TEE-authenticated bidder connections for privacy probes", async function () {
    if (!RUN_LIVE) {
      this.skip();
    }

    const tokenOne = await getAuthToken(
      teeUrl,
      bidderOne.publicKey,
      (message: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(message, bidderOne.secretKey)),
    );
    const tokenTwo = await getAuthToken(
      teeUrl,
      bidderTwo.publicKey,
      (message: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(message, bidderTwo.secretKey)),
    );

    const bidderOneConnection = new web3.Connection(
      `${teeUrl}?token=${tokenOne.token}`,
      { wsEndpoint: `${teeWsUrl}?token=${tokenOne.token}` },
    );
    const bidderTwoConnection = new web3.Connection(
      `${teeUrl}?token=${tokenTwo.token}`,
      { wsEndpoint: `${teeWsUrl}?token=${tokenTwo.token}` },
    );

    expect(tokenOne.token.length).to.be.greaterThan(0);
    expect(tokenTwo.token.length).to.be.greaterThan(0);
    await Promise.all([
      bidderOneConnection.getLatestBlockhash("confirmed"),
      bidderTwoConnection.getLatestBlockhash("confirmed"),
    ]);
  });

  it("checks settlement constants", () => {
    expect(BID_TWO.gt(BID_ONE)).to.equal(true);
    expect(LOT_AMOUNT.gt(new BN(0))).to.equal(true);
    expect(VALIDATOR.equals(web3.PublicKey.default)).to.equal(false);
    expect(MAGIC_CONTEXT_ID.equals(MAGIC_PROGRAM_ID)).to.equal(false);
    expect(PERMISSION_PROGRAM_ID.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).to.equal(
      false,
    );
    expect(TOKEN_PROGRAM_ID.equals(program.programId)).to.equal(false);
    expect(deadlineTs.gt(new BN(0))).to.equal(true);
  });
});
