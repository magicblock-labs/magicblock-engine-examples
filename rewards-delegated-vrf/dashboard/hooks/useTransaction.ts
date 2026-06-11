import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import { PDAs } from "@/lib/pda";
import { resolveEndpoint, type AdminActionEndpointMode } from "@/lib/endpoints";
import {
  sendTransaction,
  sendTransactionWithKeypair,
} from "@/lib/sendTransaction";

// Instruction builders
import {
  buildInitializeDistributor,
  buildSetAdmins,
  buildSetWhitelist,
  buildSetRewardList,
} from "@/lib/instructions/admin";
import {
  buildDelegateRewardList,
  buildUndelegateRewardList,
} from "@/lib/instructions/delegation";
import {
  buildRequestRandomReward,
  buildAddReward,
  buildAddRewardsBatch,
  buildRemoveReward,
  buildRemoveRewardsBatch,
  buildUpdateReward,
  buildAdminTransfer,
  listenForVrfCallback,
} from "@/lib/instructions/rewards";
import {
  buildMintNftCollection,
  buildMintNftToCollection,
  buildUpdateNftMetadata,
} from "@/lib/instructions/nft";
import {
  buildSplTokenTransfer,
  buildWhitelistTransfer,
} from "@/lib/instructions/tokens";
import {
  buildSponsoredLamportsTransfer,
  checkRewardListDelegated,
} from "@/lib/instructions/sponsoredLamports";
import { buildTopUpEphemeralBalance } from "@/lib/instructions/ephemeralBalance";

export type {
  TransactionResponse,
  VrfCallbackData,
} from "@/lib/instructions/types";

export interface TransactionStatus {
  loading: boolean;
  error: string | null;
  signature: TransactionSignature | null;
}

export interface UseTransactionProps {
  selectedDistributor?: PublicKey | null;
  onTransactionAdd?: (
    signature: string,
    actionName: string,
    network?: "devnet" | "mainnet-beta",
    endpoint?: string,
  ) => string;
  onTransactionUpdate?: (txId: string, updates: any) => void;
}

export const useTransaction = (props?: UseTransactionProps) => {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState<TransactionStatus>({
    loading: false,
    error: null,
    signature: null,
  });

  const ep = useCallback(
    (mode: AdminActionEndpointMode) =>
      resolveEndpoint(connection.rpcEndpoint, mode),
    [connection.rpcEndpoint],
  );

  const distributorPda = useCallback(
    () =>
      props?.selectedDistributor ??
      (publicKey ? PDAs.getRewardDistributor(publicKey)[0] : null),
    [publicKey, props?.selectedDistributor?.toString()],
  );

  /** Sign and send a pre-built transaction, managing loading/error status. */
  const exec = useCallback(
    async (
      buildFn: (connection: Connection) => Promise<Transaction>,
      endpoint: string,
    ) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      setStatus({ loading: true, error: null, signature: null });
      try {
        const conn = new Connection(endpoint, "confirmed");
        const tx = await buildFn(conn);
        const result = await sendTransaction(
          tx,
          publicKey,
          signTransaction,
          endpoint,
        );
        setStatus({
          loading: false,
          error: result.error ?? null,
          signature: result.signature ?? null,
        });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction],
  );

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  const initializeRewardDistributor = useCallback(
    (whitelist: PublicKey[] = []) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) => buildInitializeDistributor(conn, publicKey, dist, whitelist),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const setAdmins = useCallback(
    (newAdmins: PublicKey[]) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) => buildSetAdmins(conn, publicKey, dist, newAdmins),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const setWhitelist = useCallback(
    (newWhitelist: PublicKey[]) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) => buildSetWhitelist(conn, publicKey, dist, newWhitelist),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const setRewardList = useCallback(
    (
      globalRangeMin: number | null,
      globalRangeMax: number | null,
      startTimestamp: number | null,
      endTimestamp: number | null,
    ) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) =>
          buildSetRewardList(
            conn,
            publicKey,
            dist,
            globalRangeMin,
            globalRangeMax,
            startTimestamp,
            endTimestamp,
          ),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  // -------------------------------------------------------------------------
  // Delegation
  // -------------------------------------------------------------------------

  const delegateRewardList = useCallback(
    (validator?: PublicKey) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) => buildDelegateRewardList(conn, publicKey, dist, validator),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const undelegateRewardList = useCallback(() => {
    const endpoint = ep("magicblock");
    const dist = distributorPda();
    if (!publicKey || !dist)
      return Promise.resolve({ success: false, error: "Wallet not connected" });
    return exec(
      (conn) => buildUndelegateRewardList(conn, publicKey, dist),
      endpoint,
    );
  }, [publicKey, ep, distributorPda, exec]);

  // -------------------------------------------------------------------------
  // Rewards
  // -------------------------------------------------------------------------

  const requestRandomReward = useCallback(
    async (user: PublicKey, clientSeed: number) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!dist) return { success: false, error: "No distributor" };

      setStatus({ loading: true, error: null, signature: null });
      try {
        const conn = new Connection(endpoint, "confirmed");
        // Subscribe before sending to avoid race condition
        const { callbackPromise, cancel } = listenForVrfCallback(conn);
        const tx = await buildRequestRandomReward(
          conn,
          publicKey,
          dist,
          user,
          clientSeed,
        );
        const result = await sendTransaction(
          tx,
          publicKey,
          signTransaction,
          endpoint,
        );
        setStatus({
          loading: false,
          error: result.error ?? null,
          signature: result.signature ?? null,
        });
        if (!result.success) cancel();
        return { ...result, callbackPromise };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep, distributorPda],
  );

  const addReward = useCallback(
    (
      rewardName: string,
      rewardMint: PublicKey,
      tokenAccount: PublicKey,
      rewardAmount?: number,
      drawRangeMin?: number,
      drawRangeMax?: number,
      redemptionLimit?: number,
      metadataAccount?: PublicKey,
    ) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) =>
          buildAddReward(
            conn,
            publicKey,
            dist,
            rewardName,
            rewardMint,
            tokenAccount,
            rewardAmount,
            drawRangeMin,
            drawRangeMax,
            redemptionLimit,
            metadataAccount,
          ),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const addRewardsBatch = useCallback(
    (rewards: Parameters<typeof buildAddRewardsBatch>[3]) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) => buildAddRewardsBatch(conn, publicKey, dist, rewards),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const removeReward = useCallback(
    (rewardName: string, rewardMint?: PublicKey, redemptionAmount?: number) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) =>
          buildRemoveReward(
            conn,
            publicKey,
            dist,
            rewardName,
            rewardMint,
            redemptionAmount,
          ),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const removeRewardsBatch = useCallback(
    (items: Parameters<typeof buildRemoveRewardsBatch>[3]) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) => buildRemoveRewardsBatch(conn, publicKey, dist, items),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  const updateReward = useCallback(
    (
      currentRewardName: string,
      updatedRewardName: string | null,
      rewardMint: PublicKey | null,
      tokenAccount: PublicKey | null,
      rewardAmount: number | null,
      drawRangeMin: number | null,
      drawRangeMax: number | null,
    ) => {
      const endpoint = ep("magicblock");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      return exec(
        (conn) =>
          buildUpdateReward(
            conn,
            publicKey,
            dist,
            currentRewardName,
            updatedRewardName,
            rewardMint,
            tokenAccount,
            rewardAmount,
            drawRangeMin,
            drawRangeMax,
          ),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  /**
   * Admin transfer: send distributor-held assets to an arbitrary user outside
   * the VRF/redemption flow. Always submitted to the ER endpoint because
   * reward_list (which the on-chain handler reads for the availability check)
   * is delegated. Pre-flights the delegation record so we fail fast with a
   * clear message if reward_list isn't delegated.
   */
  const adminTransfer = useCallback(
    async (mint: PublicKey, user: PublicKey, amount: number) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      if (amount <= 0)
        return { success: false, error: "Amount must be greater than 0" };
      const dist = distributorPda();
      if (!dist) return { success: false, error: "No distributor selected" };

      // Delegation state lives on base — read it from the Solana endpoint.
      const solanaEndpoint = ep("solana");
      const solanaConn = new Connection(solanaEndpoint, "confirmed");
      const isDelegated = await checkRewardListDelegated(
        solanaConn,
        PDAs.getRewardList(dist)[0],
      );
      if (!isDelegated) {
        return {
          success: false,
          error: "Reward list is not delegated. Delegate it to the ER first.",
        };
      }

      // admin_transfer is `#[commit]` — must run on the ER endpoint.
      const endpoint = ep("magicblock");
      return exec(
        (conn) => buildAdminTransfer(conn, publicKey, dist, mint, user, amount),
        endpoint,
      );
    },
    [publicKey, signTransaction, ep, distributorPda, exec],
  );

  // -------------------------------------------------------------------------
  // NFTs (need mintKeypair partial signing)
  // -------------------------------------------------------------------------

  const mintNftCollection = useCallback(
    async (name: string, symbol: string, uri: string) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      if (!name.trim() || !symbol.trim() || !uri.trim())
        return { success: false, error: "Name, symbol, and URI are required" };
      setStatus({ loading: true, error: null, signature: null });
      try {
        const endpoint = ep("solana");
        const conn = new Connection(endpoint, "confirmed");
        const { tx, mintKeypair } = await buildMintNftCollection(
          conn,
          publicKey,
          name.trim(),
          symbol.trim(),
          uri.trim(),
        );
        const result = await sendTransactionWithKeypair(
          tx,
          publicKey,
          signTransaction,
          endpoint,
          [mintKeypair],
        );
        setStatus({
          loading: false,
          error: result.error ?? null,
          signature: result.signature ?? null,
        });
        return { ...result, mint: mintKeypair.publicKey };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep],
  );

  const mintNftToCollection = useCallback(
    async (
      collectionMint: PublicKey,
      name: string,
      symbol: string,
      uri: string,
    ) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      if (!name.trim() || !symbol.trim() || !uri.trim())
        return { success: false, error: "Name, symbol, and URI are required" };
      setStatus({ loading: true, error: null, signature: null });
      try {
        const endpoint = ep("solana");
        const conn = new Connection(endpoint, "confirmed");
        const { tx, mintKeypair } = await buildMintNftToCollection(
          conn,
          publicKey,
          collectionMint,
          name.trim(),
          symbol.trim(),
          uri.trim(),
        );
        const result = await sendTransactionWithKeypair(
          tx,
          publicKey,
          signTransaction,
          endpoint,
          [mintKeypair],
        );
        setStatus({
          loading: false,
          error: result.error ?? null,
          signature: result.signature ?? null,
        });
        return { ...result, mint: mintKeypair.publicKey };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep],
  );

  const updateNftMetadata = useCallback(
    (mint: PublicKey, name: string, symbol: string, uri: string) => {
      const endpoint = ep("solana");
      if (!publicKey)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      if (!name.trim() || !symbol.trim() || !uri.trim())
        return Promise.resolve({
          success: false,
          error: "Name, symbol, and URI are required",
        });
      return exec(
        () =>
          Promise.resolve(
            buildUpdateNftMetadata(
              publicKey,
              mint,
              name.trim(),
              symbol.trim(),
              uri.trim(),
            ),
          ),
        endpoint,
      );
    },
    [publicKey, ep, exec],
  );

  // -------------------------------------------------------------------------
  // SPL Token transfer
  // -------------------------------------------------------------------------

  /**
   * Send SPL tokens from the connected wallet to one of the distributor's
   * token bags. `target` selects which PDA receives the funds:
   *   - "reward": the main reward_distributor PDA (used by VRF redemptions
   *     and admin_transfer, inventory-checked on chain).
   *   - "whitelist": the per-distributor whitelist_distributor PDA (its
   *     own bag, only movable via whitelist_transfer).
   */
  const sendSplTokenToDistributor = useCallback(
    (
      tokenMint: PublicKey,
      amount: number,
      decimals: number,
      target: "reward" | "whitelist" = "reward",
    ) => {
      const endpoint = ep("solana");
      const dist = distributorPda();
      if (!publicKey || !dist)
        return Promise.resolve({
          success: false,
          error: "Wallet not connected",
        });
      const destinationPda =
        target === "whitelist" ? PDAs.getWhitelistDistributor(dist)[0] : dist;
      return exec(
        (conn) =>
          buildSplTokenTransfer(
            conn,
            publicKey,
            destinationPda,
            tokenMint,
            amount,
            decimals,
          ),
        endpoint,
      );
    },
    [publicKey, ep, distributorPda, exec],
  );

  /**
   * Whitelist transfer: move SPL tokens from the whitelist_distributor PDA
   * to a user. Signer must be the distributor's super_admin / admin / or a
   * member of `reward_distributor.whitelist`. Runs on the ER (same Magic
   * intent infrastructure as admin_transfer) — `reward_list` must be
   * delegated. Pre-flights the delegation record so we fail fast with a
   * clear message if it isn't.
   */
  const whitelistTransfer = useCallback(
    async (mint: PublicKey, user: PublicKey, amount: number) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      if (amount <= 0)
        return { success: false, error: "Amount must be greater than 0" };
      const dist = distributorPda();
      if (!dist) return { success: false, error: "No distributor selected" };

      // Delegation state lives on base — read it from the Solana endpoint.
      const solanaEndpoint = ep("solana");
      const solanaConn = new Connection(solanaEndpoint, "confirmed");
      const isDelegated = await checkRewardListDelegated(
        solanaConn,
        PDAs.getRewardList(dist)[0],
      );
      if (!isDelegated) {
        return {
          success: false,
          error: "Reward list is not delegated. Delegate it to the ER first.",
        };
      }

      // whitelist_transfer is `#[commit]` — must run on the ER endpoint.
      // The ER proxies undelegated base accounts (like the delegation
      // record) on read, so the builder can derive magic_fee_vault.
      const endpoint = ep("magicblock");
      return exec(
        (conn) =>
          buildWhitelistTransfer(conn, publicKey, dist, mint, user, amount),
        endpoint,
      );
    },
    [publicKey, signTransaction, ep, distributorPda, exec],
  );

  // -------------------------------------------------------------------------
  // Sponsored lamports transfer
  // -------------------------------------------------------------------------

  const sendSponsoredLamportsToRewardList = useCallback(
    async (rewardListPda: PublicKey, amountLamports: bigint) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      if (amountLamports <= 0n)
        return { success: false, error: "Amount must be greater than 0" };

      setStatus({ loading: true, error: null, signature: null });
      try {
        // Always submit to Solana base layer
        const endpoint = ep("solana");
        const conn = new Connection(endpoint, "confirmed");

        // Live delegation record check — mirrors on-chain assert_owner!
        const isDelegated = await checkRewardListDelegated(conn, rewardListPda);
        if (!isDelegated) {
          setStatus({ loading: false, error: null, signature: null });
          return {
            success: false,
            error:
              "Reward list is not delegated. Delegate it to the ephemeral rollup first.",
            endpoint,
          };
        }

        const { tx } = buildSponsoredLamportsTransfer(
          publicKey,
          rewardListPda,
          amountLamports,
        );
        const result = await sendTransaction(
          tx,
          publicKey,
          signTransaction,
          endpoint,
        );
        setStatus({
          loading: false,
          error: result.error ?? null,
          signature: result.signature ?? null,
        });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep],
  );

  // -------------------------------------------------------------------------
  // Top up the reward distributor's ephemeral balance (escrow PDA on DLP)
  // -------------------------------------------------------------------------

  const topUpEphemeralBalance = useCallback(
    async (amountLamports: bigint) => {
      if (!publicKey || !signTransaction)
        return { success: false, error: "Wallet not connected" };
      if (amountLamports <= 0n)
        return { success: false, error: "Amount must be greater than 0" };
      const dist = distributorPda();
      if (!dist) return { success: false, error: "No distributor selected" };

      setStatus({ loading: true, error: null, signature: null });
      try {
        // Ephemeral balance lives on the Solana base layer.
        const endpoint = ep("solana");
        const tx = buildTopUpEphemeralBalance(publicKey, dist, amountLamports);
        const result = await sendTransaction(
          tx,
          publicKey,
          signTransaction,
          endpoint,
        );
        setStatus({
          loading: false,
          error: result.error ?? null,
          signature: result.signature ?? null,
        });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error, signature: null });
        return { success: false, error };
      }
    },
    [publicKey, signTransaction, ep, distributorPda],
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
    topUpEphemeralBalance,
    adminTransfer,
    whitelistTransfer,
  };
};
