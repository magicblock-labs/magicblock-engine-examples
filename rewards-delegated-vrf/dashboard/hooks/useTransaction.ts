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
  createInitializeMintInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import {
  createCreateMasterEditionV3Instruction,
  createCreateMetadataAccountV3Instruction,
  createSetAndVerifySizedCollectionItemInstruction,
} from "../../node_modules/@metaplex-foundation/mpl-token-metadata";

type AdminActionEndpointMode = "solana" | "magicblock";

const SOLANA_DEVNET_ENDPOINT = "https://rpc.magicblock.app/devnet";
const SOLANA_MAINNET_ENDPOINT = "https://rpc.magicblock.app/mainnet";
const MAGICBLOCK_DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/";
const MAGICBLOCK_MAINNET_ENDPOINT = "https://as.magicblock.app";
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

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
      const program = new anchor.Program<RewardsDelegatedVrf>(
        rewardsDelegatedVrfIdl as anchor.Idl,
        provider
      );
      return program;
    } catch (err) {
      console.error("Failed to create program:", err);
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
      return { success: false, error: "Wallet not connected" };
    }

    try {
      const txConnection = endpointOverride
        ? new anchor.web3.Connection(endpointOverride, "confirmed")
        : connection;
      
      // Set transaction properties
      tx.feePayer = publicKey;
      const latestBlockhash = await txConnection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;

      // Sign with wallet adapter
      const signedTx = await signTransaction(tx);
      
      // Send transaction
      const signature = await txConnection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

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
      } catch {
        // Continue to check status even if confirmation times out
      }

      // Verify transaction actually succeeded
      try {
        const txStatus = await txConnection.getSignatureStatus(signature);
        
        if (txStatus.value?.err) {
          // Parse instruction error for better message
          let errorMessage = JSON.stringify(txStatus.value.err);
          if (typeof txStatus.value.err === 'object' && 'InstructionError' in txStatus.value.err) {
            const [index, errContent] = (txStatus.value.err as any).InstructionError;
            errorMessage = `Instruction ${index} failed: ${JSON.stringify(errContent)}`;
          }
          
          return {
            success: false,
            signature,
            error: errorMessage,
            endpoint: txConnection.rpcEndpoint,
          };
        }

        return { success: true, signature, endpoint: txConnection.rpcEndpoint };
      } catch {
        // If we can't get status, but we have signature, return it with unknown error
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
      console.error("Transaction error:", errorMessage);
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

        const result = await sendTransaction(tx, actionEndpoint);

        if (result.success) {
          setStatus({ loading: false, error: null, signature: result.signature || null });
        } else {
          setStatus({ loading: false, error: result.error || null, signature: null });
        }
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
        console.error("Initialize reward distributor error:", errorMessage);
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
           let listener: number | null = null;
           let listenerRemoved = false;
           let callbackFound = false;
           
           const callbackReceived = new Promise<void>((resolve) => {
             const timeoutId = setTimeout(() => {
               if (listener !== null && !listenerRemoved) {
                 provider.connection.removeOnLogsListener(listener);
                 listenerRemoved = true;
               }
               resolve();
             }, 30000); // 30 second timeout

             listener = provider.connection.onLogs(
              PROGRAM_ID,
              (logs) => {
                try {
                   const relevantLogs = logs.logs.filter(
                     (log) => 
                       log.includes("Random result:") || 
                       log.includes("Won reward") || 
                       log.includes("exhausted") ||
                       log.includes("Reward:")
                   );

                   if (relevantLogs.length > 0) {
                     callbackFound = true;
                     const txStatus = logs.err ? "failed" : "confirmed";

                     // Add the callback as a separate transaction entry
                     if (props?.onTransactionAdd && props?.onTransactionUpdate) {
                       const clusterEndpoint = result.endpoint || provider.connection.rpcEndpoint || getDefaultSolanaEndpoint();
                       // Create a callback entry in the transaction history
                       const callbackTxId = props.onTransactionAdd(
                         logs.signature,
                         `Consume Random Reward (VRF Callback)\n${relevantLogs.join("\n")}`,
                         "devnet",
                         clusterEndpoint
                       );
                       // Mark it with the correct status
                       props.onTransactionUpdate(callbackTxId, {
                         status: txStatus,
                         error: logs.err ? JSON.stringify(logs.err) : undefined,
                        });
                      }
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
                   console.error("VRF callback log listener error:", err);
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
           callbackReceived.catch((err) => {
             console.error("Request random reward callback listener error:", err);
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

  const updateReward = useCallback(
    async (
      currentRewardName: string,
      updatedRewardName: string | null,
      rewardMint: PublicKey | null,
      tokenAccount: PublicKey | null,
      rewardAmount: number | null,
      drawRangeMin: number | null,
      drawRangeMax: number | null
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
        };
        if (rewardMint) {
          accounts.mint = rewardMint;
        }
        if (tokenAccount) {
          accounts.tokenAccount = tokenAccount;
        }

        const tx = await program.methods
          .updateReward(
            currentRewardName,
            updatedRewardName,
            rewardAmount != null ? new anchor.BN(rewardAmount) : null,
            drawRangeMin,
            drawRangeMax
          )
          .accounts(accounts)
          .transaction();

        const result = await sendTransaction(tx, actionEndpoint);
        setStatus({
          loading: false,
          error: result.error || null,
          signature: result.signature || null,
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
      name: string,
      symbol: string,
      uri: string,
      _decimals: number = 0
    ): Promise<TransactionResponse & { mint?: PublicKey }> => {
      if (!publicKey || !signTransaction) {
        return { success: false, error: "Wallet not connected" };
      }

      try {
        const actionEndpoint = getActionEndpoint("solana");
        const txConnection =
          actionEndpoint && actionEndpoint !== connection.rpcEndpoint
            ? new anchor.web3.Connection(actionEndpoint, "confirmed")
            : connection;

        const trimmedName = name.trim();
        const trimmedSymbol = symbol.trim();
        const trimmedUri = uri.trim();

        if (!trimmedName || !trimmedSymbol || !trimmedUri) {
          throw new Error("Collection name, symbol, and URI are required");
        }

        const mintKeypair = anchor.web3.Keypair.generate();
        const mintRent = await txConnection.getMinimumBalanceForRentExemption(82);
        const ownerTokenAccount = getAssociatedTokenAddressSync(
          mintKeypair.publicKey,
          publicKey
        );
        const [metadataAddress] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );
        const [masterEditionAddress] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
            Buffer.from("edition"),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );

        setStatus({ loading: true, error: null, signature: null });

        const transaction = new anchor.web3.Transaction()
          .add(
            anchor.web3.SystemProgram.createAccount({
              fromPubkey: publicKey,
              newAccountPubkey: mintKeypair.publicKey,
              space: 82,
              lamports: mintRent,
              programId: TOKEN_PROGRAM_ID,
            })
          )
          .add(
            createInitializeMintInstruction(
              mintKeypair.publicKey,
              0,
              publicKey,
              publicKey,
              TOKEN_PROGRAM_ID
            )
          )
          .add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              ownerTokenAccount,
              publicKey,
              mintKeypair.publicKey,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
          .add(
            createMintToInstruction(
              mintKeypair.publicKey,
              ownerTokenAccount,
              publicKey,
              1,
              [],
              TOKEN_PROGRAM_ID
            )
          )
          .add(
            createCreateMetadataAccountV3Instruction(
              {
                metadata: metadataAddress,
                mint: mintKeypair.publicKey,
                mintAuthority: publicKey,
                payer: publicKey,
                updateAuthority: publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
              },
              {
                createMetadataAccountArgsV3: {
                  data: {
                    name: trimmedName,
                    symbol: trimmedSymbol,
                    uri: trimmedUri,
                    sellerFeeBasisPoints: 0,
                    creators: [
                      {
                        address: publicKey,
                        verified: true,
                        share: 100,
                      },
                    ],
                    collection: null,
                    uses: null,
                  },
                  isMutable: true,
                  collectionDetails: { __kind: "V1", size: new anchor.BN(0) },
                },
              }
            )
          )
          .add(
            createCreateMasterEditionV3Instruction(
              {
                edition: masterEditionAddress,
                metadata: metadataAddress,
                mint: mintKeypair.publicKey,
                mintAuthority: publicKey,
                payer: publicKey,
                updateAuthority: publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
              },
              {
                createMasterEditionArgs: {
                  maxSupply: new anchor.BN(0),
                },
              }
            )
          );

        transaction.feePayer = publicKey;
        transaction.recentBlockhash = (
          await txConnection.getLatestBlockhash()
        ).blockhash;
        transaction.partialSign(mintKeypair);

        const signedTx = await signTransaction(transaction);

        const signature = await txConnection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        await txConnection.confirmTransaction(signature, "confirmed");

        setStatus({
          loading: false,
          error: null,
          signature,
        });

        return {
          success: true,
          signature,
          mint: mintKeypair.publicKey,
          endpoint: txConnection.rpcEndpoint,
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
    [publicKey, connection, signTransaction, getActionEndpoint]
  );

  const mintNftToCollection = useCallback(
    async (
      collectionMint: PublicKey,
      name: string,
      symbol: string,
      uri: string
    ): Promise<TransactionResponse & { mint?: PublicKey }> => {
      if (!publicKey || !signTransaction) {
        return { success: false, error: "Wallet not connected" };
      }

      try {
        const actionEndpoint = getActionEndpoint("solana");
        const txConnection =
          actionEndpoint && actionEndpoint !== connection.rpcEndpoint
            ? new anchor.web3.Connection(actionEndpoint, "confirmed")
            : connection;

        const trimmedName = name.trim();
        const trimmedSymbol = symbol.trim();
        const trimmedUri = uri.trim();

        if (!trimmedName || !trimmedSymbol || !trimmedUri) {
          throw new Error("Collection mint, NFT name, symbol, and URI are required");
        }

        const mintKeypair = anchor.web3.Keypair.generate();
        const mintRent = await txConnection.getMinimumBalanceForRentExemption(82);
        const ownerTokenAccount = getAssociatedTokenAddressSync(
          mintKeypair.publicKey,
          publicKey
        );
        const [metadataAddress] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );
        const [masterEditionAddress] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
            Buffer.from("edition"),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );
        const [collectionMetadataAddress] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            collectionMint.toBuffer(),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );

        setStatus({ loading: true, error: null, signature: null });

        const transaction = new anchor.web3.Transaction()
          .add(
            anchor.web3.SystemProgram.createAccount({
              fromPubkey: publicKey,
              newAccountPubkey: mintKeypair.publicKey,
              space: 82,
              lamports: mintRent,
              programId: TOKEN_PROGRAM_ID,
            })
          )
          .add(
            createInitializeMintInstruction(
              mintKeypair.publicKey,
              0,
              publicKey,
              publicKey,
              TOKEN_PROGRAM_ID
            )
          )
          .add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              ownerTokenAccount,
              publicKey,
              mintKeypair.publicKey,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
          .add(
            createMintToInstruction(
              mintKeypair.publicKey,
              ownerTokenAccount,
              publicKey,
              1,
              [],
              TOKEN_PROGRAM_ID
            )
          )
          .add(
            createCreateMetadataAccountV3Instruction(
              {
                metadata: metadataAddress,
                mint: mintKeypair.publicKey,
                mintAuthority: publicKey,
                payer: publicKey,
                updateAuthority: publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
              },
              {
                createMetadataAccountArgsV3: {
                  data: {
                    name: trimmedName,
                    symbol: trimmedSymbol,
                    uri: trimmedUri,
                    sellerFeeBasisPoints: 0,
                    creators: [
                      {
                        address: publicKey,
                        verified: true,
                        share: 100,
                      },
                    ],
                    collection: {
                      key: collectionMint,
                      verified: false,
                    },
                    uses: null,
                  },
                  isMutable: true,
                  collectionDetails: null,
                },
              }
            )
          )
          .add(
            createCreateMasterEditionV3Instruction(
              {
                edition: masterEditionAddress,
                metadata: metadataAddress,
                mint: mintKeypair.publicKey,
                mintAuthority: publicKey,
                payer: publicKey,
                updateAuthority: publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
              },
              {
                createMasterEditionArgs: {
                  maxSupply: null,
                },
              }
            )
          )
          .add(
            createSetAndVerifySizedCollectionItemInstruction({
              metadata: metadataAddress,
              collectionAuthority: publicKey,
              payer: publicKey,
              updateAuthority: publicKey,
              collectionMint,
              collection: collectionMetadataAddress,
              collectionMasterEditionAccount: PublicKey.findProgramAddressSync(
                [
                  Buffer.from("metadata"),
                  TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                  collectionMint.toBuffer(),
                  Buffer.from("edition"),
                ],
                TOKEN_METADATA_PROGRAM_ID
              )[0],
            } as any)
          );

        transaction.feePayer = publicKey;
        transaction.recentBlockhash = (
          await txConnection.getLatestBlockhash()
        ).blockhash;
        transaction.partialSign(mintKeypair);

        const signedTx = await signTransaction(transaction);
        const signature = await txConnection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        await txConnection.confirmTransaction(signature, "confirmed");

        setStatus({
          loading: false,
          error: null,
          signature,
        });

        return {
          success: true,
          signature,
          mint: mintKeypair.publicKey,
          endpoint: txConnection.rpcEndpoint,
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
    [publicKey, connection, signTransaction, getActionEndpoint]
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
        const actionEndpoint = getActionEndpoint("solana");
        const txConnection =
          actionEndpoint && actionEndpoint !== connection.rpcEndpoint
            ? new anchor.web3.Connection(actionEndpoint, "confirmed")
            : connection;
        const rewardDistributorPda =
          props?.selectedDistributor || getDistributorPda(publicKey);
        
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
          await getAccount(txConnection, distributorTokenAccount);
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
          await txConnection.getLatestBlockhash()
        ).blockhash;

        if (!signTransaction) {
          throw new Error("Wallet does not support signing transactions");
        }

        const signedTx = await signTransaction(tx);
        const signature = await txConnection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        await txConnection.confirmTransaction(signature, "confirmed");

        setStatus({
          loading: false,
          error: null,
          signature,
        });

        return {
          success: true,
          signature,
          endpoint: txConnection.rpcEndpoint,
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
          endpoint: getActionEndpoint("solana"),
        };
      }
    },
    [publicKey, connection, signTransaction, getActionEndpoint, props?.selectedDistributor]
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
    updateReward,
    mintNftCollection,
    mintNftToCollection,
    sendSplTokenToDistributor,
  };
};
