import { PublicKey } from "@solana/web3.js";
import rawIdl from "../idl/anchor_rock_paper_scissor.json";

const env = import.meta.env;

// Defaults to the address from the locally built IDL (kept fresh by `yarn sync-idl`),
// so the app tracks whatever `anchor keys sync && anchor build` produced.
export const PROGRAM_ID = new PublicKey(env.VITE_PROGRAM_ID || rawIdl.address);

export const BASE_ENDPOINT: string =
  env.VITE_BASE_ENDPOINT || "https://rpc.magicblock.app/devnet";
export const TEE_ENDPOINT: string =
  env.VITE_TEE_ENDPOINT || "https://devnet-tee.magicblock.app";
export const TEE_WS_ENDPOINT: string =
  env.VITE_TEE_WS_ENDPOINT || TEE_ENDPOINT.replace(/^http/, "ws");

// TEE ER validator the PDAs get delegated to.
export const ER_VALIDATOR = new PublicKey(
  env.VITE_VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);
export const VAULT_ID = new PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);

export const GAME_SEED = "game";
export const PLAYER_CHOICE_SEED = "player_choice";

// Burner wallets in localStorage (same pattern as the roll-dice app).
export const PLAYER_STORAGE_KEY = "rps-player-keypair";
export const GUEST_STORAGE_KEY = "rps-guest-keypair"; // same-browser second player
export const BOT_STORAGE_KEY = "rps-bot-keypair"; // single-player robot opponent

export const MIN_PLAY_SOL = 0.02;
export const AIRDROP_SOL = 0.2;
export const BOT_FUND_SOL = 0.02;
// One-click top-up from a connected wallet — enough for a solo game
// (player + robot funding) with headroom for several two-player games.
export const TOPUP_SOL = 0.05;

// Endpoint the top-up submits through. Wallets derive the chain from the URL
// and FALL BACK TO MAINNET for unrecognized ones — so only reuse the base
// endpoint when it's clearly classifiable, else pin devnet.
export const TOPUP_ENDPOINT: string =
  env.VITE_TOPUP_ENDPOINT ||
  (/mainnet|\bdevnet\b|\btestnet\b|\blocalhost\b|\b127\.0\.0\.1\b/i.test(
    BASE_ENDPOINT,
  )
    ? BASE_ENDPOINT
    : "https://rpc.magicblock.app/devnet");

export const TOPUP_NETWORK_LABEL = /mainnet/i.test(TOPUP_ENDPOINT)
  ? "mainnet"
  : /\btestnet\b/i.test(TOPUP_ENDPOINT)
    ? "testnet"
    : /localhost|127\.0\.0\.1/.test(TOPUP_ENDPOINT)
      ? "local cluster"
      : "devnet";

export const POLL_INTERVAL_MS = 2500;

export const isDevnet = BASE_ENDPOINT.includes("devnet");
export const baseExplorerTxUrl = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}${isDevnet ? "?cluster=devnet" : BASE_ENDPOINT.startsWith("http://localhost") ? `?cluster=custom&customUrl=${encodeURIComponent(BASE_ENDPOINT)}` : ""}`;

// ER transactions live on the TEE — explorers can only read them through a
// connection that carries the viewer's auth token, so the link embeds the
// player's own tokenized RPC URL as a Solscan custom cluster.
export const erExplorerTxUrl = (sig: string, tokenizedRpc: string) =>
  `https://solscan.io/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(tokenizedRpc)}`;
