import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import os from "os";

export const VRF_PROGRAM = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
);
// Local oracle queue (paywJiVATr... index 0). Use VRF_BASE_QUEUE to override.
export const DEFAULT_BASE_QUEUE = new PublicKey(
  process.env.VRF_BASE_QUEUE || "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);
export const DEFAULT_EPHEMERAL_QUEUE = new PublicKey(
  process.env.VRF_EPHEMERAL_QUEUE ||
    "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);
export const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const MAGIC_CONTEXT = new PublicKey(
  "MagicContext1111111111111111111111111111111",
);
export const MAGIC_PROGRAM = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
export const PROGRAM_IDENTITY = new PublicKey(
  "9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw",
);
export const VALIDATOR = new PublicKey(
  process.env.VALIDATOR || "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);

export function getLocalKeypair() {
  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          process.env.ANCHOR_WALLET ||
            path.join(os.homedir(), ".config", "solana", "id.json"),
          "utf8",
        ),
      ),
    ),
  );
}

export function getLocalConnection() {
  return new Connection(
    process.env.PROVIDER_ENDPOINT ||
      process.env.ANCHOR_PROVIDER_URL ||
      "https://api.devnet.solana.com",
  );
}

export function getEphemeralConnection() {
  return new Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
  );
}

export function readProgramId(program: "roll_dice" | "roll_dice_delegated") {
  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          path.join(
            __dirname,
            "..",
            "target",
            "deploy",
            `${program}-keypair.json`,
          ),
          "utf8",
        ),
      ),
    ),
  ).publicKey;
}

export function decodePlayer(data: Buffer) {
  return {
    lastResult: data.readUInt8(0),
    rollnum: data.readUInt8(1),
  };
}
