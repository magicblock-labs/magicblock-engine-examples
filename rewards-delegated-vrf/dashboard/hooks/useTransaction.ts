import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  Transaction,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { PROGRAM_ID } from "@/lib/constants";
import type { RewardsDelegatedVrf } from "@/idl/rewards_delegated_vrf";
import rewardsDelegatedVrfIdl from "@/idl/rewards_delegated_vrf.json";
import { PDAs } from "@/lib/pda";
import { VRF_PROGRAM_ID, ORACLE_QUEUE, SLOT_HASHES_SYSVAR, getVrfProgramIdentity } from "@/lib/vrfConstants";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";

type AdminActionEndpointMode = "solana" | "magicblock";

const SOLANA_DEVNET_ENDPOINT = "https://rpc.magicblock.app/devnet";
const SOLANA_MAINNET_ENDPOINT = "https://rpc.magicblock.app/mainnet";
const MAGICBLOCK_DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/";
const MAGICBLOCK_MAINNET_ENDPOINT = "https://as.magicblock.app";

function isKnownDevnetEndpoint(endpoint: string): boolean {
  return endpoint.includes("devnet");
}

function isKnownMainnetEndpoint(endpoint: string): boolean {
  return endpoint.includes("mainnet") || endpoint.includes("as.magicblock.app");
}

function isKnownPresetEndpoint(endpoint: string): boolean {
  return (
    endpoint === SOLANA_DEVNET_ENDPOINT ||
    endpoint === SOLANA_MAINNET_ENDPOINT ||
    endpoint === MAGICBLOCK_DEVNET_ENDPOINT ||
    endpoint === MAGICBLOCK_MAINNET_ENDPOINT
  );
}

function resolveAdminActionEndpoint(
  selectedEndpoint: string,
  mode: AdminActionEndpointMode
): string {
  if (!selectedEndpoint || !isKnownPresetEndpoint(selectedEndpoint)) {
    return selectedEndpoint;
  }

  if (isKnownDevnetEndpoint(selectedEndpoint)) {
    return mode === "solana" ? SOLANA_DEVNET_ENDPOINT : MAGICBLOCK_DEVNET_ENDPOINT;
  }

  if (isKnownMainnetEndpoint(selectedEndpoint)) {
    return mode === "solana" ? SOLANA_MAINNET_ENDPOINT : MAGICBLOCK_MAINNET_ENDPOINT;
  }

  return selectedEndpoint;
}

export interface TransactionStatus {
  loading: boolean;
  error: string | null;
  signature: TransactionSignature | null;
}

export interface TransactionResponse {
  success: boolean;
  signature?: TransactionSignature;
  error?: string;
  endpoint?: string;
}

interface UseTransactionProps {
  selectedDistributor?: PublicKey | null;
  onTransactionAdd?: (
    signature: string,
    actionName: string,
    network?: "devnet" | "mainnet-beta",
    endpoint?: string
  ) => string; // returns txId
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
  
  // Use selected distributor if provided, otherwise derive from wallet
  const getDistributorPda = (wallet: PublicKey) => {
    if (props?.selectedDistributor) {
      return props.selectedDistributor;
    }
    return PDAs.getRewardDistributor(wallet)[0];
  };

  const getActionEndpoint = useCallback(
    (mode: AdminActionEndpointMode) =>
      resolveAdminActionEndpoint(connection.rpcEndpoint, mode),
    [connection.rpcEndpoint]
  );

  // Helper to create program instance with IDL from local file
  const createProgram = async (provider: anchor.AnchorProvider): Promise<anchor.Program<RewardsDelegatedVrf>> => {
    try {
      console.log("[createProgram] Creating Anchor program with IDL...");
      console.log("[createProgram] IDL address:", (rewardsDelegatedVrfIdl as any).address);
      console.log("[createProgram] Provider:", {
        wallet: provider.wallet.publicKey.toString(),
        connection: provider.connection.rpcEndpoint,
      });
      const program = new anchor.Program<RewardsDelegatedVrf>(
        rewardsDelegatedVrfIdl as anchor.Idl,
        provider
      );
      console.log("[createProgram] Program created successfully");
      console.log("[createProgram] Program ID:", program.programId.toString());
      return program;
    } catch (err) {
      console.error("[createProgram] Failed to create program:", err);
      throw err;
    }
  };



  // Create provider helper
  const createProvider = (endpointOverride?: string) => {
    if (!publicKey || !signTransaction) {
      throw new Error("Wallet not connected");
    }
    
    const wallet = {
      publicKey,
      signTransaction: signTransaction.bind({}),
      signAllTransactions: async (txs: Transaction[]) => {
        return Promise.all(txs.map(tx => signTransaction!(tx)));
      },
    } as unknown as anchor.Wallet;
    const providerConnection = endpointOverride
      ? new anchor.web3.Connection(endpointOverride, "confirmed")
      : connection;
    return new anchor.AnchorProvider(providerConnection, wallet, { commitment: "confirmed" });
  };

  // Send transaction helper with verification
  const sendTransaction = async (
    tx: Transaction,
    endpointOverride?: string
  ): Promise<TransactionResponse> => {
    if (!publicKey || !signTransaction) {
      console.error("[sendTransaction] Wallet not connected");
      return { success: false, error: "Wallet not connected" };
    }

    try {
      const txConnection = endpointOverride
        ? new anchor.web3.Connection(endpointOverride, "confirmed")
        : connection;
      console.log("[sendTransaction] Starting transaction send...");
      
      // Set transaction properties
      tx.feePayer = publicKey;
      const latestBlockhash = await txConnection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      console.log("[sendTransaction] Transaction prepared with blockhash:", latestBlockhash.blockhash);

      // Sign with wallet adapter
      console.log("[sendTransaction] Signing transaction...");
      const signedTx = await signTransaction(tx);
      console.log("[sendTransaction] Transaction signed successfully");
      
      // Send transaction
      console.log("[sendTransaction] Sending raw transaction...");
      const signature = await txConnection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

      console.log("[sendTransaction] Transaction sent with signature:", signature);

      // Wait for confirmation with timeout
      try {
        await Promise.race([
          txConnection.confirmTransaction(signature, "confirmed"),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Transaction confirmation timeout")),
              60000
            )
          ),
        ]);
      } catch (confirmErr) {
        console.warn("[sendTransaction] Confirmation timeout or error, but signature was sent:", signature);
        // Continue to check status even if confirmation times out
      }

      // Verify transaction actually succeeded
      try {
        const txStatus = await txConnection.getSignatureStatus(signature);
        console.log("[sendTransaction] Transaction status:", txStatus);
        
        if (txStatus.value?.err) {
          console.error("[sendTransaction] Transaction failed onchain:", txStatus.value.err);
          
          // Parse instruction error for better message
          let errorMessage = JSON.stringify(txStatus.value.err);
          if (typeof txStatus.value.err === 'object' && 'InstructionError' in txStatus.value.err) {
            const [index, errContent] = (txStatus.value.err as any).InstructionError;
            errorMessage = `Instruction ${index} failed: ${JSON.stringify(errContent)}`;
          }
          
          console.log("[sendTransaction] Returning failed response with signature:", signature);
          return {
            success: false,
            signature,
            error: errorMessage,
            endpoint: txConnection.rpcEndpoint,
          };
        }

        console.log("[sendTransaction] Transaction succeeded, returning signature:", signature);
        return { success: true, signature, endpoint: txConnection.rpcEndpoint };
      } catch (statusErr) {
        // If we can't get status, but we have signature, return it with unknown error
        console.warn("[sendTransaction] Could not get signature status, but signature was sent:", signature, statusErr);
        return { 
          success: false, 
          signature,
          error: "Transaction sent but could not verify status. Check explorer for details.",
          endpoint: txConnection.rpcEndpoint,
        };
      }
    } catch (err) {
      let errorMessage = "Unknown error";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null) {
        errorMessage = JSON.stringify(err, null, 2);
      } else {
        errorMessage = String(err);
      }
      console.error("[sendTransaction] Transaction error:", {
        message: errorMessage,
        fullError: err,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return { success: false, error: errorMessage };
    }
  };

  const initializeRewardDistributor = useCallback(
    async (whitelist: PublicKey[] = []): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };
      
      setStatus({ loading: true, error: null, signature: null });

      try {
         const actionEndpoint = getActionEndpoint("solana");
         const provider = createProvider(actionEndpoint);
         
         // Create program and build transaction
         const program = await createProgram(provider);
         const rewardDistributorPda = getDistributorPda(publicKey);

        const tx = await program.methods
          .initializeRewardDistributor(whitelist)
          .accounts({
            initializer: publicKey,
            rewardDistributor: rewardDistributorPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          } as any)
          .transaction();

        // Send and sign transaction
        console.log("[initializeRewardDistributor] Calling sendTransaction...");
        const result = await sendTransaction(tx, actionEndpoint);
        console.log("[initializeRewardDistributor] sendTransaction returned:", result);
        
        if (result.success) {
          console.log("[initializeRewardDistributor] Success, signature:", result.signature);
          setStatus({ loading: false, error: null, signature: result.signature || null });
        } else {
          console.log("[initializeRewardDistributor] Failed, error:", result.error);
          setStatus({ loading: false, error: result.error || null, signature: null });
        }
        console.log("[initializeRewardDistributor] Returning result:", result);
        return result;
      } catch (err) {
        let errorMessage = "Unknown error";
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (typeof err === 'object' && err !== null) {
          errorMessage = JSON.stringify(err, null, 2);
        } else {
          errorMessage = String(err);
        }
        console.error("[initializeRewardDistributor] Full error:", {
          message: errorMessage,
          fullError: err,
        });
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
      }
      },
      [publicKey, signTransaction, connection]
      );

  const setAdmins = useCallback(
    async (newAdmins: PublicKey[]): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };
      
      setStatus({ loading: true, error: null, signature: null });

      try {
        const actionEndpoint = getActionEndpoint("solana");
        const provider = createProvider(actionEndpoint);
        const program = await createProgram(provider);
        const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);

        const tx = await program.methods
          .setAdmins(newAdmins)
          .accounts({
            admin: publicKey,
            rewardDistributor: rewardDistributorPda,
          } as any)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({ 
          loading: false, 
          error: result.error || null, 
          signature: result.signature || null 
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
        }
        },
        [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]
        );

        const setWhitelist = useCallback(
    async (newWhitelist: PublicKey[]): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };
      
      setStatus({ loading: true, error: null, signature: null });

      try {
        const actionEndpoint = getActionEndpoint("solana");
        const provider = createProvider(actionEndpoint);
        const program = await createProgram(provider);
        const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);

        const tx = await program.methods
          .setWhitelist(newWhitelist)
          .accounts({
            admin: publicKey,
            rewardDistributor: rewardDistributorPda,
          } as any)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({ 
          loading: false, 
          error: result.error || null, 
          signature: result.signature || null 
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
        }
        },
        [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]
        );

        const setRewardList = useCallback(
    async (
      globalRangeMin: number | null,
      globalRangeMax: number | null,
      startTimestamp: number | null,
      endTimestamp: number | null
    ): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };

      setStatus({ loading: true, error: null, signature: null });

      try {
        const actionEndpoint = getActionEndpoint("magicblock");
        const provider = createProvider(actionEndpoint);
        const program = await createProgram(provider);
        const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);
        const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

        const tx = await program.methods
          .setRewardList(
            null,
            typeof startTimestamp === "number" && startTimestamp > 0
              ? new anchor.BN(startTimestamp)
              : null,
            typeof endTimestamp === "number" && endTimestamp > 0
              ? new anchor.BN(endTimestamp)
              : null,
            typeof globalRangeMin === "number" && Number.isFinite(globalRangeMin)
              ? globalRangeMin
              : null,
            typeof globalRangeMax === "number" && Number.isFinite(globalRangeMax)
              ? globalRangeMax
              : null
          )
          .accounts({
            admin: publicKey,
            rewardDistributor: rewardDistributorPda,
            rewardList: rewardListPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          } as any)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({ 
          loading: false, 
          error: result.error || null, 
          signature: result.signature || null 
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
        }
        },
        [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]
        );

        const delegateRewardList = useCallback(async (): Promise<TransactionResponse> => {
    if (!publicKey) return { success: false, error: "Wallet not connected" };

    setStatus({ loading: true, error: null, signature: null });

    try {
      const actionEndpoint = getActionEndpoint("solana");
      const provider = createProvider(actionEndpoint);
      const program = await createProgram(provider);
      const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);
      const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

      const tx = await program.methods
        .delegateRewardList()
        .accounts({
          admin: publicKey,
          rewardDistributor: rewardDistributorPda,
          rewardList: rewardListPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .transaction();

      const result = await sendTransaction(tx, actionEndpoint);
      setStatus({ 
        loading: false, 
        error: result.error || null, 
        signature: result.signature || null 
      });
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setStatus({ loading: false, error: errorMessage, signature: null });
      return { success: false, error: errorMessage };
      }
      }, [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]);

      const undelegateRewardList = useCallback(
    async (): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };

      setStatus({ loading: true, error: null, signature: null });

      try {
        const actionEndpoint = getActionEndpoint("magicblock");
        const provider = createProvider(actionEndpoint);
        const program = await createProgram(provider);
        const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);
        const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

        const tx = await program.methods
          .undelegateRewardList()
          .accounts({
            payer: publicKey,
            rewardDistributor: rewardDistributorPda,
            rewardList: rewardListPda,
          } as any)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({ 
          loading: false, 
          error: result.error || null, 
          signature: result.signature || null 
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
        }
        },
        [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]
        );

  const requestRandomReward = useCallback(
    async (user: PublicKey, clientSeed: number): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };

      setStatus({ loading: true, error: null, signature: null });

      try {
         const actionEndpoint = getActionEndpoint("magicblock");
         const provider = createProvider(actionEndpoint);
         const program = await createProgram(provider);
         const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);
         const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
         const [transferLookupTablePda] = PDAs.getTransferLookupTable();
         const programIdentity = getVrfProgramIdentity();

         console.log("Request random reward with:", {
           user: user.toString(),
           admin: publicKey.toString(),
           distributor: rewardDistributorPda.toString(),
           rewardList: rewardListPda.toString(),
           transferLookupTable: transferLookupTablePda.toString(),
           oracleQueue: ORACLE_QUEUE.toString(),
           programIdentity: programIdentity.toString(),
           vrfProgram: VRF_PROGRAM_ID.toString(),
           clientSeed,
         });

         const tx = await program.methods
           .requestRandomReward(clientSeed)
           .accounts({
             user,
             admin: publicKey,
             rewardDistributor: rewardDistributorPda,
             rewardList: rewardListPda,
             transferLookupTable: transferLookupTablePda,
             oracleQueue: ORACLE_QUEUE,
             programIdentity,
             vrfProgram: VRF_PROGRAM_ID,
             slotHashes: SLOT_HASHES_SYSVAR,
             systemProgram: anchor.web3.SystemProgram.programId,
           } as any)
           .transaction();

         const result = await sendTransaction(tx, actionEndpoint);
         setStatus({ 
           loading: false, 
           error: result.error || null, 
           signature: result.signature || null 
         });

         // If request was successful, listen for VRF callback logs
         if (result.success && result.signature) {
           const requestSignature = result.signature;
           console.log("[requestRandomReward] Request succeeded with signature:", requestSignature);
           console.log("[requestRandomReward] Setting up VRF callback listener...");
           let listener: number | null = null;
           let listenerRemoved = false;
           let callbackFound = false;
           
           const callbackReceived = new Promise<void>((resolve) => {
             const timeoutId = setTimeout(() => {
               if (listener !== null && !listenerRemoved) {
                 provider.connection.removeOnLogsListener(listener);
                 listenerRemoved = true;
               }
               console.log("[requestRandomReward] VRF callback listener timeout after 30s. Callback found:", callbackFound);
               resolve();
             }, 30000); // 30 second timeout

             listener = provider.connection.onLogs(
               PROGRAM_ID,
               (logs) => {
                 try {
                   console.log("[VRF Callback] ===== LOGS RECEIVED =====");
                   console.log("[VRF Callback] Transaction signature:", logs.signature);
                   console.log("[VRF Callback] All program logs:");
                   logs.logs.forEach((log, idx) => console.log(`  [${idx}] ${log}`));
                   
                   const relevantLogs = logs.logs.filter(
                     (log) => 
                       log.includes("Random result:") || 
                       log.includes("Won reward") || 
                       log.includes("exhausted") ||
                       log.includes("Reward:")
                   );
                   
                   console.log("[VRF Callback] Found relevant logs:", relevantLogs.length > 0);
                   
                   if (relevantLogs.length > 0) {
                     callbackFound = true;
                     const txStatus = logs.err ? "failed" : "confirmed";
                     console.log("[VRF Callback] This is the consume callback! Signature:", logs.signature);
                     console.log("[VRF Callback] Transaction Status:", txStatus);
                     console.log("[VRF Callback] Relevant logs:");
                     relevantLogs.forEach((log) => console.log("  " + log));
                     
                     if (logs.err) {
                       console.log("[VRF Callback] ERROR:", JSON.stringify(logs.err));
                     }
                     
                     // Add the callback as a separate transaction entry
                     if (props?.onTransactionAdd && props?.onTransactionUpdate) {
                       const clusterEndpoint = result.endpoint || provider.connection.rpcEndpoint || getDefaultSolanaEndpoint();
                       console.log("[VRF Callback] Adding callback transaction to history with status:", txStatus);
                       // Create a callback entry in the transaction history
                       const callbackTxId = props.onTransactionAdd(
                         logs.signature,
                         `Consume Random Reward (VRF Callback)\n${relevantLogs.join("\n")}`,
                         "devnet",
                         clusterEndpoint
                       );
                       // Mark it with the correct status
                       console.log("[VRF Callback] Marking callback transaction as", txStatus, ":", callbackTxId);
                       props.onTransactionUpdate(callbackTxId, {
                         status: txStatus,
                         error: logs.err ? JSON.stringify(logs.err) : undefined,
                       });
                     }
                   } else {
                     console.log("[VRF Callback] No relevant logs found, continuing to listen...");
                   }
                   
                   if (callbackFound) {
                     if (listener !== null && !listenerRemoved) {
                       provider.connection.removeOnLogsListener(listener);
                       listenerRemoved = true;
                     }
                     clearTimeout(timeoutId);
                     resolve();
                   }
                 } catch (err) {
                   console.error("[VRF Callback] Error in log listener:", err);
                   if (listener !== null && !listenerRemoved) {
                     provider.connection.removeOnLogsListener(listener);
                     listenerRemoved = true;
                   }
                   clearTimeout(timeoutId);
                   resolve();
                 }
               },
               "confirmed"
             );
           });

           // Set up async callback update without blocking the transaction result
           callbackReceived.then(() => {
             console.log("[requestRandomReward] Callback listener completed. Found callback:", callbackFound);
           }).catch((err) => {
             console.error("[requestRandomReward] Callback listener error:", err);
           });
         }

         return result;
       } catch (err) {
         const errorMessage = err instanceof Error ? err.message : "Unknown error";
         console.error("Request random reward error:", err);
         setStatus({ loading: false, error: errorMessage, signature: null });
         return { success: false, error: errorMessage };
       }
    },
    [publicKey, signTransaction, connection, props]
  );

  const addReward = useCallback(
    async (
      rewardName: string,
      rewardMint: PublicKey,
      tokenAccount: PublicKey,
      rewardAmount?: number,
      drawRangeMin?: number,
      drawRangeMax?: number,
      redemptionLimit?: number,
      metadataAccount?: PublicKey
    ): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };

      setStatus({ loading: true, error: null, signature: null });

      try {
        const actionEndpoint = getActionEndpoint("magicblock");
        const provider = createProvider(actionEndpoint);
        const program = await createProgram(provider);
        const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);
        const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];

        const accounts: any = {
          admin: publicKey,
          rewardDistributor: rewardDistributorPda,
          rewardList: rewardListPda,
          mint: rewardMint,
          tokenAccount,
          metadata: metadataAccount ?? null,
        };
 
        const tx = await program.methods
          .addReward(
            rewardName,
            rewardAmount ? new anchor.BN(rewardAmount) : null,
            drawRangeMin || null,
            drawRangeMax || null,
            redemptionLimit ? new anchor.BN(redemptionLimit) : null,
          )
          .accounts(accounts)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({ 
          loading: false, 
          error: result.error || null, 
          signature: result.signature || null 
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
        }
        },
        [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]
        );

  const removeReward = useCallback(
    async (rewardName: string, rewardMint?: PublicKey, redemptionAmount?: number): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };
      setStatus({ loading: true, error: null, signature: null });

      try {
        const actionEndpoint = getActionEndpoint("magicblock");
        const provider = createProvider(actionEndpoint);
        const program = await createProgram(provider);
        const rewardDistributorPda = props?.selectedDistributor || getDistributorPda(publicKey);
        const rewardListPda = PDAs.getRewardList(rewardDistributorPda)[0];
        const [transferLookupTablePda] = PDAs.getTransferLookupTable();

        const accounts: any = {
          admin: publicKey,
          rewardDistributor: rewardDistributorPda,
          rewardList: rewardListPda,
          transferLookupTable: transferLookupTablePda,
          destination: publicKey,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID
        };

  
        console.log(accounts)
        const tx = await program.methods
          .removeReward(rewardName, rewardMint || null, redemptionAmount ? new anchor.BN(redemptionAmount) : null)
          .accounts(accounts)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({ 
          loading: false, 
          error: result.error || null, 
          signature: result.signature || null 
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatus({ loading: false, error: errorMessage, signature: null });
        return { success: false, error: errorMessage };
      }
    },
    [publicKey, signTransaction, connection, props?.selectedDistributor?.toString()]
  );

  const mintNftCollection = useCallback(
    async (
      _name: string,
      _symbol: string,
      _uri: string,
      _decimals: number = 0
    ): Promise<TransactionResponse & { mint?: PublicKey }> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };

      try {
        // Create a new mint
        const mintKeypair = anchor.web3.Keypair.generate();
        const rent = await connection.getMinimumBalanceForRentExemption(82); // Mint account size
        
        setStatus({ loading: true, error: null, signature: null });

        const transaction = new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: 82,
            lamports: rent,
            programId: TOKEN_PROGRAM_ID,
          })
        );

        transaction.feePayer = publicKey;
        transaction.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;

        const signedTx = await (window as any).wallet?.adapter?.signTransaction?.(transaction);
        if (!signedTx) {
          throw new Error("Failed to sign transaction");
        }

        const signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        await connection.confirmTransaction(signature, "confirmed");

        setStatus({
          loading: false,
          error: null,
          signature,
        });

        return {
          success: true,
          signature,
          mint: mintKeypair.publicKey,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error occurred";

        setStatus({
          loading: false,
          error: errorMessage,
          signature: null,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    [publicKey, connection]
  );

  const sendSplTokenToDistributor = useCallback(
    async (
      tokenMint: PublicKey,
      amount: number,
      decimals: number
    ): Promise<TransactionResponse> => {
      if (!publicKey) return { success: false, error: "Wallet not connected" };

      setStatus({ loading: true, error: null, signature: null });

      try {
        const rewardDistributorPda = getDistributorPda(publicKey);
        
        // Get or create associated token accounts
        const userTokenAccount = getAssociatedTokenAddressSync(
          tokenMint,
          publicKey
        );
        
        const distributorTokenAccount = getAssociatedTokenAddressSync(
          tokenMint,
          rewardDistributorPda,
          true // allowOffCurve for PDAs
        );

        const tx = new anchor.web3.Transaction();

        // Check if distributor token account exists, if not create it
        try {
          await getAccount(connection, distributorTokenAccount);
        } catch {
          tx.add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              distributorTokenAccount,
              rewardDistributorPda,
              tokenMint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }

        // Add SPL token transfer instruction
        const tokenAmount = Math.floor(amount * Math.pow(10, decimals));
        
        tx.add(
          createTransferInstruction(
            userTokenAccount,
            distributorTokenAccount,
            publicKey,
            tokenAmount,
            [],
            TOKEN_PROGRAM_ID
          )
        );

        tx.feePayer = publicKey;
        tx.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;

        if (!signTransaction) {
          throw new Error("Wallet does not support signing transactions");
        }

        const signedTx = await signTransaction(tx);
        const signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        await connection.confirmTransaction(signature, "confirmed");

        setStatus({
          loading: false,
          error: null,
          signature,
        });

        return {
          success: true,
          signature,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error occurred";

        setStatus({
          loading: false,
          error: errorMessage,
          signature: null,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    [publicKey, connection, signTransaction]
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
    removeReward,
    mintNftCollection,
    sendSplTokenToDistributor,
  };
};
