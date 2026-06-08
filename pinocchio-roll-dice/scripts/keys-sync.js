const fs = require("fs");
const path = require("path");
const { Keypair } = require("@solana/web3.js");

const DECLARE_ID_PATTERN = /declare_id!\("([^"]+)"\)/;

const PROGRAMS = [
  {
    keypairPath: path.join("target", "deploy", "roll_dice-keypair.json"),
    programPath: path.join("programs", "roll-dice", "src", "lib.rs"),
  },
  {
    keypairPath: path.join(
      "target",
      "deploy",
      "roll_dice_delegated-keypair.json"
    ),
    programPath: path.join("programs", "roll-dice-delegated", "src", "lib.rs"),
  },
];

function readKeypairPublicKey(keypairPath) {
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Program keypair not found: ${keypairPath}`);
  }

  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));

  if (!Array.isArray(secretKey)) {
    throw new Error(`Program keypair must be a JSON array: ${keypairPath}`);
  }

  return Keypair.fromSecretKey(Uint8Array.from(secretKey)).publicKey.toBase58();
}

function readDeclareId(programSource) {
  const match = programSource.match(DECLARE_ID_PATTERN);
  return match ? match[1] : null;
}

function syncProgramId({ keypairPath, programPath }) {
  const programId = readKeypairPublicKey(keypairPath);
  const programSource = fs.readFileSync(programPath, "utf8");
  const currentId = readDeclareId(programSource);

  if (currentId === null) {
    throw new Error(`Could not find declare_id!(...) in ${programPath}`);
  }

  if (currentId === programId) {
    return { programId, changed: false };
  }

  const nextSource = programSource.replace(
    DECLARE_ID_PATTERN,
    `declare_id!("${programId}")`
  );

  fs.writeFileSync(programPath, nextSource);
  return { programId, changed: true };
}

if (require.main === module) {
  try {
    for (const program of PROGRAMS) {
      const { programId, changed } = syncProgramId(program);
      if (changed) {
        console.log(`Synced declare_id! to ${programId}`);
      } else {
        console.log(`declare_id! already synced to ${programId}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  syncProgramId,
  readDeclareId,
};
