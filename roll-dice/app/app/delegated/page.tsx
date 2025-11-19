"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Dice from "@/components/dice"
import SolanaAddress from "@/components/solana-address"
// @ts-ignore
import * as anchor from "@coral-xyz/anchor"
// @ts-ignore
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js"
import { createDelegateInstruction, DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk"
import { useToast } from "@/hooks/use-toast"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PROGRAM_ID = new PublicKey("5bPwgoPWz274NKgThcnPas2Mv4rSknu9JrbxzFVqU5gY")
const PLAYER_SEED = "playerd"
const ORACLE_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc")
const BASE_ENDPOINT = "https://rpc.magicblock.app/devnet"
const PLAYER_STORAGE_KEY = "solanaKeypair"
const PAYER_STORAGE_KEY = "delegatePayerKeypair"

const walletAdapterFrom = (keypair: Keypair) => ({
  publicKey: keypair.publicKey,
  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    // @ts-ignore - Transaction and VersionedTransaction have different sign signatures
    transaction.sign(keypair)
    return transaction
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    // @ts-ignore - Transaction and VersionedTransaction have different sign signatures
    transactions.forEach(tx => tx.sign(keypair))
    return transactions
  },
})

const derivePlayerPda = (user: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(PLAYER_SEED), user.toBuffer()], PROGRAM_ID)[0]

type RollEntry = {
  value: number | null
  startTime: number
  endTime: number | null
  isPending: boolean
}

export default function DiceRollerDelegated() {
  const [diceValue, setDiceValue] = useState(1)
  const [isRolling, setIsRolling] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isDelegated, setIsDelegated] = useState(false)
  const [isDelegating, setIsDelegating] = useState(false)
  const [rollHistory, setRollHistory] = useState<RollEntry[]>([])
  const previousDiceValueRef = useRef<number>(1)
  const previousRollnumRef = useRef<number>(0)
  const expectingRollResultRef = useRef<boolean>(false)
  const programRef = useRef<anchor.Program | null>(null)
  const ephemeralProgramRef = useRef<anchor.Program | null>(null)
  const connectionRef = useRef<Connection | null>(null)
  const ephemeralConnectionRef = useRef<Connection | null>(null)
  const playerPdaRef = useRef<PublicKey | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const blockhashIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const playerKeypairRef = useRef<Keypair | null>(null)
  const payerKeypairRef = useRef<Keypair | null>(null)
  const cachedBaseBlockhashRef = useRef<{ blockhash: string; lastValidBlockHeight: number; timestamp: number } | null>(null)
  const cachedEphemeralBlockhashRef = useRef<{ blockhash: string; lastValidBlockHeight: number; timestamp: number } | null>(null)
  const { toast } = useToast()

  const clearAllIntervals = useCallback(() => {
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current)
      rollIntervalRef.current = null
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (blockhashIntervalRef.current) {
      clearInterval(blockhashIntervalRef.current)
      blockhashIntervalRef.current = null
    }
  }, [])


  const ensureFunds = useCallback(async (connection: Connection, keypair: Keypair) => {
    const balance = await connection.getBalance(keypair.publicKey)
    if (balance < 0.05 * LAMPORTS_PER_SOL) {
      const signature = await connection.requestAirdrop(keypair.publicKey, LAMPORTS_PER_SOL)
      await connection.confirmTransaction(signature, "confirmed")
    }
  }, [])

  const fetchAndCacheBlockhash = useCallback(async (connection: Connection, isEphemeral: boolean) => {
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      const cached = {
        blockhash,
        lastValidBlockHeight,
        timestamp: Date.now(),
      }
      if (isEphemeral) {
        cachedEphemeralBlockhashRef.current = cached
      } else {
        cachedBaseBlockhashRef.current = cached
      }
    } catch (error) {
      console.error("Failed to fetch blockhash:", error)
    }
  }, [])

  const getCachedBlockhash = useCallback((connection: Connection, isEphemeral: boolean): string | null => {
    const cached = isEphemeral ? cachedEphemeralBlockhashRef.current : cachedBaseBlockhashRef.current
    if (!cached) return null
    
    const age = Date.now() - cached.timestamp
    if (age > 30000) {
      fetchAndCacheBlockhash(connection, isEphemeral)
    }
    
    return cached.blockhash
  }, [fetchAndCacheBlockhash])

  const sendTransaction = useCallback(
    async (connection: Connection, transaction: Transaction, feePayer: Keypair, signers: Keypair[], isEphemeral: boolean = false) => {
      let blockhash: string
      const cached = getCachedBlockhash(connection, isEphemeral)
      if (cached) {
        blockhash = cached
      } else {
        const result = await connection.getLatestBlockhash()
        blockhash = result.blockhash
        fetchAndCacheBlockhash(connection, isEphemeral)
      }
      
      transaction.recentBlockhash = blockhash
      transaction.feePayer = feePayer.publicKey

      const signerMap = new Map<string, Keypair>()
      signerMap.set(feePayer.publicKey.toBase58(), feePayer)
      for (const signer of signers) {
        signerMap.set(signer.publicKey.toBase58(), signer)
      }

      signerMap.forEach(signer => transaction.partialSign(signer))

      const signature = await connection.sendRawTransaction(transaction.serialize())
      return signature
    },
    [getCachedBlockhash, fetchAndCacheBlockhash]
  )

  const refreshDelegationStatus = useCallback(async () => {
    if (!connectionRef.current || !playerKeypairRef.current) return false
    const accountInfo = await connectionRef.current.getAccountInfo(playerKeypairRef.current.publicKey)
    const delegated = !!accountInfo && accountInfo.owner.equals(DELEGATION_PROGRAM_ID)
    setIsDelegated(delegated)
    return delegated
  }, [])

  const loadOrCreateKeypair = useCallback((storageKey: string) => {
    if (typeof window === "undefined") return Keypair.generate()
    const stored = window.localStorage.getItem(storageKey)
    if (stored) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)))
    }
    const generated = Keypair.generate()
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(generated.secretKey)))
    return generated
  }, [])

  const initializeProgram = useCallback(async () => {
    if (typeof window === "undefined") return
    try {
      const connection = new Connection(BASE_ENDPOINT, "confirmed")
      connectionRef.current = connection

      if (!playerKeypairRef.current) {
        playerKeypairRef.current = loadOrCreateKeypair(PLAYER_STORAGE_KEY)
      }
      if (!payerKeypairRef.current) {
        payerKeypairRef.current = loadOrCreateKeypair(PAYER_STORAGE_KEY)
      }

      await ensureFunds(connection, playerKeypairRef.current)
      await ensureFunds(connection, payerKeypairRef.current)

      const provider = new anchor.AnchorProvider(
        connection,
        walletAdapterFrom(playerKeypairRef.current),
        anchor.AnchorProvider.defaultOptions()
      )

      const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
      if (!idl) throw new Error("IDL not found")

      const program = new anchor.Program(idl, provider)
      programRef.current = program

      const playerPk = derivePlayerPda(playerKeypairRef.current.publicKey)
      playerPdaRef.current = playerPk

      let account = await connection.getAccountInfo(playerPk)
      if (!account) {
        await program.methods.initialize().rpc()
        account = await connection.getAccountInfo(playerPk)
      }
      if (account) {
        try {
          const player = program.coder.accounts.decode("player", account.data)
          const initialValue = player.lastResult || 1
          const initialRollnum = player.rollnum || 0
          setDiceValue(initialValue)
          previousDiceValueRef.current = initialValue
          previousRollnumRef.current = Number(initialRollnum)
        } catch (error) {
          console.error("Failed to decode player on init:", error)
        }
      }

      const ephemeralEndpoint = process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app"
      const ephemeralWsEndpoint = process.env.NEXT_PUBLIC_EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app"
      const ephemeralConnection = new Connection(ephemeralEndpoint, {
        wsEndpoint: ephemeralWsEndpoint,
        commitment: "processed",
      })
      ephemeralConnectionRef.current = ephemeralConnection
      const ephemeralProvider = new anchor.AnchorProvider(
        ephemeralConnection,
        walletAdapterFrom(playerKeypairRef.current),
        anchor.AnchorProvider.defaultOptions()
      )
      ephemeralProgramRef.current = new anchor.Program(idl, ephemeralProvider)

      if (subscriptionIdRef.current !== null && ephemeralConnection) {
        await ephemeralConnection.removeAccountChangeListener(subscriptionIdRef.current).catch(console.error)
      }
      if (ephemeralConnection && playerPk) {
        subscriptionIdRef.current = ephemeralConnection.onAccountChange(
          playerPk,
          (accountInfo) => {
            if (!ephemeralProgramRef.current || !accountInfo || !accountInfo.data) return
            
            try {
              const player = ephemeralProgramRef.current.coder.accounts.decode("player", accountInfo.data)
              const newValue = Number(player.lastResult)
              const newRollnum = Number(player.rollnum || 0)
              const previousRollnum = previousRollnumRef.current
              
              if (newValue > 0) {
                setDiceValue(newValue)
                previousDiceValueRef.current = newValue
              }
              
              if (newRollnum > previousRollnum && expectingRollResultRef.current) {
                previousRollnumRef.current = newRollnum
                const endTime = Date.now()
                setRollHistory(prev => {
                  const updated = [...prev]
                  const pendingIndex = updated.findIndex(entry => entry.isPending)
                  if (pendingIndex !== -1) {
                    updated[pendingIndex] = {
                      value: newValue,
                      startTime: updated[pendingIndex].startTime,
                      endTime,
                      isPending: false,
                    }
                  }
                  return updated
                })
                expectingRollResultRef.current = false
                setIsRolling(false)
                clearAllIntervals()
              }
            } catch (error) {
              console.error("Failed to decode player account:", error)
            }
          },
          { commitment: "processed" }
        )
      }

      await refreshDelegationStatus()
      
      await fetchAndCacheBlockhash(connection, false)
      if (ephemeralConnection) {
        await fetchAndCacheBlockhash(ephemeralConnection, true)
      }
      
      blockhashIntervalRef.current = setInterval(() => {
        if (connectionRef.current) {
          fetchAndCacheBlockhash(connectionRef.current, false)
        }
        if (ephemeralConnectionRef.current) {
          fetchAndCacheBlockhash(ephemeralConnectionRef.current, true)
        }
      }, 20000)
      
      setIsInitialized(true)
    } catch (error) {
      console.error("Failed to initialize delegated dice:", error)
      setIsInitialized(false)
      toast({
        title: "Error",
        description: "Failed to initialize delegated dice",
        variant: "destructive",
      })
    }
  }, [ensureFunds, loadOrCreateKeypair, refreshDelegationStatus, toast, fetchAndCacheBlockhash])

  useEffect(() => {
    initializeProgram()

    return () => {
      clearAllIntervals()
      if (subscriptionIdRef.current !== null && ephemeralConnectionRef.current) {
        ephemeralConnectionRef.current.removeAccountChangeListener(subscriptionIdRef.current).catch(console.error)
        subscriptionIdRef.current = null
      }
    }
  }, [clearAllIntervals, initializeProgram])

  const handleDelegate = useCallback(async () => {
    if (
      !programRef.current ||
      !connectionRef.current ||
      !playerKeypairRef.current ||
      !payerKeypairRef.current ||
      !playerPdaRef.current
    )
      return
    if (isDelegated) return

    setIsDelegating(true)
    try {
      const connection = connectionRef.current
      const playerKeypair = playerKeypairRef.current
      const payerKeypair = payerKeypairRef.current

      await ensureFunds(connection, playerKeypair)
      await ensureFunds(connection, payerKeypair)

      await programRef.current.methods
        .delegate()
        .accounts({
          user: playerKeypair.publicKey,
          player: playerPdaRef.current,
        })
        .rpc()

      const ownerInfo = await connection.getAccountInfo(playerKeypair.publicKey)
      if (!ownerInfo || !ownerInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
        const assignIx = SystemProgram.assign({
          accountPubkey: playerKeypair.publicKey,
          programId: DELEGATION_PROGRAM_ID,
        })
        await sendTransaction(connection, new Transaction().add(assignIx), payerKeypair, [playerKeypair], false)
      }

      const delegateIx = createDelegateInstruction({
        payer: payerKeypair.publicKey,
        delegatedAccount: playerKeypair.publicKey,
        ownerProgram: SystemProgram.programId,
      })
      await sendTransaction(connection, new Transaction().add(delegateIx), payerKeypair, [playerKeypair], false)

      await refreshDelegationStatus()
      toast({
        title: "Delegated",
        description: "Account delegated successfully",
      })
    } catch (error) {
      console.error("Delegation failed:", error)
      toast({
        title: "Error",
        description: "Failed to delegate account",
        variant: "destructive",
      })
    } finally {
      setIsDelegating(false)
    }
  }, [ensureFunds, isDelegated, refreshDelegationStatus, sendTransaction, toast])

  const handleRollDice = useCallback(async () => {
    if (isRolling || !isInitialized || !isDelegated) return
    if (!ephemeralProgramRef.current || !playerKeypairRef.current || !playerPdaRef.current) return

    setIsRolling(true)
    expectingRollResultRef.current = true
    clearAllIntervals()

    rollIntervalRef.current = setInterval(() => {
      setDiceValue(Math.floor(Math.random() * 6) + 1)
    }, 100)

    setRollHistory(prev => {
      const newEntry = {
        value: null,
        startTime: Date.now(),
        endTime: null,
        isPending: true,
      }
      return [newEntry, ...prev]
    })

    timerIntervalRef.current = setInterval(() => {
      setRollHistory(prev => [...prev])
    }, 1)

    timeoutRef.current = setTimeout(() => {
      if (expectingRollResultRef.current) {
        clearAllIntervals()
        expectingRollResultRef.current = false
        setIsRolling(false)
        setRollHistory(prev => {
          const updated = [...prev]
          const pendingIndex = updated.findIndex(entry => entry.isPending)
          if (pendingIndex !== -1) {
            updated[pendingIndex] = {
              ...updated[pendingIndex],
              isPending: false,
            }
          }
          return updated
        })
        toast({
          title: "Notice",
          description: "Dice roll is taking longer than expected. Check explorer.",
          variant: "destructive",
        })
      }
    }, 10000)

    try {
      const randomValue = Math.floor(Math.random() * 6) + 1

      const tx = await ephemeralProgramRef.current.methods
        .rollDiceDelegated(randomValue)
        .accounts({
          payer: playerKeypairRef.current.publicKey,
          player: playerPdaRef.current,
          oracleQueue: ORACLE_QUEUE,
        })
        .transaction()

      const cachedBlockhash = getCachedBlockhash(ephemeralConnectionRef.current!, true)
      if (cachedBlockhash) {
        tx.recentBlockhash = cachedBlockhash
      } else {
        const { blockhash } = await ephemeralConnectionRef.current!.getLatestBlockhash()
        tx.recentBlockhash = blockhash
      }
      
      tx.feePayer = playerKeypairRef.current.publicKey
      tx.sign(playerKeypairRef.current)

      const signature = await ephemeralConnectionRef.current!.sendRawTransaction(
        tx.serialize(),
        { skipPreflight: true }
      )

      const startTime = Date.now()
      setRollHistory(prev => {
        const updated = [...prev]
        const pendingIndex = updated.findIndex(entry => entry.isPending && entry.value === null)
        if (pendingIndex !== -1) {
          updated[pendingIndex] = {
            ...updated[pendingIndex],
            startTime,
          }
        }
        return updated
      })

      toast({
        title: "Dice Rolled",
        description: `Result: TX: ${signature.slice(0, 8)}...`,
      })

      if (ephemeralConnectionRef.current) {
        fetchAndCacheBlockhash(ephemeralConnectionRef.current, true)
      }
    } catch (error) {
      clearAllIntervals()
      console.error("Error rolling dice:", error)
      toast({
        title: "Error",
        description: "Failed to roll dice",
        variant: "destructive",
      })
      setIsRolling(false)
      expectingRollResultRef.current = false
      setRollHistory(prev => {
        const updated = [...prev]
        const pendingIndex = updated.findIndex(entry => entry.isPending)
        if (pendingIndex !== -1) {
          updated.splice(pendingIndex, 1)
        }
        return updated
      })
    }
  }, [clearAllIntervals, isDelegated, isInitialized, isRolling, toast, getCachedBlockhash, fetchAndCacheBlockhash])

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <div className="absolute top-4 right-4 z-10">
        <SolanaAddress />
      </div>

      <div className="flex flex-row gap-8 px-8 py-8 flex-grow">
        <div className="flex flex-col items-center justify-center flex-1">

          <div className="flex items-center gap-4 mb-6">
            <span className={`text-sm font-medium ${isDelegated ? "text-green-600" : "text-amber-600"}`}>
              {isDelegated ? "Delegated" : "Undelegated"}
            </span>
            {!isDelegated && (
              <button
                onClick={handleDelegate}
                disabled={!isInitialized || isDelegating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium shadow hover:bg-blue-700 disabled:opacity-50"
              >
                {isDelegating ? "Delegating..." : "Delegate"}
              </button>
            )}
          </div>

          <div className="mb-8">
            <Dice value={diceValue} isRolling={isRolling} onClick={handleRollDice} />
          </div>

          <button
            onClick={handleRollDice}
            disabled={isRolling || !isInitialized || !isDelegated}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isRolling ? "Rolling..." : !isInitialized ? "Initializing..." : !isDelegated ? "Delegate First" : "Roll Dice"}
          </button>
        </div>

        <div className="flex flex-col w-96">
          <h2 className="text-xl font-bold mb-4">Roll History</h2>
          <div className="bg-white rounded-lg shadow border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                      No rolls yet
                    </TableCell>
                  </TableRow>
                ) : (
                  rollHistory.map((entry, index) => {
                    const elapsed = entry.isPending
                      ? Date.now() - entry.startTime
                      : entry.endTime
                        ? entry.endTime - entry.startTime
                        : 0
                    return (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          {entry.value !== null ? entry.value : "-"}
                        </TableCell>
                        <TableCell className={entry.isPending ? "text-blue-600 font-medium" : ""}>
                          {entry.isPending ? `${elapsed}ms...` : `${elapsed}ms`}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  )
}
