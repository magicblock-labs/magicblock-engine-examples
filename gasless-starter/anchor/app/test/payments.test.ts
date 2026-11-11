import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { validatePayment } from "../src/lib/payments";
import { apiBuild, sponsor } from "./fixtures";

for (const kind of ["deposit", "withdraw"] as const) {
  test(`${kind}: accepts the exact sponsored build`, async () => {
    const owner = Keypair.generate();
    const tx = await validatePayment(
      await apiBuild(owner, kind, 1_000_000n),
      owner.publicKey,
      kind,
      1_000_000n,
    );
    assert.ok(tx.feePayer?.equals(sponsor.publicKey));
  });

  test(`${kind}: rejects a different amount`, async () => {
    const owner = Keypair.generate();
    const build = await apiBuild(owner, kind, 2_000_000n);
    await assert.rejects(
      validatePayment(build, owner.publicKey, kind, 1_000_000n),
      /differs/,
    );
  });

  test(`${kind}: rejects a build for another owner`, async () => {
    const owner = Keypair.generate();
    const build = await apiBuild(Keypair.generate(), kind, 1_000_000n);
    await assert.rejects(
      validatePayment(build, owner.publicKey, kind, 1_000_000n),
    );
  });

  test(`${kind}: rejects a higher fee or another validator`, async () => {
    const owner = Keypair.generate();
    const build = await apiBuild(owner, kind, 1_000_000n);
    await assert.rejects(
      validatePayment(
        { ...build, fees: { tokens: "200001", lamports: "0" } },
        owner.publicKey,
        kind,
        1_000_000n,
      ),
      /fee/,
    );
    await assert.rejects(
      validatePayment(
        { ...build, validator: Keypair.generate().publicKey.toBase58() },
        owner.publicKey,
        kind,
        1_000_000n,
      ),
      /validator/,
    );
  });

  test(`${kind}: rejects a build without the sponsor's signature`, async () => {
    const owner = Keypair.generate();
    const build = await apiBuild(owner, kind, 1_000_000n, {
      signBySponsor: false,
    });
    await assert.rejects(
      validatePayment(build, owner.publicKey, kind, 1_000_000n),
      /sponsor signature/,
    );
  });

  test(`${kind}: rejects routing to the rollup`, async () => {
    const owner = Keypair.generate();
    const build = await apiBuild(owner, kind, 1_000_000n);
    await assert.rejects(
      validatePayment(
        { ...build, sendTo: "ephemeral" },
        owner.publicKey,
        kind,
        1_000_000n,
      ),
      /routing/,
    );
  });
}

test("deposit: rejects a private deposit the app did not ask for", async () => {
  const owner = Keypair.generate();
  const build = await apiBuild(owner, "deposit", 1_000_000n, {
    privateDeposit: true,
  });
  await assert.rejects(
    validatePayment(build, owner.publicKey, "deposit", 1_000_000n),
    /differs/,
  );
});
