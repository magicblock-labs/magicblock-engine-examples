import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction, TransactionSignature } from "@solana/web3.js";
import { PDAs } from "@/lib/pda";
import { resolveEndpoint, type AdminActionEndpointMode } from "@/lib/endpoints";
import { sendTransaction, sendTransactionWithKeypair } from "@/lib/sendTransaction";

// Instruction builders
import { buildInitializeDistributor, buildSetAdmins, buildSetWhitelist, buildSetRewardList } from "@/lib/instructions/admin";
import { buildDelegateRewardList, buildUndelegateRewardList } from "@/lib/instructions/delegation";
import { buildRequestRandomReward, buildAddReward, buildAddRewardsBatch, buildRemoveReward, buildRemoveRewardsBatch, buildUpdateReward, listenForVrfCallback } from "@/lib/instructions/rewards";
import { buildMintNftCollection, buildMintNftToCollection, buildUpdateNftMetadata } from "@/lib/instructions/nft";
import { buildSplTokenTransfer } from "@/lib/instructions/tokens";
import { buildSponsoredLamportsTransfer, checkRewardListDelegated } from "@/lib/instructions/sponsoredLamports";

export type { TransactionResponse, VrfCallbackData } from "@/lib/instructions/types";

export interface TransactionStatus {
  loading: boolean;
  error: string | null;
  signature: TransactionSignature | null;
}

export interface UseTransactionProps {
  selectedDistributor?: PublicKey | null;
  onTransactionAdd?: (signature: string, actionName: string, network?: "devnet" | "mainnet-beta", endpoint?: string) => string;
  onTransactionUpdate?: (txId: string, updates: any) => void;
}

export const useTransaction = (props?: UseTransactionProps) => {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState<TransactionStatus>({ loading: false, error: null, signature: null });

  const ep = useCallback(
    (mode: AdminActionEndpointMode) => resolveEndpoint(connection.rpcEndpoint, mode),
    [connection.rpcEndpoint]
  );

  const distributorPda = useCallback(
    () => props?.selectedDistributor ?? (publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null),
    [publicKey, props?.selectedDistributor?.toString()]
  );

  /** Sign and send a pre-built transaction, managing loading/error status. */
  const exec = useCallback(
    async (
      buildFn: (connection: Connection) => Promise<Transaction>,
      endpoint: string
    ) => {
      if (!publicKey || !signTransaction) return { success: false, error: "Wallet not connected" };
      setStatus({ loading: true, error: null, signature: null });
      try {
        const conn = new Connection(endpoint, "confirmed");
        const tx = await buildFn(conn);
        const result = await sendTransaction(tx, publicKey, signTransaction, endpoint);
        setStatus({ loading: false, error: result.error ?? null, signature: result.signature ?? null });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction]
  );

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  const initializeRewardDistributor = useCallback(
    (whitelist: PublicKey[] = []) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildInitializeDistributor(conn, publicKey, dist, whitelist), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const setAdmins = useCallback(
    (newAdmins: PublicKey[]) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildSetAdmins(conn, publicKey, dist, newAdmins), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const setWhitelist = useCallback(
    (newWhitelist: PublicKey[]) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildSetWhitelist(conn, publicKey, dist, newWhitelist), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const setRewardList = useCallback(
    (globalRangeMin: number | null, globalRangeMax: number | null, startTimestamp: number | null, endTimestamp: number | null) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildSetRewardList(conn, publicKey, dist, globalRangeMin, globalRangeMax, startTimestamp, endTimestamp), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  // -------------------------------------------------------------------------
  // Delegation
  // -------------------------------------------------------------------------

  const delegateRewardList = useCallback(
    (validator?: PublicKey) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildDelegateRewardList(conn, publicKey, dist, validator), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const undelegateRewardList = useCallback(
    () => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildUndelegateRewardList(conn, publicKey, dist), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  // -------------------------------------------------------------------------
  // Rewards
  // -------------------------------------------------------------------------

  const requestRandomReward = useCallback(
    async (user: PublicKey, clientSeed: number) => {
      if (!publicKey || !signTransaction) return { success: false, error: "Wallet not connected" };
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!dist) return { success: false, error: "No distributor" };

      setStatus({ loading: true, error: null, signature: null });
      try {
        const conn = new Connection(endpoint, "confirmed");
        // Subscribe before sending to avoid race condition
        const { callbackPromise, cancel } = listenForVrfCallback(conn);
        const tx = await buildRequestRandomReward(conn, publicKey, dist, user, clientSeed);
        const result = await sendTransaction(tx, publicKey, signTransaction, endpoint);
        setStatus({ loading: false, error: result.error ?? null, signature: result.signature ?? null });
        if (!result.success) cancel();
        return { ...result, callbackPromise };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep, distributorPda]
  );

  const addReward = useCallback(
    (rewardName: string, rewardMint: PublicKey, tokenAccount: PublicKey, rewardAmount?: number, drawRangeMin?: number, drawRangeMax?: number, redemptionLimit?: number, metadataAccount?: PublicKey) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildAddReward(conn, publicKey, dist, rewardName, rewardMint, tokenAccount, rewardAmount, drawRangeMin, drawRangeMax, redemptionLimit, metadataAccount), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const addRewardsBatch = useCallback(
    (rewards: Parameters<typeof buildAddRewardsBatch>[3]) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildAddRewardsBatch(conn, publicKey, dist, rewards), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const removeReward = useCallback(
    (rewardName: string, rewardMint?: PublicKey, redemptionAmount?: number) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildRemoveReward(conn, publicKey, dist, rewardName, rewardMint, redemptionAmount), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const removeRewardsBatch = useCallback(
    (items: Parameters<typeof buildRemoveRewardsBatch>[3]) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildRemoveRewardsBatch(conn, publicKey, dist, items), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  const updateReward = useCallback(
    (currentRewardName: string, updatedRewardName: string | null, rewardMint: PublicKey | null, tokenAccount: PublicKey | null, rewardAmount: number | null, drawRangeMin: number | null, drawRangeMax: number | null) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildUpdateReward(conn, publicKey, dist, currentRewardName, updatedRewardName, rewardMint, tokenAccount, rewardAmount, drawRangeMin, drawRangeMax), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  // -------------------------------------------------------------------------
  // NFTs (need mintKeypair partial signing)
  // -------------------------------------------------------------------------

  const mintNftCollection = useCallback(
    async (name: string, symbol: string, uri: string) => {
      if (!publicKey || !signTransaction) return { success: false, error: "Wallet not connected" };
      if (!name.trim() || !symbol.trim() || !uri.trim()) return { success: false, error: "Name, symbol, and URI are required" };
      setStatus({ loading: true, error: null, signature: null });
      try {
        const endpoint = ep("solana");
        const conn = new Connection(endpoint, "confirmed");
        const { tx, mintKeypair } = await buildMintNftCollection(conn, publicKey, name.trim(), symbol.trim(), uri.trim());
        const result = await sendTransactionWithKeypair(tx, publicKey, signTransaction, endpoint, [mintKeypair]);
        setStatus({ loading: false, error: result.error ?? null, signature: result.signature ?? null });
        return { ...result, mint: mintKeypair.publicKey };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep]
  );

  const mintNftToCollection = useCallback(
    async (collectionMint: PublicKey, name: string, symbol: string, uri: string) => {
      if (!publicKey || !signTransaction) return { success: false, error: "Wallet not connected" };
      if (!name.trim() || !symbol.trim() || !uri.trim()) return { success: false, error: "Name, symbol, and URI are required" };
      setStatus({ loading: true, error: null, signature: null });
      try {
        const endpoint = ep("solana");
        const conn = new Connection(endpoint, "confirmed");
        const { tx, mintKeypair } = await buildMintNftToCollection(conn, publicKey, collectionMint, name.trim(), symbol.trim(), uri.trim());
        const result = await sendTransactionWithKeypair(tx, publicKey, signTransaction, endpoint, [mintKeypair]);
        setStatus({ loading: false, error: result.error ?? null, signature: result.signature ?? null });
        return { ...result, mint: mintKeypair.publicKey };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep]
  );

  const updateNftMetadata = useCallback(
    (mint: PublicKey, name: string, symbol: string, uri: string) => {
      const endpoint = ep("solana");
      if (!publicKey) return Promise.resolve({ success: false, error: "Wallet not connected" });
      if (!name.trim() || !symbol.trim() || !uri.trim()) return Promise.resolve({ success: false, error: "Name, symbol, and URI are required" });
      return exec(() => Promise.resolve(buildUpdateNftMetadata(publicKey, mint, name.trim(), symbol.trim(), uri.trim())), endpoint);
    },
    [publicKey, ep, exec]
  );

  // -------------------------------------------------------------------------
  // SPL Token transfer
  // -------------------------------------------------------------------------

  const sendSplTokenToDistributor = useCallback(
    (tokenMint: PublicKey, amount: number, decimals: number) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist) return Promise.resolve({ success: false, error: "Wallet not connected" });
      return exec((conn) => buildSplTokenTransfer(conn, publicKey, dist, tokenMint, amount, decimals), endpoint);
    },
    [publicKey, ep, distributorPda, exec]
  );

  // -------------------------------------------------------------------------
  // Sponsored lamports transfer
  // -------------------------------------------------------------------------

  const sendSponsoredLamportsToRewardList = useCallback(
    async (rewardListPda: PublicKey, amountLamports: bigint) => {
      if (!publicKey || !signTransaction) return { success: false, error: "Wallet not connected" };
      if (amountLamports <= 0n) return { success: false, error: "Amount must be greater than 0" };

      setStatus({ loading: true, error: null, signature: null });
      try {
        // Always submit to Solana base layer
        const endpoint = ep("solana");
        const conn = new Connection(endpoint, "confirmed");

        // Live delegation record check — mirrors on-chain assert_owner!
        const isDelegated = await checkRewardListDelegated(conn, rewardListPda);
        if (!isDelegated) {
          setStatus({ loading: false, error: null, signature: null });
          return { success: false, error: "Reward list is not delegated. Delegate it to the ephemeral rollup first.", endpoint };
        }

        const { tx } = buildSponsoredLamportsTransfer(publicKey, rewardListPda, amountLamports);
        const result = await sendTransaction(tx, publicKey, signTransaction, endpoint);
        setStatus({ loading: false, error: result.error ?? null, signature: result.signature ?? null });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep]
  );

  return {
    status,
    initializeRewardDistributor,
    setAdmins,
    setWhitelist,
    setRewardList,
    delegateRewardList,
    undelegateRewardList,
    requestRandomReward,
    addReward,
    addRewardsBatch,
    removeReward,
    removeRewardsBatch,
    updateReward,
    mintNftCollection,
    mintNftToCollection,
    updateNftMetadata,
    sendSplTokenToDistributor,
    sendSponsoredLamportsToRewardList,
  };
};
