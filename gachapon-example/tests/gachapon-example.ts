import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { assert } from "chai";
import { GachaponExample } from "../target/types/gachapon_example";

const MACHINE_SEED = "machine";
const TREASURY_SEED = "treasury";
const UPDATE_AUTHORITY_SEED = "update_authority";
const VRF_IDENTITY_SEED = "identity";
const PULL_SEED = "pull";
const ASSET_SEED = "asset";

const MPL_CORE_PROGRAM_ID = new web3.PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);
const VRF_PROGRAM_ID = new web3.PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
const DEFAULT_VRF_QUEUE = new web3.PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
const SLOT_HASHES = new web3.PublicKey(
  "SysvarS1otHashes111111111111111111111111111",
);

const PULL_STATUS_SETTLED = 1;
const ASSET_V1_KEY = 1;
const PLUGIN_HEADER_V1_KEY = 3;
const PLUGIN_REGISTRY_V1_KEY = 4;
const ATTRIBUTES_PLUGIN_TYPE = 6;
const VRF_SETTLEMENT_TIMEOUT_MS = 180_000;
const VRF_SETTLEMENT_POLL_MS = 3_000;

type RewardInput = {
  weight: number;
  name: string;
  uri: string;
};

type Cursor = {
  offset: number;
};

type CoreAsset = {
  owner: web3.PublicKey;
  updateAuthority: web3.PublicKey | null;
  name: string;
  uri: string;
  attributes: Map<string, string>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function u64Le(value: anchor.BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

function readU8(data: Buffer, cursor: Cursor): number {
  const value = data.readUInt8(cursor.offset);
  cursor.offset += 1;
  return value;
}

function readU32(data: Buffer, cursor: Cursor): number {
  const value = data.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  return value;
}

function readU64(data: Buffer, cursor: Cursor): number {
  const lo = data.readUInt32LE(cursor.offset);
  const hi = data.readUInt32LE(cursor.offset + 4);
  cursor.offset += 8;
  return hi * 2 ** 32 + lo;
}

function readPubkey(data: Buffer, cursor: Cursor): web3.PublicKey {
  const value = new web3.PublicKey(
    data.subarray(cursor.offset, cursor.offset + 32),
  );
  cursor.offset += 32;
  return value;
}

function readString(data: Buffer, cursor: Cursor): string {
  const length = readU32(data, cursor);
  const value = data.toString("utf8", cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return value;
}

function readPluginAuthority(data: Buffer, cursor: Cursor): void {
  const variant = readU8(data, cursor);
  if (variant === 3) {
    readPubkey(data, cursor);
  }
}

function readAttributesPlugin(
  data: Buffer,
  offset: number,
): Map<string, string> {
  const cursor = { offset };
  const pluginVariant = readU8(data, cursor);
  assert.equal(pluginVariant, ATTRIBUTES_PLUGIN_TYPE);

  const attributes = new Map<string, string>();
  const attributeCount = readU32(data, cursor);

  for (let i = 0; i < attributeCount; i += 1) {
    attributes.set(readString(data, cursor), readString(data, cursor));
  }

  return attributes;
}

function readPluginRegistry(data: Buffer, offset: number): Map<string, string> {
  const cursor = { offset };
  const registryKey = readU8(data, cursor);
  assert.equal(registryKey, PLUGIN_REGISTRY_V1_KEY);

  const registryCount = readU32(data, cursor);
  for (let i = 0; i < registryCount; i += 1) {
    const pluginType = readU8(data, cursor);
    readPluginAuthority(data, cursor);
    const pluginOffset = readU64(data, cursor);

    if (pluginType === ATTRIBUTES_PLUGIN_TYPE) {
      return readAttributesPlugin(data, pluginOffset);
    }
  }

  return new Map<string, string>();
}

function readCoreAsset(data: Buffer): CoreAsset {
  const cursor = { offset: 0 };
  assert.equal(readU8(data, cursor), ASSET_V1_KEY);

  const owner = readPubkey(data, cursor);
  const updateAuthorityVariant = readU8(data, cursor);
  let updateAuthority: web3.PublicKey | null = null;

  if (updateAuthorityVariant === 1 || updateAuthorityVariant === 2) {
    updateAuthority = readPubkey(data, cursor);
  }

  const name = readString(data, cursor);
  const uri = readString(data, cursor);
  const seqVariant = readU8(data, cursor);
  if (seqVariant === 1) {
    readU64(data, cursor);
  }

  let attributes = new Map<string, string>();
  if (cursor.offset < data.length) {
    const headerKey = readU8(data, cursor);
    assert.equal(headerKey, PLUGIN_HEADER_V1_KEY);
    attributes = readPluginRegistry(data, readU64(data, cursor));
  }

  return { owner, updateAuthority, name, uri, attributes };
}

function machinePda(
  authority: web3.PublicKey,
  machineId: anchor.BN,
  programId: web3.PublicKey,
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from(MACHINE_SEED), authority.toBuffer(), u64Le(machineId)],
    programId,
  )[0];
}

function treasuryPda(
  machine: web3.PublicKey,
  programId: web3.PublicKey,
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from(TREASURY_SEED), machine.toBuffer()],
    programId,
  )[0];
}

function updateAuthorityPda(
  machine: web3.PublicKey,
  programId: web3.PublicKey,
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from(UPDATE_AUTHORITY_SEED), machine.toBuffer()],
    programId,
  )[0];
}

function callbackIdentityPda(programId: web3.PublicKey): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from(VRF_IDENTITY_SEED)],
    programId,
  )[0];
}

function pullPda(
  machine: web3.PublicKey,
  player: web3.PublicKey,
  pullId: anchor.BN,
  programId: web3.PublicKey,
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(PULL_SEED),
      machine.toBuffer(),
      player.toBuffer(),
      u64Le(pullId),
    ],
    programId,
  )[0];
}

function assetPda(
  machine: web3.PublicKey,
  player: web3.PublicKey,
  pullId: anchor.BN,
  programId: web3.PublicKey,
): web3.PublicKey {
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(ASSET_SEED),
      machine.toBuffer(),
      player.toBuffer(),
      u64Le(pullId),
    ],
    programId,
  )[0];
}

async function waitForSettledPull(
  provider: anchor.AnchorProvider,
  program: Program<GachaponExample>,
  pendingPull: web3.PublicKey,
  asset: web3.PublicKey,
) {
  const startedAt = Date.now();
  let lastStatus = "not fetched";

  while (Date.now() - startedAt < VRF_SETTLEMENT_TIMEOUT_MS) {
    const pull = await program.account.pendingPull.fetch(pendingPull);
    lastStatus = String(pull.status);

    if (pull.status === PULL_STATUS_SETTLED) {
      const assetAccount = await provider.connection.getAccountInfo(
        asset,
        "confirmed",
      );
      if (assetAccount) {
        return { pull, assetAccount };
      }
      lastStatus = "settled, asset account missing";
    }

    await sleep(VRF_SETTLEMENT_POLL_MS);
  }

  throw new Error(
    `VRF callback did not settle pull ${pendingPull.toBase58()} within ${VRF_SETTLEMENT_TIMEOUT_MS}ms; last status: ${lastStatus}`,
  );
}

describe("gachapon-example", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.GachaponExample as Program<GachaponExample>;

  const machineId = new anchor.BN(Date.now());
  const authority = provider.wallet.publicKey;
  const machine = machinePda(authority, machineId, program.programId);
  const treasury = treasuryPda(machine, program.programId);
  const updateAuthority = updateAuthorityPda(machine, program.programId);

  const rewards: [RewardInput, RewardInput, RewardInput, RewardInput] = [
    {
      weight: 55,
      name: "Bronze Capsule",
      uri: "https://example.com/gachapon/bronze.json",
    },
    {
      weight: 30,
      name: "Silver Capsule",
      uri: "https://example.com/gachapon/silver.json",
    },
    {
      weight: 12,
      name: "Gold Capsule",
      uri: "https://example.com/gachapon/gold.json",
    },
    {
      weight: 3,
      name: "Mythic Capsule",
      uri: "https://example.com/gachapon/mythic.json",
    },
  ];

  it("initializes a machine", async () => {
    await program.methods
      .init(machineId)
      .accounts({
        authority,
        machine,
        treasury,
        updateAuthority,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.machine.fetch(machine);
    assert.equal(account.authority.toBase58(), authority.toBase58());
    assert.equal(account.machineId.toString(), machineId.toString());
    assert.equal(account.totalWeight, 0);
    assert.equal(account.pullCount.toString(), "0");

    const treasuryBalance = await provider.connection.getBalance(treasury);
    assert.isAtLeast(treasuryBalance, 10_000_000);
  });

  it("uploads four weighted Core NFT templates", async () => {
    await program.methods
      .uploadConfig(rewards)
      .accounts({
        authority,
        machine,
      })
      .rpc();

    const account = await program.account.machine.fetch(machine);
    assert.equal(account.totalWeight, 100);

    for (let i = 0; i < rewards.length; i += 1) {
      assert.equal(account.rewards[i].rewardId, i);
      assert.equal(account.rewards[i].weight, rewards[i].weight);
      assert.equal(account.rewards[i].mintedCount.toString(), "0");
      assert.equal(account.rewards[i].name, rewards[i].name);
      assert.equal(account.rewards[i].uri, rewards[i].uri);
    }
  });

  it("rejects config upload from a non-authority", async () => {
    const stranger = web3.Keypair.generate();
    await provider.sendAndConfirm(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: authority,
          toPubkey: stranger.publicKey,
          lamports: web3.LAMPORTS_PER_SOL / 10,
        }),
      ),
    );

    try {
      await program.methods
        .uploadConfig(rewards)
        .accounts({
          authority: stranger.publicKey,
          machine,
        })
        .signers([stranger])
        .rpc();
      assert.fail("non-authority upload should fail");
    } catch (error) {
      assert.include(String(error), "AnchorError");
    }
  });

  it("derives the pending pull and asset accounts for the callback", async () => {
    const pullId = new anchor.BN(1);
    const pendingPull = pullPda(machine, authority, pullId, program.programId);
    const asset = assetPda(machine, authority, pullId, program.programId);

    assert.isTrue(web3.PublicKey.isOnCurve(asset.toBuffer()) === false);
    assert.isTrue(web3.PublicKey.isOnCurve(pendingPull.toBuffer()) === false);
  });

  it("can request a live VRF pull when external programs are available", async function () {
    if (!process.env.RUN_VRF_CORE_SMOKE) {
      this.skip();
    }

    const pullId = new anchor.BN(2);
    const pendingPull = pullPda(machine, authority, pullId, program.programId);
    const asset = assetPda(machine, authority, pullId, program.programId);

    await program.methods
      .pull(pullId, 7)
      .accounts({
        player: authority,
        machine,
        pendingPull,
        asset,
        treasury,
        updateAuthority,
        callbackIdentity: callbackIdentityPda(program.programId),
        oracleQueue: DEFAULT_VRF_QUEUE,
        vrfProgram: VRF_PROGRAM_ID,
        slotHashes: SLOT_HASHES,
        systemProgram: web3.SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .rpc();

    const pull = await program.account.pendingPull.fetch(pendingPull);
    assert.equal(pull.machine.toBase58(), machine.toBase58());
    assert.equal(pull.player.toBase58(), authority.toBase58());
    assert.equal(pull.asset.toBase58(), asset.toBase58());
    assert.equal(pull.status, 0);
  });

  it("settles a live VRF pull and mints a Core asset when external programs are available", async function () {
    if (!process.env.RUN_VRF_CORE_E2E) {
      this.skip();
    }

    this.timeout(VRF_SETTLEMENT_TIMEOUT_MS + 30_000);

    const e2eMachineId = new anchor.BN(Date.now() + 1);
    const e2eMachine = machinePda(authority, e2eMachineId, program.programId);
    const e2eTreasury = treasuryPda(e2eMachine, program.programId);
    const e2eUpdateAuthority = updateAuthorityPda(
      e2eMachine,
      program.programId,
    );
    const pullId = new anchor.BN(1);
    const pendingPull = pullPda(
      e2eMachine,
      authority,
      pullId,
      program.programId,
    );
    const asset = assetPda(e2eMachine, authority, pullId, program.programId);

    await program.methods
      .init(e2eMachineId)
      .accounts({
        authority,
        machine: e2eMachine,
        treasury: e2eTreasury,
        updateAuthority: e2eUpdateAuthority,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .uploadConfig(rewards)
      .accounts({
        authority,
        machine: e2eMachine,
      })
      .rpc();

    const beforeMachine = await program.account.machine.fetch(e2eMachine);

    await program.methods
      .pull(pullId, 9)
      .accounts({
        player: authority,
        machine: e2eMachine,
        pendingPull,
        asset,
        treasury: e2eTreasury,
        updateAuthority: e2eUpdateAuthority,
        callbackIdentity: callbackIdentityPda(program.programId),
        oracleQueue: DEFAULT_VRF_QUEUE,
        vrfProgram: VRF_PROGRAM_ID,
        slotHashes: SLOT_HASHES,
        systemProgram: web3.SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .rpc();

    const { pull, assetAccount } = await waitForSettledPull(
      provider,
      program,
      pendingPull,
      asset,
    );
    const reward = rewards[pull.rewardId];
    const afterMachine = await program.account.machine.fetch(e2eMachine);
    const coreAsset = readCoreAsset(assetAccount.data);

    assert.equal(pull.machine.toBase58(), e2eMachine.toBase58());
    assert.equal(pull.player.toBase58(), authority.toBase58());
    assert.equal(pull.asset.toBase58(), asset.toBase58());
    assert.equal(pull.status, PULL_STATUS_SETTLED);
    assert.isAtLeast(pull.rewardId, 0);
    assert.isBelow(pull.rewardId, rewards.length);

    assert.equal(
      afterMachine.pullCount.toString(),
      beforeMachine.pullCount.addn(1).toString(),
    );
    assert.equal(
      afterMachine.rewards[pull.rewardId].mintedCount.toString(),
      beforeMachine.rewards[pull.rewardId].mintedCount.addn(1).toString(),
    );

    assert.equal(assetAccount.owner.toBase58(), MPL_CORE_PROGRAM_ID.toBase58());
    assert.equal(coreAsset.owner.toBase58(), authority.toBase58());
    assert.equal(
      coreAsset.updateAuthority?.toBase58(),
      e2eUpdateAuthority.toBase58(),
    );
    assert.equal(coreAsset.name, reward.name);
    assert.equal(coreAsset.uri, reward.uri);
    assert.equal(coreAsset.attributes.get("machine"), e2eMachine.toBase58());
    assert.equal(coreAsset.attributes.get("pull_id"), pullId.toString());
    assert.equal(coreAsset.attributes.get("reward_id"), String(pull.rewardId));
  });
});
