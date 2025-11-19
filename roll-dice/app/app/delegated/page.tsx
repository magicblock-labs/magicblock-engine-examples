"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as anchor from "@coral-xyz/anchor"
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js"
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk"
import { createDelegateInstruction } from "@/lib/delegate-instruction"
import Dice from "@/components/dice"
import SolanaAddress from "@/components/solana-address"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  PROGRAM_ID,
  PLAYER_SEED,
  ORACLE_QUEUE,
  BASE_ENDPOINT,
  PLAYER_STORAGE_KEY,
  PAYER_STORAGE_KEY,
  BLOCKHASH_REFRESH_INTERVAL_MS,
  ROLL_TIMEOUT_MS,
  ROLL_ANIMATION_INTERVAL_MS,
} from "@/lib/config"
import {
  walletAdapterFrom,
  loadOrCreateKeypair,
  ensureFunds,
  fetchAndCacheBlockhash,
  getCachedBlockhash,
  checkDelegationStatus,
} from "@/lib/solana-utils"
import type { RollEntry, CachedBlockhash } from "@/lib/types"

const derivePlayerPda = (user: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(PLAYER_SEED), user.toBuffer()], PROGRAM_ID)[0]

const MiniDice = ({ value }: { value: number | null }) => {
  if (value === null) return <span className="text-muted-foreground">-</span>
  
  const safeValue = Math.min(Math.max(1, value), 6)
  const dotSize = "w-1.5 h-1.5"
  
  return (
    <div className="w-8 h-8 bg-white rounded border shadow-sm flex items-center justify-center">
      <div className="relative w-full h-full p-1">
        {safeValue === 1 && (
          <div className="grid place-items-center h-full w-full">
            <div className={`${dotSize} bg-black rounded-full`} />
          </div>
        )}
        {safeValue === 2 && (
          <div className="grid grid-cols-2 h-full w-full gap-0.5">
            <div className="flex justify-start items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-end items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
          </div>
        )}
        {safeValue === 3 && (
          <div className="grid grid-cols-3 grid-rows-3 h-full w-full gap-0.5">
            <div className="col-start-1 row-start-1 flex justify-start items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="col-start-2 row-start-2 flex justify-center items-center">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="col-start-3 row-start-3 flex justify-end items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
          </div>
        )}
        {safeValue === 4 && (
          <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-0.5">
            <div className="flex justify-start items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-end items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-start items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-end items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
          </div>
        )}
        {safeValue === 5 && (
          <div className="grid grid-cols-3 grid-rows-3 h-full w-full gap-0.5">
            <div className="col-start-1 row-start-1 flex justify-start items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="col-start-3 row-start-1 flex justify-end items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="col-start-2 row-start-2 flex justify-center items-center">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="col-start-1 row-start-3 flex justify-start items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="col-start-3 row-start-3 flex justify-end items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
          </div>
        )}
        {safeValue === 6 && (
          <div className="grid grid-cols-2 grid-rows-3 h-full w-full gap-0.5">
            <div className="flex justify-start items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-end items-start">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-start items-center">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-end items-center">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-start items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
            <div className="flex justify-end items-end">
              <div className={`${dotSize} bg-black rounded-full`} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DiceRollerDelegated() {
  const [diceValue, setDiceValue] = useState(1)
  const [isRolling, setIsRolling] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isDelegated, setIsDelegated] = useState(false)
  const [isDelegating, setIsDelegating] = useState(false)
  const [rollHistory, setRollHistory] = useState<RollEntry[]>([])
  const [timerTick, setTimerTick] = useState(0)
  
  const previousDiceValueRef = useRef<number>(1)
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
  const cachedBaseBlockhashRef = useRef<CachedBlockhash | null>(null)
  const cachedEphemeralBlockhashRef = useRef<CachedBlockhash | null>(null)

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


  const fetchBlockhash = useCallback(async (connection: Connection, isEphemeral: boolean) => {
    const cacheRef = isEphemeral ? cachedEphemeralBlockhashRef : cachedBaseBlockhashRef
    await fetchAndCacheBlockhash(connection, cacheRef)
  }, [])

  const getBlockhash = useCallback((connection: Connection, isEphemeral: boolean): string | null => {
    const cacheRef = isEphemeral ? cachedEphemeralBlockhashRef : cachedBaseBlockhashRef
    return getCachedBlockhash(connection, cacheRef)
  }, [])

  const sendTransaction = useCallback(
    async (connection: Connection, transaction: Transaction, feePayer: Keypair, signers: Keypair[], isEphemeral: boolean = false) => {
      let blockhash: string
      const cached = getBlockhash(connection, isEphemeral)
      if (cached) {
        blockhash = cached
      } else {
        const result = await connection.getLatestBlockhash()
        blockhash = result.blockhash
        await fetchBlockhash(connection, isEphemeral)
      }
      
      transaction.recentBlockhash = blockhash
      transaction.feePayer = feePayer.publicKey

      const signerMap = new Map<string, Keypair>()
      signerMap.set(feePayer.publicKey.toBase58(), feePayer)
      for (const signer of signers) {
        signerMap.set(signer.publicKey.toBase58(), signer)
      }

      signerMap.forEach(signer => transaction.partialSign(signer))

      return await connection.sendRawTransaction(transaction.serialize())
    },
    [getBlockhash, fetchBlockhash]
  )

  const refreshDelegationStatus = useCallback(async () => {
    if (!connectionRef.current || !playerKeypairRef.current) return false
    const delegated = await checkDelegationStatus(connectionRef.current, playerKeypairRef.current.publicKey)
    setIsDelegated(delegated)
    return delegated
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
          setDiceValue(initialValue)
          previousDiceValueRef.current = initialValue
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
            console.log("[WebSocket] Account change received", { hasData: !!accountInfo?.data })
            if (!ephemeralProgramRef.current || !accountInfo || !accountInfo.data) return
            
            try {
              const player = ephemeralProgramRef.current.coder.accounts.decode("player", accountInfo.data)
              const newValue = Number(player.lastResult)
              
              console.log("[WebSocket] Decoded player:", {
                newValue
              })
              
              if (newValue > 0) {
                setDiceValue(newValue)
                previousDiceValueRef.current = newValue
              }
              
              setRollHistory(prev => {
                const pendingIndex = prev.findIndex(entry => entry.isPending)
                if (pendingIndex !== -1) {
                  console.log("[WebSocket] Processing roll completion")
                  const endTime = Date.now()
                  const updated = [...prev]
                  updated[pendingIndex] = {
                    value: newValue,
                    startTime: updated[pendingIndex].startTime,
                    endTime,
                    isPending: false,
                  }
                  setIsRolling(false)
                  clearAllIntervals()
                  console.log("[WebSocket] Roll completion processed")
                  return updated
                } else {
                  console.log("[WebSocket] Received update but no pending entry found")
                  return prev
                }
              })
            } catch (error) {
              console.error("[WebSocket] Failed to decode player account:", error)
            }
          },
          { commitment: "processed" }
        )
      }

      await refreshDelegationStatus()
      
      await fetchBlockhash(connection, false)
      if (ephemeralConnection) {
        await fetchBlockhash(ephemeralConnection, true)
      }
      
      blockhashIntervalRef.current = setInterval(() => {
        if (connectionRef.current) {
          fetchBlockhash(connectionRef.current, false)
        }
        if (ephemeralConnectionRef.current) {
          fetchBlockhash(ephemeralConnectionRef.current, true)
        }
      }, BLOCKHASH_REFRESH_INTERVAL_MS)
      
      setIsInitialized(true)
    } catch (error) {
      console.error("Failed to initialize delegated dice:", error)
      setIsInitialized(false)
    }
    }, [refreshDelegationStatus, fetchBlockhash])

  useEffect(() => {
    initializeProgram()

    return () => {
      clearAllIntervals()
      // Clean up subscription
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

      await new Promise(resolve => setTimeout(resolve, 3000))

      const delegateIx = createDelegateInstruction({
        payer: payerKeypair.publicKey,
        delegatedAccount: playerKeypair.publicKey,
        ownerProgram: SystemProgram.programId,
      })
      await sendTransaction(connection, new Transaction().add(delegateIx), payerKeypair, [playerKeypair], false)

      await refreshDelegationStatus()
    } catch (error) {
      console.error("Delegation failed:", error)
    } finally {
      setIsDelegating(false)
    }
  }, [ensureFunds, isDelegated, refreshDelegationStatus, sendTransaction])

  const handleRollDice = useCallback(async () => {
    if (isRolling || !isInitialized || !isDelegated) return
    if (!ephemeralProgramRef.current || !playerKeypairRef.current || !playerPdaRef.current) return

    console.log("[RollDice] Starting roll")
    setIsRolling(true)
    clearAllIntervals()

    rollIntervalRef.current = setInterval(() => {
      setDiceValue(Math.floor(Math.random() * 6) + 1)
    }, ROLL_ANIMATION_INTERVAL_MS)

    // Create pending roll history entry (startTime will be set when transaction is sent)
    setRollHistory(prev => {
      const newEntry = {
        value: null,
        startTime: Date.now(), // Temporary placeholder
        endTime: null,
        isPending: true,
      }
      return [newEntry, ...prev]
    })

    timerIntervalRef.current = setInterval(() => {
      setRollHistory(prev => {
        const hasPending = prev.some(entry => entry.isPending)
        if (!hasPending) {
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current)
            timerIntervalRef.current = null
          }
          return prev
        }
        setTimerTick(t => t + 1)
        return prev
      })
    }, 10)

    timeoutRef.current = setTimeout(() => {
      setRollHistory(prev => {
        const hasPending = prev.some(entry => entry.isPending)
        if (hasPending) {
          clearAllIntervals()
          setIsRolling(false)
          const updated = [...prev]
          const pendingIndex = updated.findIndex(entry => entry.isPending)
          if (pendingIndex !== -1) {
            updated[pendingIndex] = {
              ...updated[pendingIndex],
              isPending: false,
            }
          }
          return updated
        }
        return prev
      })
    }, ROLL_TIMEOUT_MS)

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

      const cachedBlockhash = getBlockhash(ephemeralConnectionRef.current!, true)
      if (cachedBlockhash) {
        tx.recentBlockhash = cachedBlockhash
      } else {
        const { blockhash } = await ephemeralConnectionRef.current!.getLatestBlockhash()
        tx.recentBlockhash = blockhash
      }
      
      tx.feePayer = playerKeypairRef.current.publicKey
      tx.sign(playerKeypairRef.current)

      const serializedTx = tx.serialize()
      const transactionStartTime = Date.now()
      console.log("[RollDice] Sending transaction")
      ephemeralConnectionRef.current!.sendRawTransaction(
        serializedTx,
        { skipPreflight: true }
      )
      console.log("[RollDice] Transaction sent, waiting for websocket update")
      
      setRollHistory(prev => {
        const updated = [...prev]
        const pendingIndex = updated.findIndex(entry => entry.isPending && entry.value === null)
        if (pendingIndex !== -1) {
          updated[pendingIndex] = {
            ...updated[pendingIndex],
            startTime: transactionStartTime,
          }
        }
        return updated
      })
      

      if (ephemeralConnectionRef.current) {
        await fetchBlockhash(ephemeralConnectionRef.current, true)
      }
    } catch (error) {
      clearAllIntervals()
      console.error("Error rolling dice:", error)
      setIsRolling(false)
      setRollHistory(prev => {
        const updated = [...prev]
        const pendingIndex = updated.findIndex(entry => entry.isPending)
        if (pendingIndex !== -1) {
          updated.splice(pendingIndex, 1)
        }
        return updated
      })
    }
  }, [clearAllIntervals, isDelegated, isInitialized, isRolling, getBlockhash, fetchBlockhash])

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <div className="absolute top-4 right-4 z-10">
        <SolanaAddress />
      </div>

      <div className="flex flex-col items-center justify-center px-8 py-8 flex-grow">
        <div className="flex flex-row items-start justify-center gap-16">
          <div className="flex flex-col items-center flex-shrink-0">
            <div className="flex items-center gap-4 mb-6">
              <Badge className={`px-4 py-1.5 text-sm ${isDelegated ? "bg-green-600 text-white border-green-600" : "bg-amber-600 text-white border-amber-600"}`}>
                {isDelegated ? "Delegated" : "Undelegated"}
              </Badge>
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

          <div className="flex flex-col w-96 ml-8 -mt-16 flex-shrink-0">
            <div className="bg-white rounded-lg shadow border overflow-hidden">
              <div className="h-[400px] overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead>Value</TableHead>
                      <TableHead className="text-right w-24">Time</TableHead>
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
                      rollHistory.slice(0, 10).map((entry, index) => {
                        const elapsed = entry.isPending
                          ? Date.now() - entry.startTime
                          : entry.endTime
                            ? entry.endTime - entry.startTime
                            : 0
                        const formattedTime = `${elapsed.toString().padStart(6, '\u00A0')}ms${entry.isPending ? '...' : ''}`
                        return (
                          <TableRow key={index}>
                            <TableCell>
                              <MiniDice value={entry.value} />
                            </TableCell>
                            <TableCell className={`text-right font-mono whitespace-pre ${entry.isPending ? "text-blue-600 font-medium" : ""}`}>
                              {formattedTime}
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
      </div>
    </div>
  )
}
