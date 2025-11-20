"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as anchor from "@coral-xyz/anchor"
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js"
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Copy, Check } from "lucide-react"
import {
  PROGRAM_ID,
  PLAYER_SEED,
  ORACLE_QUEUE,
  BASE_ENDPOINT,
  PLAYER_STORAGE_KEY,
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
  const [isUndelegating, setIsUndelegating] = useState(false)
  const [rollHistory, setRollHistory] = useState<RollEntry[]>([])
  const [timerTick, setTimerTick] = useState(0)
  const [playerAccountData, setPlayerAccountData] = useState<{ lastResult: number; rollnum: number } | null>(null)
  const [playerPda, setPlayerPda] = useState<PublicKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [ephemeralEndpoint, setEphemeralEndpoint] = useState<string | null>(null)
  
  const previousDiceValueRef = useRef<number>(1)
  const programRef = useRef<anchor.Program | null>(null)
  const ephemeralProgramRef = useRef<anchor.Program | null>(null)
  const connectionRef = useRef<Connection | null>(null)
  const ephemeralConnectionRef = useRef<Connection | null>(null)
  const routerConnectionRef = useRef<ConnectionMagicRouter | null>(null)
  const playerPdaRef = useRef<PublicKey | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const blockhashIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const delegationPollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const playerKeypairRef = useRef<Keypair | null>(null)
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
    // Note: blockhashIntervalRef is NOT cleared here - it should run continuously
    if (delegationPollIntervalRef.current) {
      clearInterval(delegationPollIntervalRef.current)
      delegationPollIntervalRef.current = null
    }
  }, [])


  const getBlockhashAsync = useCallback(async (connection: Connection, isEphemeral: boolean): Promise<string> => {
    const cacheRef = isEphemeral ? cachedEphemeralBlockhashRef : cachedBaseBlockhashRef
    const cached = getCachedBlockhash(connection, cacheRef)
    if (cached) return cached
    const { blockhash } = await connection.getLatestBlockhash()
    return blockhash
  }, [])

  const refreshDelegationStatus = useCallback(async () => {
    if (!connectionRef.current || !playerPdaRef.current) return false
    const delegated = await checkDelegationStatus(connectionRef.current, playerPdaRef.current)
    setIsDelegated(delegated)
    return delegated
  }, [])

  const updateEphemeralConnectionToValidator = useCallback(async (validatorFqdn: string) => {
    if (!playerKeypairRef.current || !playerPdaRef.current || !programRef.current) return

    // Convert https:// to wss:// for WebSocket endpoint
    const ephemeralWsEndpoint = validatorFqdn.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
    const newEphemeralConnection = new Connection(validatorFqdn, {
      wsEndpoint: ephemeralWsEndpoint,
      commitment: "processed",
    })
    
    // Clean up old subscription
    if (subscriptionIdRef.current !== null && ephemeralConnectionRef.current) {
      await ephemeralConnectionRef.current.removeAccountChangeListener(subscriptionIdRef.current).catch(console.error)
    }
    
    ephemeralConnectionRef.current = newEphemeralConnection
    setEphemeralEndpoint(validatorFqdn)
    
    // Recreate ephemeral program with new connection
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID, programRef.current.provider)
    if (!idl) throw new Error("IDL not found")
    
    const ephemeralProvider = new anchor.AnchorProvider(
      newEphemeralConnection,
      walletAdapterFrom(playerKeypairRef.current),
      anchor.AnchorProvider.defaultOptions()
    )
    ephemeralProgramRef.current = new anchor.Program(idl, ephemeralProvider)
    
    // Recreate subscription with new connection
    subscriptionIdRef.current = newEphemeralConnection.onAccountChange(
      playerPdaRef.current,
      (accountInfo) => {
        if (!ephemeralProgramRef.current || !accountInfo?.data) return
        try {
          const player = ephemeralProgramRef.current.coder.accounts.decode("player", accountInfo.data)
          const newValue = Number(player.lastResult)
          setPlayerAccountData({ lastResult: newValue, rollnum: Number(player.rollnum) })
          if (newValue > 0) {
            setDiceValue(newValue)
            previousDiceValueRef.current = newValue
          }
          setRollHistory(prev => {
            const idx = prev.findIndex(entry => entry.isPending)
            if (idx === -1) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], value: newValue, endTime: Date.now(), isPending: false }
            setIsRolling(false)
            clearAllIntervals()
            return updated
          })
        } catch (error) {
          console.error("[WebSocket] Failed to decode player account:", error)
        }
      },
      { commitment: "processed" }
    )

    // Fetch blockhash for new connection
    await fetchAndCacheBlockhash(newEphemeralConnection, cachedEphemeralBlockhashRef)
  }, [clearAllIntervals])

  const sendBackgroundRoll = useCallback(async () => {
    if (!ephemeralProgramRef.current || !playerKeypairRef.current || !playerPdaRef.current || !ephemeralConnectionRef.current) return

    try {
      const randomValue = Math.floor(Math.random() * 6) + 1
      const [tx, blockhash] = await Promise.all([
        ephemeralProgramRef.current.methods.rollDiceDelegated(randomValue).accounts({
          payer: playerKeypairRef.current.publicKey,
          player: playerPdaRef.current,
          oracleQueue: ORACLE_QUEUE,
        }).transaction(),
        getBlockhashAsync(ephemeralConnectionRef.current, true)
      ])

      tx.recentBlockhash = blockhash
      tx.feePayer = playerKeypairRef.current.publicKey
      tx.sign(playerKeypairRef.current)

      ephemeralConnectionRef.current.sendRawTransaction(tx.serialize(), { skipPreflight: true })
      fetchAndCacheBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef).catch(console.error)
    } catch (error) {
      console.error("[BackgroundRoll] Error:", error)
    }
  }, [getBlockhashAsync])

  const initializeProgram = useCallback(async () => {
    if (typeof window === "undefined") return
    try {
      const connection = new Connection(BASE_ENDPOINT, "confirmed")
      connectionRef.current = connection

      if (!playerKeypairRef.current) {
        playerKeypairRef.current = loadOrCreateKeypair(PLAYER_STORAGE_KEY)
      }

      await ensureFunds(connection, playerKeypairRef.current)

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
      setPlayerPda(playerPk)

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
          setPlayerAccountData({
            lastResult: Number(player.lastResult),
            rollnum: Number(player.rollnum),
          })
        } catch (error) {
          console.error("Failed to decode player on init:", error)
        }
      }

      const routerEndpoint = process.env.NEXT_PUBLIC_ROUTER_ENDPOINT || "https://devnet-router.magicblock.app"
      const routerWsEndpoint = process.env.NEXT_PUBLIC_ROUTER_WS_ENDPOINT || "wss://devnet-router.magicblock.app"
      const routerConnection = new ConnectionMagicRouter(routerEndpoint, {
        wsEndpoint: routerWsEndpoint,
      })
      routerConnectionRef.current = routerConnection

      const ephemeralEndpoint = process.env.NEXT_PUBLIC_EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app"
      setEphemeralEndpoint(ephemeralEndpoint)
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
            if (!ephemeralProgramRef.current || !accountInfo?.data) return
            try {
              const player = ephemeralProgramRef.current.coder.accounts.decode("player", accountInfo.data)
              const newValue = Number(player.lastResult)
              setPlayerAccountData({ lastResult: newValue, rollnum: Number(player.rollnum) })
              if (newValue > 0) {
                setDiceValue(newValue)
                previousDiceValueRef.current = newValue
              }
              setRollHistory(prev => {
                const idx = prev.findIndex(entry => entry.isPending)
                if (idx === -1) return prev
                const updated = [...prev]
                updated[idx] = { ...updated[idx], value: newValue, endTime: Date.now(), isPending: false }
                setIsRolling(false)
                clearAllIntervals()
                return updated
              })
            } catch (error) {
              console.error("[WebSocket] Failed to decode player account:", error)
            }
          },
          { commitment: "processed" }
        )
      }

      const isDelegated = await refreshDelegationStatus()
      
      // If already delegated, update ephemeral connection to nearest validator
      if (isDelegated && routerConnectionRef.current) {
        try {
          const validatorResult = await routerConnectionRef.current.getClosestValidator()
          console.log("getClosestValidator result on init:", validatorResult)
          
          if (validatorResult.fqdn) {
            await updateEphemeralConnectionToValidator(validatorResult.fqdn)
          }
        } catch (error) {
          console.error("Failed to update ephemeral connection to nearest validator:", error)
          // Continue with default ephemeral connection if update fails
          await fetchAndCacheBlockhash(ephemeralConnection, cachedEphemeralBlockhashRef)
        }
      } else if (!isDelegated && routerConnectionRef.current) {
        // Automatically delegate on startup if not already delegated
        setIsDelegating(true)
        try {
          const validatorResult = await routerConnectionRef.current.getClosestValidator()
          console.log("getClosestValidator result on init:", validatorResult)
          
          const validatorIdentity = validatorResult.identity
          const validatorFqdn = validatorResult.fqdn
          
          if (!validatorIdentity || !validatorFqdn) {
            throw new Error("Validator identity or fqdn not found in getClosestValidator response")
          }
          
          await updateEphemeralConnectionToValidator(validatorFqdn)
          
          await ensureFunds(connection, playerKeypairRef.current)
          const validatorPubkey = new PublicKey(validatorIdentity)
          await program.methods
            .delegate({
              commitFrequencyMs: 30000,
              validator: validatorPubkey,
            })
            .rpc()

          // Poll every second until delegation succeeds
          if (delegationPollIntervalRef.current) {
            clearInterval(delegationPollIntervalRef.current)
          }

          delegationPollIntervalRef.current = setInterval(async () => {
            const delegated = await refreshDelegationStatus()
            if (delegated) {
              if (delegationPollIntervalRef.current) {
                clearInterval(delegationPollIntervalRef.current)
                delegationPollIntervalRef.current = null
              }
              setIsDelegating(false)
              // Send background roll immediately after successful delegation
              sendBackgroundRoll().catch(console.error)
            }
          }, 1000)
        } catch (error) {
          console.error("Automatic delegation failed on startup:", error)
          if (delegationPollIntervalRef.current) {
            clearInterval(delegationPollIntervalRef.current)
            delegationPollIntervalRef.current = null
          }
          setIsDelegating(false)
          await fetchAndCacheBlockhash(connection, cachedBaseBlockhashRef)
          if (ephemeralConnection) {
            await fetchAndCacheBlockhash(ephemeralConnection, cachedEphemeralBlockhashRef)
          }
        }
      } else {
        await fetchAndCacheBlockhash(connection, cachedBaseBlockhashRef)
        if (ephemeralConnection) {
          await fetchAndCacheBlockhash(ephemeralConnection, cachedEphemeralBlockhashRef)
        }
      }
      
      // Clear any existing interval before creating a new one
      if (blockhashIntervalRef.current) {
        clearInterval(blockhashIntervalRef.current)
      }
      
      // Start continuous blockhash refresh - this runs every 20 seconds regardless of other activity
      blockhashIntervalRef.current = setInterval(() => {
        if (connectionRef.current) {
          fetchAndCacheBlockhash(connectionRef.current, cachedBaseBlockhashRef).catch(console.error)
        }
        if (ephemeralConnectionRef.current) {
          fetchAndCacheBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef).catch(console.error)
        }
      }, BLOCKHASH_REFRESH_INTERVAL_MS)
      
      setIsInitialized(true)
    } catch (error) {
      console.error("Failed to initialize delegated dice:", error)
      setIsInitialized(false)
    }
    }, [refreshDelegationStatus, updateEphemeralConnectionToValidator, sendBackgroundRoll])

  useEffect(() => {
    initializeProgram()

    return () => {
      clearAllIntervals()
      // Clean up blockhash refresh interval on unmount
      if (blockhashIntervalRef.current) {
        clearInterval(blockhashIntervalRef.current)
        blockhashIntervalRef.current = null
      }
      // Clean up subscription
      if (subscriptionIdRef.current !== null && ephemeralConnectionRef.current) {
        ephemeralConnectionRef.current.removeAccountChangeListener(subscriptionIdRef.current).catch(console.error)
        subscriptionIdRef.current = null
      }
    }
  }, [clearAllIntervals, initializeProgram])

  const handleDelegateToValidator = useCallback(async (validatorIdentity: string, validatorFqdn: string) => {
    if (
      !programRef.current ||
      !connectionRef.current ||
      !playerKeypairRef.current ||
      !playerPdaRef.current
    )
      return
    if (isDelegated) return

    setIsDelegating(true)
    try {
      const connection = connectionRef.current
      const playerKeypair = playerKeypairRef.current
      
      const validatorPubkey = new PublicKey(validatorIdentity)
      
      // Update ephemeral connection to use the fqdn
      await updateEphemeralConnectionToValidator(validatorFqdn)

      await ensureFunds(connection, playerKeypair)
      await programRef.current.methods
        .delegate({
          commitFrequencyMs: 30000,
          validator: validatorPubkey,
        })
        .rpc()

      // Poll every second until delegation succeeds
      if (delegationPollIntervalRef.current) {
        clearInterval(delegationPollIntervalRef.current)
      }

      delegationPollIntervalRef.current = setInterval(async () => {
        const delegated = await refreshDelegationStatus()
        if (delegated) {
          if (delegationPollIntervalRef.current) {
            clearInterval(delegationPollIntervalRef.current)
            delegationPollIntervalRef.current = null
          }
          setIsDelegating(false)
          // Send background roll immediately after successful delegation
          sendBackgroundRoll().catch(console.error)
        }
      }, 1000)
    } catch (error) {
      console.error("Delegation failed:", error)
      if (delegationPollIntervalRef.current) {
        clearInterval(delegationPollIntervalRef.current)
        delegationPollIntervalRef.current = null
      }
      setIsDelegating(false)
    }
  }, [isDelegated, refreshDelegationStatus, clearAllIntervals, updateEphemeralConnectionToValidator, sendBackgroundRoll])

  const handleDelegate = useCallback(async () => {
    if (
      !programRef.current ||
      !connectionRef.current ||
      !playerKeypairRef.current ||
      !playerPdaRef.current ||
      !routerConnectionRef.current
    )
      return
    if (isDelegated) return

    setIsDelegating(true)
    try {
      const connection = connectionRef.current
      const playerKeypair = playerKeypairRef.current

      // Get closest validator
      const validatorResult = await routerConnectionRef.current.getClosestValidator()
      console.log("getClosestValidator result:", validatorResult)
      
      const validatorIdentity = validatorResult.identity
      const validatorFqdn = validatorResult.fqdn
      
      if (!validatorIdentity || !validatorFqdn) {
        throw new Error("Validator identity or fqdn not found in getClosestValidator response")
      }
      
      await handleDelegateToValidator(validatorIdentity, validatorFqdn)
    } catch (error) {
      console.error("Delegation failed:", error)
      if (delegationPollIntervalRef.current) {
        clearInterval(delegationPollIntervalRef.current)
        delegationPollIntervalRef.current = null
      }
      setIsDelegating(false)
    }
  }, [isDelegated, handleDelegateToValidator])

  const handleUndelegate = useCallback(async () => {
    if (
      !programRef.current ||
      !playerKeypairRef.current ||
      !playerPdaRef.current
    )
      return
    if (!isDelegated) return

    setIsUndelegating(true)
    try {
      // Store refs in local variables for TypeScript
      const playerKeypair = playerKeypairRef.current
      const playerPda = playerPdaRef.current
      const program = programRef.current
      
      if (!playerKeypair || !playerPda || !program) {
        throw new Error("Required refs not available")
      }

      // List of all known validator endpoints
      const validatorEndpoints = [
        "https://devnet-us.magicblock.app",
        "https://devnet-as.magicblock.app",
        "https://devnet-eu.magicblock.app",
      ]

      // Fetch IDL once
      const idl = await anchor.Program.fetchIdl(PROGRAM_ID, program.provider)
      if (!idl) throw new Error("IDL not found")

      // Send undelegate RPC to all validator endpoints
      const undelegatePromises = validatorEndpoints.map(async (endpoint) => {
        try {
          const wsEndpoint = endpoint.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
          const connection = new Connection(endpoint, {
            wsEndpoint,
            commitment: "processed",
          })
          
          const provider = new anchor.AnchorProvider(
            connection,
            walletAdapterFrom(playerKeypair),
            anchor.AnchorProvider.defaultOptions()
          )
          
          const ephemeralProgram = new anchor.Program(idl, provider)
          
          return await ephemeralProgram.methods
            .undelegate()
            .accounts({
              payer: playerKeypair.publicKey,
              user: playerPda,
            })
            .rpc()
        } catch (error) {
          console.warn(`Undelegation failed for ${endpoint}:`, error)
          throw error
        }
      })

      // Wait for all attempts (at least one should succeed)
      const results = await Promise.allSettled(undelegatePromises)
      const successful = results.filter(r => r.status === "fulfilled")
      
      if (successful.length === 0) {
        throw new Error("All undelegation attempts failed")
      }
      
      console.log(`Undelegation succeeded on ${successful.length} endpoint(s)`)

      // Poll every second until undelegation succeeds
      if (delegationPollIntervalRef.current) {
        clearInterval(delegationPollIntervalRef.current)
      }

      delegationPollIntervalRef.current = setInterval(async () => {
        const delegated = await refreshDelegationStatus()
        if (!delegated) {
          if (delegationPollIntervalRef.current) {
            clearInterval(delegationPollIntervalRef.current)
            delegationPollIntervalRef.current = null
          }
          setIsUndelegating(false)
        }
      }, 1000)
    } catch (error) {
      console.error("Undelegation failed:", error)
      if (delegationPollIntervalRef.current) {
        clearInterval(delegationPollIntervalRef.current)
        delegationPollIntervalRef.current = null
      }
      setIsUndelegating(false)
    }
  }, [isDelegated, refreshDelegationStatus])

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
        if (!prev.some(entry => entry.isPending)) return prev
        clearAllIntervals()
        setIsRolling(false)
        return prev.map(entry => entry.isPending ? { ...entry, isPending: false } : entry)
      })
    }, ROLL_TIMEOUT_MS)

    try {
      const randomValue = Math.floor(Math.random() * 6) + 1
      const connection = ephemeralConnectionRef.current!
      const [tx, blockhash] = await Promise.all([
        ephemeralProgramRef.current.methods.rollDiceDelegated(randomValue).accounts({
          payer: playerKeypairRef.current.publicKey,
          player: playerPdaRef.current,
          oracleQueue: ORACLE_QUEUE,
        }).transaction(),
        getBlockhashAsync(connection, true)
      ])

      tx.recentBlockhash = blockhash
      tx.feePayer = playerKeypairRef.current.publicKey
      tx.sign(playerKeypairRef.current)

      const transactionStartTime = Date.now()
      const sendPromise = connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
      
      sendPromise.then((signature) => {
        setRollHistory(prev => {
          const updated = [...prev]
          const pendingIndex = updated.findIndex(entry => entry.isPending && entry.value === null)
          if (pendingIndex !== -1) {
            updated[pendingIndex].startTime = transactionStartTime
            updated[pendingIndex].signature = signature
          }
          return updated
        })
      }).catch((error) => {
        console.error("[RollDice] Transaction send error:", error)
        clearAllIntervals()
        setIsRolling(false)
        setRollHistory(prev => prev.filter(entry => !entry.isPending))
      })
      
      fetchAndCacheBlockhash(connection, cachedEphemeralBlockhashRef).catch(console.error)
    } catch (error) {
      clearAllIntervals()
      console.error("Error rolling dice:", error)
      setIsRolling(false)
      setRollHistory(prev => prev.filter(entry => !entry.isPending))
    }
  }, [clearAllIntervals, isDelegated, isInitialized, isRolling, getBlockhashAsync])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }

  const handleGetClosestValidator = useCallback(async () => {
    if (!routerConnectionRef.current) {
      console.error("Router connection not initialized")
      return
    }
    try {
      const result = await routerConnectionRef.current.getClosestValidator()
      console.log("getClosestValidator result:", result)
    } catch (error) {
      console.error("Failed to get closest validator:", error)
    }
  }, [])

  const formatAddress = (addr: string) => {
    if (!addr) return ""
    return `${addr.substring(0, 8)}...${addr.substring(addr.length - 8)}`
  }

  const shortenSignature = (signature: string) => {
    if (!signature) return ""
    return `${signature.substring(0, 4)}...${signature.substring(signature.length - 4)}`
  }

  const getExplorerUrl = (signature: string) => {
    if (ephemeralEndpoint) {
      const encodedUrl = encodeURIComponent(ephemeralEndpoint)
      return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodedUrl}`
    }
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <SolanaAddress />
        {playerPda && (
          <Card className="w-80">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="debug" className="border-none">
                <AccordionTrigger className="px-6 py-3 hover:no-underline">
                  <CardTitle className="text-sm font-medium">Debug</CardTitle>
                </AccordionTrigger>
                <AccordionContent>
                  <CardContent className="space-y-3 pt-0">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">PDA Address</div>
                      <div
                        className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 transition-colors"
                        onClick={() => copyToClipboard(playerPda.toBase58())}
                      >
                        <span className="text-xs font-mono">{formatAddress(playerPda.toBase58())}</span>
                        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-gray-400" />}
                      </div>
                    </div>
                    {ephemeralEndpoint && (
                      <div className="space-y-1 pt-2 border-t">
                        <div className="text-xs text-muted-foreground">Ephemeral Connection</div>
                        <div className="text-xs font-mono break-all">{ephemeralEndpoint}</div>
                      </div>
                    )}
                    <div className="pt-2 border-t space-y-2">
                      <button
                        onClick={handleGetClosestValidator}
                        disabled={!isInitialized}
                        className="w-full px-3 py-1.5 bg-gray-600 text-white rounded text-xs font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Get Closest Validator
                      </button>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => handleDelegateToValidator("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd", "https://devnet-us.magicblock.app")}
                          disabled={!isInitialized || isDelegated || isDelegating}
                          className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          US
                        </button>
                        <button
                          onClick={() => handleDelegateToValidator("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57", "https://devnet-as.magicblock.app")}
                          disabled={!isInitialized || isDelegated || isDelegating}
                          className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          AS
                        </button>
                        <button
                          onClick={() => handleDelegateToValidator("MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e", "https://devnet-eu.magicblock.app")}
                          disabled={!isInitialized || isDelegated || isDelegating}
                          className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          EU
                        </button>
                      </div>
                      <button
                        onClick={handleUndelegate}
                        disabled={!isInitialized || !isDelegated || isUndelegating}
                        className="w-full px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isUndelegating ? "Undelegating..." : "Undelegate"}
                      </button>
                    </div>
                    {playerAccountData && (
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Last Result</div>
                          <div className="text-sm font-semibold">{playerAccountData.lastResult}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Roll Count</div>
                          <div className="text-sm font-semibold">{playerAccountData.rollnum}</div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        )}
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
              onMouseEnter={() => {
                if (ephemeralConnectionRef.current && !isRolling && isInitialized && isDelegated) {
                  const cached = getCachedBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef)
                  if (!cached) {
                    fetchAndCacheBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef).catch(console.error)
                  }
                }
              }}
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
                              <div className="flex items-center gap-2">
                                <MiniDice value={entry.value} />
                                {entry.signature && (
                                  <a
                                    href={getExplorerUrl(entry.signature)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-gray-500 hover:text-gray-700 hover:underline font-mono"
                                  >
                                    {shortenSignature(entry.signature)}
                                  </a>
                                )}
                              </div>
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
