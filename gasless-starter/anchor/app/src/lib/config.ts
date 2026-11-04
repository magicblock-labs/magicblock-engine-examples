import { PublicKey } from "@solana/web3.js";

// Devnet endpoints. The ER endpoint must be the one behind `VALIDATOR`: deposits,
// the jar, and every ER transaction have to land on the same validator.
export const BASE_RPC = "https://rpc.magicblock.app/devnet";
export const ER_RPC = "https://devnet-as.magicblock.app";
export const VALIDATOR = new PublicKey(
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);

// Hosted Payments API. With `gasless: true`, it builds a deposit or withdrawal
// whose fee payer is MagicBlock's sponsor, pre-signed by that sponsor. The user
// signs as token owner and pays a relay fee in USDC instead of SOL.
export const PAYMENTS_API = "https://payments.magicblock.app";
export const PAYMENTS_CLUSTER = "devnet";

// Gasless payments support devnet USDC only (USDC/USDT on mainnet).
export const USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
export const USDC_DECIMALS = 6;
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);
export const RELAY_FEE = 200_000n; // 0.20 USDC per sponsored deposit or withdrawal
export const MIN_PAYMENT = 500_000n; // 0.50 USDC, the API minimum for deposits and withdrawals

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

// Truncates to cents, so a balance never shows more than the wallet can spend.
export const formatUsdc = (amount: bigint) =>
  `${amount / USDC_UNIT}.${(((amount % USDC_UNIT) * 100n) / USDC_UNIT).toString().padStart(2, "0")}`;

export function parseUsdc(input: string): bigint {
  invariant(/^\d+(\.\d{1,6})?$/.test(input.trim()), "Enter a USDC amount.");
  const [whole, fraction = ""] = input.trim().split(".");
  return (
    BigInt(whole) * USDC_UNIT + BigInt(fraction.padEnd(USDC_DECIMALS, "0"))
  );
}
