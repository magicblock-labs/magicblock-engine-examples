import * as legacyWeb3js from "legacy-web3js";
import * as web3js from "@solana/web3.js";

/** Convert a legacy web3.js transaction into the web3.js v3 shape MagicSVM expects. */
export function transaction(
  web3Tx: legacyWeb3js.Transaction,
): web3js.Transaction {
  return web3js.Transaction.from(web3Tx.serialize());
}
