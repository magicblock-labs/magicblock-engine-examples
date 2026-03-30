"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { getBaseLayerSolanaEndpoint } from "@/lib/clusterContext";

export interface OwnedSplMintOption {
  mint: string;
  tokenAccount: string;
  balanceLabel: string;
  decimals: number;
  isNftLike: boolean;
}

export interface OwnedSplMintFetchResult {
  endpoint: string;
  owner: string;
  tokenProgramCount: number;
  token2022ProgramCount: number;
  options: OwnedSplMintOption[];
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals <= 0) {
    return amount.toString();
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionString = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return `${whole.toString()}.${fractionString}`;
}

async function fetchAccountsForProgram(
  connection: Connection,
  owner: PublicKey,
  programId: PublicKey
): Promise<OwnedSplMintOption[]> {
  const response = await connection.getTokenAccountsByOwner(owner, { programId });

  const decodedAccounts = response.value.flatMap((accountInfo) => {
    try {
      const decodedAccount = unpackAccount(
        accountInfo.pubkey,
        accountInfo.account,
        programId
      );

      if (decodedAccount.amount === 0n) {
        return [];
      }

      return [
        {
          tokenAccount: accountInfo.pubkey.toBase58(),
          mint: decodedAccount.mint,
          amount: decodedAccount.amount,
        },
      ];
    } catch {
      return [];
    }
  });

  const uniqueMintKeys = Array.from(
    new Set(decodedAccounts.map((account) => account.mint.toBase58()))
  ).map((mint) => new PublicKey(mint));

  const mintInfos =
    uniqueMintKeys.length > 0
      ? await connection.getMultipleAccountsInfo(uniqueMintKeys)
      : [];

  const mintDecimals = new Map<string, number>();

  uniqueMintKeys.forEach((mint, index) => {
    const mintInfo = mintInfos[index];

    if (!mintInfo) {
      mintDecimals.set(mint.toBase58(), 0);
      return;
    }

    try {
      const decodedMint = unpackMint(mint, mintInfo, programId);
      mintDecimals.set(mint.toBase58(), decodedMint.decimals);
    } catch {
      mintDecimals.set(mint.toBase58(), 0);
    }
  });

  return decodedAccounts.map((account) => {
    const mintKey = account.mint.toBase58();
    const decimals = mintDecimals.get(mintKey) ?? 0;

    return {
      mint: mintKey,
      tokenAccount: account.tokenAccount,
      balanceLabel: formatTokenAmount(account.amount, decimals),
      decimals,
      isNftLike: decimals === 0 && account.amount === 1n,
    };
  });
}

export async function fetchOwnedSplMintOptions(
  connection: Connection,
  owner: PublicKey
): Promise<OwnedSplMintFetchResult> {
  const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
  const readConnection =
    readEndpoint === connection.rpcEndpoint
      ? connection
      : new Connection(readEndpoint, "confirmed");

  const [tokenProgramOptions, token2022Options] = await Promise.all([
    fetchAccountsForProgram(readConnection, owner, TOKEN_PROGRAM_ID),
    fetchAccountsForProgram(readConnection, owner, TOKEN_2022_PROGRAM_ID),
  ]);

  return {
    endpoint: readConnection.rpcEndpoint,
    owner: owner.toBase58(),
    tokenProgramCount: tokenProgramOptions.length,
    token2022ProgramCount: token2022Options.length,
    options: [...tokenProgramOptions, ...token2022Options].sort((left, right) =>
      left.mint.localeCompare(right.mint)
    ),
  };
}
