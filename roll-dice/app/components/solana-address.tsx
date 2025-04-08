"use client"

import { useState, useEffect } from "react"
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export default function SolanaAddress({ onBalanceChange }: { onBalanceChange?: (balance: number) => void }) {
  const [address, setAddress] = useState<string>("")
  const [balance, setBalance] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const getOrCreateAddress = async () => {
      try {
        let storedKeypair = localStorage.getItem("solanaKeypair")
        let keypair: Keypair

        if (storedKeypair) {
          const secretKey = Uint8Array.from(JSON.parse(storedKeypair))
          keypair = Keypair.fromSecretKey(secretKey)
        } else {
          keypair = Keypair.generate()
          localStorage.setItem("solanaKeypair", JSON.stringify(Array.from(keypair.secretKey)))
        }

        const publicKeyString = keypair.publicKey.toString()
        setAddress(publicKeyString)
        await fetchBalance(publicKeyString)
        setIsLoading(false)

        const intervalId = setInterval(() => {
          fetchBalance(publicKeyString)
        }, 10000)

        return () => clearInterval(intervalId)
      } catch (error) {
        console.error("Error getting/creating Solana address:", error)
        setIsLoading(false)
      }
    }

    const cleanup = getOrCreateAddress()
    return () => {
      if (cleanup && typeof cleanup === 'function') {
        // @ts-ignore
        cleanup()
      }
    }
  }, [])

  const fetchBalance = async (pubkeyString: string) => {
    try {
      const connection = new Connection("https://rpc.magicblock.app/devnet", "processed")
      const pubkey = new PublicKey(pubkeyString)
      const balanceInLamports = await connection.getBalance(pubkey)
      const balanceInSOL = balanceInLamports / LAMPORTS_PER_SOL
      if (balanceInSOL < 0.1){
        // Request airdrop of 0.1 SOL
        await connection.requestAirdrop(pubkey, 100000000 )
      }

      // Notify parent component about balance change
      if (onBalanceChange && (balance !== balanceInSOL)) {
        onBalanceChange(balanceInSOL)
      }

      setBalance(balanceInSOL)
      setLastUpdated(new Date())
    } catch (error) {
      console.error("Error fetching balance:", error)
      setBalance(null)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }

  const formatAddress = (addr: string) => {
    if (!addr) return ""
    return `${addr.substring(0, 4)}...${addr.substring(addr.length - 4)}`
  }

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading address...</div>
  }

  return (
      <div className="flex items-center space-x-2 bg-white/80 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm border">
        <div
            className="flex items-center cursor-pointer hover:bg-gray-100 rounded px-2 py-1 transition-colors"
            onClick={copyToClipboard}
        >
          <span className="text-sm font-mono mr-1">{formatAddress(address)}</span>
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-gray-400" />}
        </div>
        <div
            className={cn(
                "text-xs font-medium px-2 py-1 rounded",
                balance === null ? "bg-gray-100 text-gray-500" : "bg-primary/10 text-primary",
            )}
        >
          {balance === null ? "Balance: --" : `${balance.toFixed(4)} SOL`}
        </div>
      </div>
  )
}
