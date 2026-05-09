"use client";

import React, { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { useTransaction } from "@/hooks/useTransaction";
import { useGlobalTransactionHistory } from "@/hooks/useGlobalTransactionHistory";
import { getBaseLayerSolanaEndpoint, getDefaultSolanaEndpoint } from "@/lib/clusterContext";
import { requestDashboardDataRefresh } from "@/lib/refresh";
import { shortAddress } from "@/lib/utils";
import {
  fetchOwnedSplMintOptions,
  type OwnedSplMintOption,
} from "@/lib/tokenAccounts";
import { TransactionModal } from "./TransactionModal";

interface ActionForm {
  [key: string]: any;
}

interface TokenActionsProps {
  selectedDistributor?: PublicKey | null;
  externalOpen?: boolean;
  onExternalClose?: () => void;
}

export const TokenActions: React.FC<TokenActionsProps> = ({
  selectedDistributor,
  externalOpen,
  onExternalClose,
}) => {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { sendSplTokenToDistributor } = useTransaction({ selectedDistributor });
  const { addTransaction, updateTransaction } = useGlobalTransactionHistory();

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState({
    loading: false,
    error: null as string | null,
    signature: null as string | null,
    endpoint: undefined as string | undefined,
  });
  const [forms, setForms] = useState<ActionForm>({
    sendToken: {
      tokenMint: "",
      amount: 0,
    },
  });
  const [availableWalletMints, setAvailableWalletMints] = useState<OwnedSplMintOption[]>([]);
  const [loadingWalletMints, setLoadingWalletMints] = useState(false);
  const [walletMintFetchError, setWalletMintFetchError] = useState<string | null>(null);
  const [mintSymbols, setMintSymbols] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (externalOpen) {
      setActiveModal("sendToken");
    }
  }, [externalOpen]);

  useEffect(() => {
    let cancelled = false;

    const loadWalletMints = async () => {
      if (activeModal !== "sendToken" || !publicKey) {
        if (!cancelled) {
          setAvailableWalletMints([]);
          setLoadingWalletMints(false);
          setWalletMintFetchError(null);
        }
        return;
      }

      setLoadingWalletMints(true);
      setWalletMintFetchError(null);

      try {
        const mintFetchResult = await fetchOwnedSplMintOptions(
          connection,
          publicKey
        );
        if (!cancelled) {
          setAvailableWalletMints(mintFetchResult.options);
        }
      } catch (error) {
        console.error("[TokenActions] Failed to load wallet token mints:", error);
        if (!cancelled) {
          setAvailableWalletMints([]);
          setWalletMintFetchError(error instanceof Error ? error.message : "Unknown fetch error");
        }
      } finally {
        if (!cancelled) {
          setLoadingWalletMints(false);
        }
      }
    };

    void loadWalletMints();

    return () => {
      cancelled = true;
    };
  }, [activeModal, connection.rpcEndpoint, publicKey]);

  // Fetch Metaplex metadata symbols for wallet mints
  useEffect(() => {
    let cancelled = false;
    const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

    const fetchSymbols = async () => {
      const toFetch = availableWalletMints
        .map((opt) => opt.mint)
        .filter((m) => !mintSymbols.has(m));
      if (toFetch.length === 0) return;

      try {
        const readEndpoint = getBaseLayerSolanaEndpoint(connection.rpcEndpoint);
        const readConnection =
          readEndpoint === connection.rpcEndpoint
            ? connection
            : new Connection(readEndpoint, "confirmed");

        const mintKeys = toFetch.map((m) => new PublicKey(m));
        const metadataPdas = mintKeys.map(
          (mint) =>
            PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
              METADATA_PROGRAM_ID
            )[0]
        );

        const accounts = await readConnection.getMultipleAccountsInfo(metadataPdas);
        const newSymbols = new Map(mintSymbols);

        mintKeys.forEach((mint, index) => {
          const account = accounts[index];
          if (!account) return;
          try {
            const [metadata] = Metadata.deserialize(account.data);
            const symbol =
              typeof metadata.data.symbol === "string"
                ? metadata.data.symbol.replace(/\0/g, "").trim()
                : "";
            if (symbol) newSymbols.set(mint.toBase58(), symbol);
          } catch {
            // no metadata for this mint
          }
        });

        if (!cancelled) setMintSymbols(newSymbols);
      } catch (error) {
        console.error("[TokenActions] Failed to fetch mint metadata symbols:", error);
      }
    };

    void fetchSymbols();
    return () => { cancelled = true; };
  }, [availableWalletMints, connection.rpcEndpoint]);

  const handleClose = () => {
    setActiveModal(null);
    onExternalClose?.();
  };

  const handleSendToken = async () => {
    setLocalStatus({ loading: true, error: null, signature: null, endpoint: undefined });
    const config = forms.sendToken;
    const selectedMintOption = availableWalletMints.find(
      (option) => option.mint === config.tokenMint
    );
    const result = await sendSplTokenToDistributor(
      new PublicKey(config.tokenMint),
      config.amount,
      selectedMintOption?.decimals ?? 0
    );

    if ('signature' in result && result.signature) {
      const txId = addTransaction(
        result.signature,
        "Send SPL Token to Distributor",
        "devnet",
        result.endpoint || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || getDefaultSolanaEndpoint()
      );
      updateTransaction(txId, {
        status: result.success ? "confirmed" : "failed",
        error: result.error,
      });
      if (result.success) {
        requestDashboardDataRefresh();
      }
      setLocalStatus({ loading: false, error: null, signature: result.signature, endpoint: result.endpoint });
      setTimeout(() => {
        handleClose();
        setForms({
          ...forms,
          sendToken: { tokenMint: "", amount: 0 },
        });
        setLocalStatus({ loading: false, error: null, signature: null, endpoint: undefined });
      }, 2000);
    } else {
      setLocalStatus({ loading: false, error: result.error || "Unknown error", signature: null, endpoint: undefined });
    }
  };

  if (!publicKey) {
    return null;
  }

  return (
    <TransactionModal
      isOpen={activeModal === "sendToken"}
      title="Send SPL Token to Distributor"
      description="Transfer SPL tokens to the reward distributor"
      loading={localStatus.loading}
      error={localStatus.error}
      signature={localStatus.signature}
      endpoint={localStatus.endpoint}
      onClose={handleClose}
      onConfirm={handleSendToken}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-300 mb-1">Token Mint</label>
          {walletMintFetchError && (
            <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-300">
              Fetch error: {walletMintFetchError}
            </div>
          )}
          <select
            value={forms.sendToken.tokenMint}
            onChange={(e) => {
              const selectedOption = availableWalletMints.find(
                (option) => option.mint === e.target.value
              );
              setForms({
                ...forms,
                sendToken: {
                  ...forms.sendToken,
                  tokenMint: e.target.value,
                  amount: selectedOption
                    ? parseFloat(selectedOption.balanceLabel) || 0
                    : forms.sendToken.amount,
                },
              });
            }}
            disabled={localStatus.loading || loadingWalletMints || availableWalletMints.length === 0}
            className="mt-2 w-full rounded border border-gray-600 bg-gray-700 p-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">
              {availableWalletMints.length > 0 ? "Select wallet mint" : "No wallet token accounts found"}
            </option>
            {availableWalletMints.map((option) => (
              <option key={option.tokenAccount} value={option.mint}>
                {shortAddress(option.mint, 5)}{mintSymbols.get(option.mint) ? ` (${mintSymbols.get(option.mint)})` : ""} ({option.balanceLabel})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">Amount</label>
          <input
            type="number"
            value={forms.sendToken.amount}
            onChange={(e) =>
              setForms({
                ...forms,
                sendToken: { ...forms.sendToken, amount: parseFloat(e.target.value) },
              })
            }
            placeholder="0"
            disabled={localStatus.loading}
            className="w-full p-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50 text-sm"
          />
        </div>
      </div>
    </TransactionModal>
  );
};
