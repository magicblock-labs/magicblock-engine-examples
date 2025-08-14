import { BlockhashWithExpiryBlockHeight, Commitment, ConfirmOptions, Connection, GetLatestBlockhashConfig, PublicKey, RpcResponseAndContext, SendOptions, SendTransactionError, SignatureResult, SignatureStatus, SignatureStatusConfig, Signer, Transaction, TransactionConfirmationStrategy, TransactionSignature } from "@solana/web3.js";
import assert from "assert";
import bs58 from "bs58";

/**
 * Get writable accounts from a transaction.
 */
export function getWritableAccounts(transaction: Transaction) {
    const writableAccounts = new Set<string>();

    for (const instruction of transaction.instructions) {
        for (const accountMeta of instruction.keys) {
        if (accountMeta.isWritable) {
            writableAccounts.add(accountMeta.pubkey.toBase58());
        }
        }
    }

    return Array.from(writableAccounts);
}


/**
 * Get the latest blockhash for a transaction based on writable accounts.
 */
export async function getLatestBlockhashForMagicTransaction(connection: Connection, transaction: Transaction, options: Commitment | GetLatestBlockhashConfig = { commitment: "confirmed" }): Promise<BlockhashWithExpiryBlockHeight> {
  const writableAccounts = getWritableAccounts(transaction);


  const { commitment, config } = extractCommitmentFromConfig(options)
  const args = buildArgs([writableAccounts], commitment, undefined /* encoding */, config);
  const blockHashResponse = await fetch(connection.rpcEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBlockhashForAccounts',
      params: args
    })
  });
  
  const blockHashData = (await blockHashResponse.json());

  // Fallback to default getLatestBlockhash if getLatestBlockhach by writable account fails
  if (blockHashData.result) {
    return blockHashData.result; 
  } else if (blockHashData.error && blockHashData.error.code === -32601) {
    return await connection.getLatestBlockhash(options);
  } else {
    throw new Error(`Failed to get blockhash.`);
  }
}


/**
 * Get the latest blockhash for a transaction based on writable accounts.
 */
export async function getClosestValidator(routerConnection) {
    const response = await fetch(routerConnection.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getIdentity',
            params: []
        })
    });
    const identityData = await response.json();
    const validatorKey = new PublicKey(identityData.result.identity);
    return validatorKey;
}


/**
 * Send a transaction, returning the signature of the transaction.
 * This function is modified to handle the magic transaction sending strategy by getting the latest blockhash based on writable accounts.
 */
export async function sendMagicTransaction (connection: Connection, transaction: Transaction, signersOrOptions?: Array<Signer> | SendOptions, options?: SendOptions) : Promise<TransactionSignature> {
    if ('version' in transaction) {
        if (signersOrOptions && Array.isArray(signersOrOptions)) {
            throw new Error('Invalid arguments');
        }
        const wireTransaction = transaction.serialize();
        return await connection.sendRawTransaction(wireTransaction, options);
    }
    if (signersOrOptions === undefined || !Array.isArray(signersOrOptions)) {
        throw new Error('Invalid arguments');
    }
    const signers = signersOrOptions;
    if (transaction.nonceInfo) {
        transaction.sign(...signers);
    } else {
        for (;;) {
            const latestBlockhash = await getLatestBlockhashForMagicTransaction(connection, transaction);
            transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.sign(...signers);
            if (!transaction.signature) {
                throw new Error('!signature'); // should never happen
            }
            break;
        }
    }

    const wireTransaction = transaction.serialize();
    return await connection.sendRawTransaction(wireTransaction, options);
}


/**
 * Confirm a transaction, returning the status of the transaction.
 * This function is modified to handle the magic transaction confirmation strategy.
 * ONLY supports polling for now.
 */
export async function confirmMagicTransaction(connection: Connection, strategy : TransactionConfirmationStrategy, commitment?: Commitment) : Promise<RpcResponseAndContext<SignatureResult>> {
    let rawSignature;
    if (typeof strategy == 'string') {
      rawSignature = strategy;
    } else {
      const config = strategy;
      if (config.abortSignal?.aborted) {
        return Promise.reject(config.abortSignal.reason);
      }
      rawSignature = config.signature;
    }
    let decodedSignature;
    try {
      decodedSignature = bs58.decode(rawSignature);
    } catch (err) {
      throw new Error('signature must be base58 encoded: ' + rawSignature);
    }
    assert(decodedSignature.length === 64, 'signature has invalid length');
    const status = await pollSignatureStatus(
        getSignatureStatus,
        connection,
        rawSignature, 
        {
          intervalMs: 100,
          timeoutMs: 10_000,
          commitment: commitment
        }
    );
    return status
  }


/**
 * Send and confirm a transaction, returning the signature of the transaction.
 * ONLY supports polling for now.
 */
export async function sendAndConfirmMagicTransaction(connection: Connection, transaction: Transaction, signers: Array<Signer>, options: ConfirmOptions): Promise<TransactionSignature> {
    const sendOptions = options && {
        skipPreflight: options.skipPreflight,
        preflightCommitment: options.preflightCommitment || options.commitment,
        maxRetries: options.maxRetries,
        minContextSlot: options.minContextSlot
    };
    const signature = await sendMagicTransaction(connection, transaction, signers, options);
    let status;
    if (transaction.recentBlockhash != null && transaction.lastValidBlockHeight != null) {
        status = (await confirmMagicTransaction(connection,{
            abortSignal: options?.abortSignal,
            signature: signature,
            blockhash: transaction.recentBlockhash,
            lastValidBlockHeight: transaction.lastValidBlockHeight
            }, options && options.commitment)).value;
    } else if (transaction.minNonceContextSlot != null && transaction.nonceInfo != null) {
        const {
        nonceInstruction
        } = transaction.nonceInfo;
        const nonceAccountPubkey = nonceInstruction.keys[0].pubkey;
        status = (await confirmMagicTransaction(connection, {
            abortSignal: options?.abortSignal,
            minContextSlot: transaction.minNonceContextSlot,
            nonceAccountPubkey,
            nonceValue: transaction.nonceInfo.nonce,
            signature
            }, options && options.commitment)).value;
        } else {
        if (options?.abortSignal != null) {
        console.warn('sendAndConfirmTransaction(): A transaction with a deprecated confirmation strategy was ' + 'supplied along with an `abortSignal`. Only transactions having `lastValidBlockHeight` ' + 'or a combination of `nonceInfo` and `minNonceContextSlot` are abortable.');
        }
        status = (await confirmMagicTransaction(connection, signature, options && options.commitment)).value;
    }
    if (status.err) {
        if (signature != null) {
        throw new SendTransactionError({
            action: 'send',
            signature: signature,
            transactionMessage: `Status: (${JSON.stringify(status)})`
        });
        }
        throw new Error(`Transaction ${signature} failed (${JSON.stringify(status)})`);
    }
    return signature;
}


/**
 * Fetch the current status of a signature
 */
async function getSignatureStatus(connection: Connection, signature: TransactionSignature, config?: SignatureStatusConfig) : Promise<RpcResponseAndContext<SignatureStatus | null>>{
    const {
        context,
        value: values
    } = await getSignatureStatuses(connection, [signature], config);
    
    if (values.length === 0) {
        const value = null;
        return {
            context,
            value
        };
    } else {
      assert(values.length === 1);
      const value = values[0];
      return {
          context,
          value
      };
    }

}


/**
 * Fetch the current statuses of a batch of signatures
 */
async function getSignatureStatuses(connection: Connection, signatures: Array<TransactionSignature>, config?: SignatureStatusConfig) : Promise<RpcResponseAndContext<Array<SignatureStatus | null>>>{
    const params = [signatures];
    if (config) {
        params.push(config);
    }
    const unsafeRes = await fetch(connection.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: params
        })
    });
    const res = await unsafeRes.json();
    // const res = superstruct.create(unsafeRes, GetSignatureStatusesRpcResult);
    // if ('error' in res) {
    // throw new SolanaJSONRPCError(res.error, 'failed to get signature status');
    // }
    return res.result;
}


/**
 * Poll the current status of a signature
 */
export async function pollSignatureStatus(
  getSignatureStatus: (
    connection: Connection,
    signature: TransactionSignature,
    config?: SignatureStatusConfig
  ) => Promise<RpcResponseAndContext<SignatureStatus | null>>,
  connection: Connection,
  signature: string,
  {
    intervalMs = 50,
    timeoutMs = 12_000,
    commitment = "confirmed",
    abortSignal,
  }: {
    intervalMs?: number;
    timeoutMs?: number;
    commitment?: Commitment;
    abortSignal?: AbortSignal;
  } = {}
): Promise<RpcResponseAndContext<SignatureResult> | null> {
  const maxTries = Math.ceil(timeoutMs / intervalMs);
  let tries = 0;

  return new Promise((resolve, reject) => {
    const intervalId = setInterval(async () => {
      if (abortSignal?.aborted) {
        clearInterval(intervalId);
        return reject(abortSignal.reason ?? new Error('Polling aborted'));
      }

      tries++;

      try {
        const result = (await getSignatureStatus(connection, signature));
        if (result.value !== null) {
            if (
              result.value.confirmationStatus === commitment || 
              result.value.confirmationStatus === 'finalized'
            ) {
                clearInterval(intervalId);
                resolve(result);
            }
        } else if (tries >= maxTries) {
          clearInterval(intervalId);
          resolve(null); // or reject(new Error("Timeout"));
        }
      } catch (err) {
        clearInterval(intervalId);
        reject(err);
      }
    }, intervalMs);
  });
}
function extractCommitmentFromConfig(commitmentOrConfig) {
  let commitment;
  let config;
  if (typeof commitmentOrConfig === 'string') {
    commitment = commitmentOrConfig;
  } else if (commitmentOrConfig) {
    const {
      commitment: specifiedCommitment,
      ...specifiedConfig
    } = commitmentOrConfig;
    commitment = specifiedCommitment;
    config = specifiedConfig;
  }
  return {
    commitment,
    config
  }
}
function buildArgs(args, override, encoding, extra) {
    const commitment = override;
    if (commitment || encoding || extra) {
      let options = {};
      if (encoding) {
        options.encoding = encoding;
      }
      if (commitment) {
        options.commitment = commitment;
      }
      if (extra) {
        options = Object.assign(options, extra);
      }
      args.push(options);
    }
    return args;
}


/**
 * Get Commitment Confirmation
 */
export async function GetCommitmentSignature(transactionSignature: TransactionSignature, transaction: Transaction, ephemeralConnection: Connection): Promise<TransactionSignature> {
    const txSchedulingSgn = await ephemeralConnection.getTransaction(transactionSignature, { maxSupportedTransactionVersion: 0 });
    if (txSchedulingSgn?.meta == null) {
        throw new Error("Transaction not found or meta is null");
    }
    const scheduledCommitSgn = parseScheduleCommitsLogsMessage(txSchedulingSgn.meta.logMessages ?? []);
    if (scheduledCommitSgn == null) {
        throw new Error("ScheduledCommitSent signature not found");
    }
    const latestBlockhash = await getLatestBlockhashForMagicTransaction(ephemeralConnection, transaction)
    await confirmMagicTransaction(ephemeralConnection, { signature: scheduledCommitSgn, ...latestBlockhash })

    const txCommitInfo = await ephemeralConnection.getTransaction(scheduledCommitSgn, { maxSupportedTransactionVersion: 0 });
    if (txCommitInfo?.meta == null) {
        throw new Error("Transaction not found or meta is null");
    }
    const commitSignature = parseCommitsLogsMessage(txCommitInfo.meta.logMessages ?? []);
    if (commitSignature == null) {
        throw new Error("Unable to find Commitment signature");
    }
    return commitSignature;
}
function parseScheduleCommitsLogsMessage(logMessages) {
    for (const message of logMessages) {
        const signaturePrefix = "ScheduledCommitSent signature: ";
        if (message.includes(signaturePrefix)) {
            return message.split(signaturePrefix)[1];
        }
    }
    return null;
}
function parseCommitsLogsMessage(logMessages) {
    for (const message of logMessages) {
        const signaturePrefix = "ScheduledCommitSent signature[0]: ";
        if (message.includes(signaturePrefix)) {
            return message.split(signaturePrefix)[1];
        }
    }
    return null;
}