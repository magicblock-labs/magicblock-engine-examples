"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import * as anchor from "@coral-xyz/anchor"
import {
  Connection,
  Keypair,
  PublicKey,
  type AccountInfo,
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
// Local IDL — bundle at build time instead of fetchIdl-ing from chain.
import randomDiceDelegatedIdl from "@/lib/idl/random_dice_delegated.json"
import {
  walletAdapterFrom,
  loadOrCreateKeypair,
  ensureFunds,
  fetchAndCacheBlockhash,
  getCachedBlockhash,
  checkDelegationStatus,
  loadIdl,
} from "@/lib/solana-utils"
import type { RollEntry, CachedBlockhash } from "@/lib/types"

const derivePlayerPda = (user: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(PLAYER_SEED), user.toBuffer()], PROGRAM_ID)[0]

type PlayerAccountSource = "subscription" | "sync" | "poll" | "callback"

const ROLL_FALLBACK_POLL_INITIAL_MS = 250
const ROLL_RESULT_DEADLINE_MS = 30000
const DELEGATION_POLL_INTERVAL_MS = 1000
const DELEGATION_POLL_TIMEOUT_MS = 30000

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

const RollLatency = memo(function RollLatency({ entry }: { entry: RollEntry }) {
  const [, setTick] = useState(0)
  const isTiming = entry.isPending

  useEffect(() => {
    if (!isTiming) return
    const interval = setInterval(() => setTick(tick => tick + 1), 50)
    return () => clearInterval(interval)
  }, [isTiming])

  const elapsed = entry.endTime
    ? entry.endTime - entry.startTime
    : isTiming
      ? Date.now() - entry.startTime
      : 0

  return `${elapsed.toString().padStart(6, '\u00A0')}ms${entry.timedOut ? '+' : isTiming ? '...' : ''}`
})

export default function DiceRollerDelegated() {
  const [diceValue, setDiceValue] = useState(1)
  const [isRolling, setIsRolling] = useState(false)
  const [isAwaitingResult, setIsAwaitingResult] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isDelegated, setIsDelegated] = useState(false)
  const [isDelegating, setIsDelegating] = useState(false)
  const [isUndelegating, setIsUndelegating] = useState(false)
  const [rollHistory, setRollHistory] = useState<RollEntry[]>([])
  const [playerAccountData, setPlayerAccountData] = useState<{ lastResult: number; rollnum: number } | null>(null)
  const [playerPda, setPlayerPda] = useState<PublicKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [ephemeralEndpoint, setEphemeralEndpoint] = useState<string | null>(null)
  
  const lastObservedRollnumRef = useRef<number | null>(null)
  const lastObservedSlotRef = useRef<number | null>(null)
  const pendingRollRef = useRef(false)
  const pendingRollGenerationRef = useRef(0)
  const pendingRequestSignatureRef = useRef<string | null>(null)
  const pendingRequestSlotRef = useRef<number | null>(null)
  const unavailableClientSeedsRef = useRef<Set<number>>(new Set())
  const nextClientSeedRef = useRef(Math.floor(Math.random() * 256))
  const programRef = useRef<anchor.Program | null>(null)
  const ephemeralProgramRef = useRef<anchor.Program | null>(null)
  const connectionRef = useRef<Connection | null>(null)
  const ephemeralConnectionRef = useRef<Connection | null>(null)
  const ephemeralConnectionGenerationRef = useRef(0)
  const routerConnectionRef = useRef<ConnectionMagicRouter | null>(null)
  const playerPdaRef = useRef<PublicKey | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const callbackLogsSubscriptionRef = useRef<{ connection: Connection; id: number } | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const resultPollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const resultDeadlineTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const blockhashIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const delegationPollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const delegationPollDeadlineRef = useRef<NodeJS.Timeout | null>(null)
  const delegationPollGenerationRef = useRef(0)
  const playerKeypairRef = useRef<Keypair | null>(null)
  const cachedBaseBlockhashRef = useRef<CachedBlockhash | null>(null)
  const cachedEphemeralBlockhashRef = useRef<CachedBlockhash | null>(null)

  const clearRequestTracking = useCallback(() => {
    pendingRequestSignatureRef.current = null
    pendingRequestSlotRef.current = null
  }, [])

  const cancelDelegationStatusPolling = useCallback(() => {
    delegationPollGenerationRef.current += 1
    if (delegationPollTimeoutRef.current) {
      clearTimeout(delegationPollTimeoutRef.current)
      delegationPollTimeoutRef.current = null
    }
    if (delegationPollDeadlineRef.current) {
      clearTimeout(delegationPollDeadlineRef.current)
      delegationPollDeadlineRef.current = null
    }
  }, [])

  const clearAllIntervals = useCallback(() => {
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current)
      rollIntervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (resultPollTimeoutRef.current) {
      clearTimeout(resultPollTimeoutRef.current)
      resultPollTimeoutRef.current = null
    }
    if (resultDeadlineTimeoutRef.current) {
      clearTimeout(resultDeadlineTimeoutRef.current)
      resultDeadlineTimeoutRef.current = null
    }
    if (callbackLogsSubscriptionRef.current) {
      const { connection, id } = callbackLogsSubscriptionRef.current
      callbackLogsSubscriptionRef.current = null
      connection.removeOnLogsListener(id).catch(console.error)
    }
    // Note: blockhashIntervalRef is NOT cleared here - it should run continuously
    cancelDelegationStatusPolling()
  }, [cancelDelegationStatusPolling])


  const getBlockhashAsync = useCallback(async (connection: Connection, isEphemeral: boolean): Promise<CachedBlockhash> => {
    const cacheRef = isEphemeral ? cachedEphemeralBlockhashRef : cachedBaseBlockhashRef
    const cached = getCachedBlockhash(connection, cacheRef)
    if (cached && cacheRef.current) return cacheRef.current
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    const latestBlockhash = {
      blockhash,
      lastValidBlockHeight,
      timestamp: Date.now(),
      endpoint: connection.rpcEndpoint,
    }
    cacheRef.current = latestBlockhash
    return latestBlockhash
  }, [])

  const handlePlayerAccountChange = useCallback((
    accountInfo: AccountInfo<Buffer>,
    source: PlayerAccountSource,
    slot?: number,
    observedAt = Date.now(),
    rollGeneration?: number,
  ) => {
    if (!programRef.current || !accountInfo?.data) return

    try {
      const player = programRef.current.coder.accounts.decode("player", accountInfo.data)
      const newValue = Number(player.lastResult)
      const newRollnum = Number(player.rollnum)
      const lastObservedRollnum = lastObservedRollnumRef.current
      const lastObservedSlot = lastObservedSlotRef.current

      if (
        (slot !== undefined && lastObservedSlot !== null && slot < lastObservedSlot) ||
        (lastObservedRollnum !== null &&
          (newRollnum < lastObservedRollnum || (source === "poll" && newRollnum === lastObservedRollnum)))
      ) return

      const completesPendingRoll = source === "callback" &&
        rollGeneration === pendingRollGenerationRef.current &&
        pendingRollRef.current &&
        newValue > 0

      if (completesPendingRoll) {
        pendingRollRef.current = false
        pendingRollGenerationRef.current += 1
        clearRequestTracking()
        clearAllIntervals()
        setIsRolling(false)
        setIsAwaitingResult(false)
      }

      lastObservedRollnumRef.current = newRollnum
      if (slot !== undefined) lastObservedSlotRef.current = slot
      setPlayerAccountData({ lastResult: newValue, rollnum: newRollnum })
      if (newValue > 0) setDiceValue(newValue)

      if (!completesPendingRoll) return

      setRollHistory(prev => {
        const idx = prev.findIndex(entry => entry.isPending)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          value: newValue,
          endTime: observedAt,
          isPending: false,
          timedOut: false,
        }
        return updated
      })
    } catch (error) {
      console.error("[PlayerAccount] Failed to decode player account:", error)
    }
  }, [clearAllIntervals, clearRequestTracking])

  const recordRequestSlot = useCallback((signature: string, slot: number) => {
    if (pendingRequestSignatureRef.current !== signature) return
    pendingRequestSlotRef.current = slot
  }, [])

  const trackRequestSlot = useCallback((connection: Connection, signature: string) => {
    pendingRequestSignatureRef.current = signature
    connection.onSignature(signature, (result, context) => {
      if (!result.err) recordRequestSlot(signature, context.slot)
    }, "processed")
  }, [recordRequestSlot])

  const refreshPlayerAccount = useCallback(async (
    connection: Connection,
    source: PlayerAccountSource = "poll",
    generation = ephemeralConnectionGenerationRef.current,
    rollGeneration?: number,
    minContextSlot?: number,
    observedAt = Date.now(),
  ) => {
    const currentPlayerPda = playerPdaRef.current
    if (!currentPlayerPda) return false
    const { context, value: accountInfo } = await connection.getAccountInfoAndContext(
      currentPlayerPda,
      { commitment: "processed", minContextSlot },
    )
    if (
      generation !== ephemeralConnectionGenerationRef.current ||
      connection !== ephemeralConnectionRef.current ||
      !accountInfo
    ) return false

    handlePlayerAccountChange(accountInfo, source, context.slot, observedAt, rollGeneration)
    return true
  }, [handlePlayerAccountChange])

  const updateEphemeralConnectionToValidator = useCallback(async (
    validatorFqdn: string,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> => {
    const playerKeypair = playerKeypairRef.current
    const currentPlayerPda = playerPdaRef.current
    const baseProgram = programRef.current
    if (!playerKeypair || !currentPlayerPda || !baseProgram || !isCurrent()) return false
    const existingConnection = ephemeralConnectionRef.current
    const existingGeneration = ephemeralConnectionGenerationRef.current
    if (
      existingConnection?.rpcEndpoint === validatorFqdn &&
      ephemeralProgramRef.current &&
      subscriptionIdRef.current !== null
    ) {
      const [{ context, value: accountInfo }, latestBlockhash] = await Promise.all([
        existingConnection.getAccountInfoAndContext(currentPlayerPda, "processed"),
        existingConnection.getLatestBlockhash(),
      ])
      if (
        !isCurrent() ||
        !accountInfo ||
        existingGeneration !== ephemeralConnectionGenerationRef.current ||
        existingConnection !== ephemeralConnectionRef.current
      ) return false

      cachedEphemeralBlockhashRef.current = {
        ...latestBlockhash,
        timestamp: Date.now(),
        endpoint: existingConnection.rpcEndpoint,
      }
      handlePlayerAccountChange(accountInfo, "sync", context.slot)
      return true
    }

    const oldConnection = existingConnection
    const oldSubscriptionId = subscriptionIdRef.current

    // Convert https:// to wss:// for WebSocket endpoint
    const ephemeralWsEndpoint = validatorFqdn.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
    const newEphemeralConnection = new Connection(validatorFqdn, {
      wsEndpoint: ephemeralWsEndpoint,
      commitment: "processed",
    })

    // Recreate ephemeral program with new connection — bundled IDL.
    const ephemeralProvider = new anchor.AnchorProvider(
      newEphemeralConnection,
      walletAdapterFrom(playerKeypair),
      anchor.AnchorProvider.defaultOptions()
    )
    const idl = await loadIdl(PROGRAM_ID, baseProgram.provider, randomDiceDelegatedIdl)
    if (!isCurrent()) return false

    const [{ context, value: accountInfo }, latestBlockhash] = await Promise.all([
      newEphemeralConnection.getAccountInfoAndContext(currentPlayerPda, "processed"),
      newEphemeralConnection.getLatestBlockhash(),
    ])
    if (
      !isCurrent() ||
      !accountInfo ||
      existingGeneration !== ephemeralConnectionGenerationRef.current ||
      existingConnection !== ephemeralConnectionRef.current
    ) return false

    const generation = ephemeralConnectionGenerationRef.current + 1
    const newEphemeralProgram = new anchor.Program(idl, ephemeralProvider)
    const newSubscriptionId = newEphemeralConnection.onAccountChange(
      currentPlayerPda,
      (updatedAccountInfo, updatedContext) => {
        if (
          generation !== ephemeralConnectionGenerationRef.current ||
          newEphemeralConnection !== ephemeralConnectionRef.current
        ) return
        handlePlayerAccountChange(updatedAccountInfo, "subscription", updatedContext.slot)
      },
      { commitment: "processed" }
    )

    ephemeralConnectionGenerationRef.current = generation
    // ER slots are validator-local. A slot observed on the previous validator
    // cannot be used to order updates from this connection.
    lastObservedSlotRef.current = null
    ephemeralConnectionRef.current = newEphemeralConnection
    ephemeralProgramRef.current = newEphemeralProgram
    subscriptionIdRef.current = newSubscriptionId
    cachedEphemeralBlockhashRef.current = {
      ...latestBlockhash,
      timestamp: Date.now(),
      endpoint: newEphemeralConnection.rpcEndpoint,
    }
    setEphemeralEndpoint(validatorFqdn)

    if (oldSubscriptionId !== null && oldConnection) {
      oldConnection.removeAccountChangeListener(oldSubscriptionId).catch(console.error)
    }

    // Publish the preflight snapshot only after the connection swap is complete.
    handlePlayerAccountChange(accountInfo, "sync", context.slot)
    return true
  }, [handlePlayerAccountChange])

  const refreshDelegationStatus = useCallback(async (
    isCurrent: () => boolean = () => true,
  ): Promise<boolean | null> => {
    const routerConnection = routerConnectionRef.current
    const currentPlayerPda = playerPdaRef.current
    if (!routerConnection || !currentPlayerPda || !isCurrent()) return null
    try {
      const delegationStatus = await routerConnection.getDelegationStatus(currentPlayerPda)
      if (!isCurrent()) return null
      
      // Update ephemeral connection to use the FQDN from delegation status if available
      const delegationStatusWithFqdn = delegationStatus as { isDelegated: boolean; fqdn?: string }
      if (delegationStatusWithFqdn.isDelegated && delegationStatusWithFqdn.fqdn) {
        const updated = await updateEphemeralConnectionToValidator(
          delegationStatusWithFqdn.fqdn,
          isCurrent,
        )
        if (!updated || !isCurrent()) return null
      }

      return delegationStatus.isDelegated
    } catch (error) {
      if (!isCurrent()) return null
      console.error("Failed to refresh delegation status:", error)
      return null
    }
  }, [updateEphemeralConnectionToValidator])

  const pollDelegationStatus = useCallback((
    expectedDelegated: boolean,
    onMatch: () => void,
    onTimeout: () => void,
  ) => {
    cancelDelegationStatusPolling()
    const generation = delegationPollGenerationRef.current

    delegationPollDeadlineRef.current = setTimeout(() => {
      if (generation !== delegationPollGenerationRef.current) return
      cancelDelegationStatusPolling()
      onTimeout()
    }, DELEGATION_POLL_TIMEOUT_MS)

    const poll = async () => {
      const isCurrent = () => generation === delegationPollGenerationRef.current
      const delegated = await refreshDelegationStatus(isCurrent)
      if (generation !== delegationPollGenerationRef.current) return

      if (delegated !== null) setIsDelegated(delegated)

      if (delegated === expectedDelegated) {
        cancelDelegationStatusPolling()
        onMatch()
        return
      }

      delegationPollTimeoutRef.current = setTimeout(poll, DELEGATION_POLL_INTERVAL_MS)
    }

    delegationPollTimeoutRef.current = setTimeout(poll, DELEGATION_POLL_INTERVAL_MS)
  }, [cancelDelegationStatusPolling, refreshDelegationStatus])

  const initializeProgram = useCallback(async (isCurrent: () => boolean) => {
    if (typeof window === "undefined" || !isCurrent()) return
    try {
      const connection = new Connection(BASE_ENDPOINT, "confirmed")
      connectionRef.current = connection

      if (!playerKeypairRef.current) {
        playerKeypairRef.current = loadOrCreateKeypair(PLAYER_STORAGE_KEY)
      }
      const playerKeypair = playerKeypairRef.current

      await ensureFunds(connection, playerKeypair)
      if (!isCurrent()) return

      const provider = new anchor.AnchorProvider(
        connection,
        walletAdapterFrom(playerKeypair),
        anchor.AnchorProvider.defaultOptions()
      )

      const idl = await loadIdl(PROGRAM_ID, provider, randomDiceDelegatedIdl)
      if (!isCurrent()) return
      const program = new anchor.Program(idl, provider)
      programRef.current = program

      const playerPk = derivePlayerPda(playerKeypair.publicKey)
      playerPdaRef.current = playerPk
      setPlayerPda(playerPk)

      let account = await connection.getAccountInfo(playerPk)
      if (!isCurrent()) return
      if (!account) {
        await program.methods.initialize().rpc()
        if (!isCurrent()) return
        account = await connection.getAccountInfo(playerPk)
        if (!isCurrent()) return
      }
      if (account) {
        try {
          const player = program.coder.accounts.decode("player", account.data)
          const initialValue = player.lastResult || 1
          const initialRollnum = Number(player.rollnum)
          setDiceValue(initialValue)
          lastObservedRollnumRef.current = initialRollnum
          setPlayerAccountData({
            lastResult: Number(player.lastResult),
            rollnum: initialRollnum,
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
      const oldEphemeralConnection = ephemeralConnectionRef.current
      const oldSubscriptionId = subscriptionIdRef.current
      const ephemeralGeneration = ephemeralConnectionGenerationRef.current + 1
      ephemeralConnectionGenerationRef.current = ephemeralGeneration
      lastObservedSlotRef.current = null
      ephemeralConnectionRef.current = ephemeralConnection
      const ephemeralProvider = new anchor.AnchorProvider(
        ephemeralConnection,
        walletAdapterFrom(playerKeypair),
        anchor.AnchorProvider.defaultOptions()
      )
      ephemeralProgramRef.current = new anchor.Program(idl, ephemeralProvider)

      if (oldSubscriptionId !== null && oldEphemeralConnection) {
        oldEphemeralConnection.removeAccountChangeListener(oldSubscriptionId).catch(console.error)
      }
      subscriptionIdRef.current = ephemeralConnection.onAccountChange(
        playerPk,
        (accountInfo, context) => {
          if (
            ephemeralGeneration !== ephemeralConnectionGenerationRef.current ||
            ephemeralConnection !== ephemeralConnectionRef.current
          ) return
          handlePlayerAccountChange(accountInfo, "subscription", context.slot)
        },
        { commitment: "processed" }
      )

      const delegationStatus = await refreshDelegationStatus(isCurrent)
      if (!isCurrent()) return
      if (delegationStatus === null) {
        throw new Error("Unable to determine delegation status")
      }
      setIsDelegated(delegationStatus)
      
      // refreshDelegationStatus already updates the ephemeral connection to the FQDN from delegation status if delegated
      if (delegationStatus === false && routerConnectionRef.current) {
        // Automatically delegate on startup if not already delegated
        setIsDelegating(true)
        try {
          const validatorResult = await routerConnectionRef.current.getClosestValidator()
          if (!isCurrent()) return
          console.log("getClosestValidator result on init:", validatorResult)
          
          const validatorIdentity = validatorResult.identity
          const validatorFqdn = validatorResult.fqdn
          
          if (!validatorIdentity || !validatorFqdn) {
            throw new Error("Validator identity or fqdn not found in getClosestValidator response")
          }
          
          await ensureFunds(connection, playerKeypair)
          if (!isCurrent()) return
          const validatorPubkey = new PublicKey(validatorIdentity)
          const remainingAccounts = [
            {
              pubkey: validatorPubkey,
              isSigner: false,
              isWritable: false,
            },
          ]
          await program.methods
            .delegate()
            .accounts({
              user: playerKeypair.publicKey,
            })
            .remainingAccounts(remainingAccounts)
            .rpc()
          if (!isCurrent()) return

          pollDelegationStatus(
            true,
            () => setIsDelegating(false),
            () => {
              console.error("Timed out waiting for delegation status")
              setIsDelegating(false)
            },
          )
        } catch (error) {
          if (!isCurrent()) return
          console.error("Automatic delegation failed on startup:", error)
          cancelDelegationStatusPolling()
          setIsDelegating(false)
          await fetchAndCacheBlockhash(connection, cachedBaseBlockhashRef)
          if (!isCurrent()) return
          // Use ephemeralConnectionRef.current instead of ephemeralConnection since updateEphemeralConnectionToValidator may have updated it
          if (ephemeralConnectionRef.current) {
            await fetchAndCacheBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef)
            if (!isCurrent()) return
          }
        }
      } else {
        await fetchAndCacheBlockhash(connection, cachedBaseBlockhashRef)
        if (!isCurrent()) return
        // Use ephemeralConnectionRef.current instead of ephemeralConnection since refreshDelegationStatus may have updated it
        if (ephemeralConnectionRef.current) {
          await fetchAndCacheBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef)
          if (!isCurrent()) return
        }
      }

      if (!isCurrent()) return
      
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
      if (!isCurrent()) return
      console.error("Failed to initialize delegated dice:", error)
      setIsInitialized(false)
    }
    }, [cancelDelegationStatusPolling, handlePlayerAccountChange, pollDelegationStatus, refreshDelegationStatus])

  useEffect(() => {
    let active = true
    void initializeProgram(() => active)

    return () => {
      active = false
      pendingRollRef.current = false
      pendingRollGenerationRef.current += 1
      ephemeralConnectionGenerationRef.current += 1
      clearRequestTracking()
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
  }, [clearAllIntervals, clearRequestTracking, initializeProgram])

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
      
      await ensureFunds(connection, playerKeypair)
      const remainingAccounts = [
        {
          pubkey: validatorPubkey,
          isSigner: false,
          isWritable: false,
        },
      ]
      await programRef.current.methods
        .delegate()
        .accounts({
          user: playerKeypair.publicKey,
        })
        .remainingAccounts(remainingAccounts)
        .rpc()

      pollDelegationStatus(
        true,
        () => setIsDelegating(false),
        () => {
          console.error("Timed out waiting for delegation status")
          setIsDelegating(false)
        },
      )
    } catch (error) {
      console.error("Delegation failed:", error)
      cancelDelegationStatusPolling()
      setIsDelegating(false)
    }
  }, [cancelDelegationStatusPolling, isDelegated, pollDelegationStatus])

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
      cancelDelegationStatusPolling()
      setIsDelegating(false)
    }
  }, [cancelDelegationStatusPolling, isDelegated, handleDelegateToValidator])

  const handleUndelegate = useCallback(async () => {
    if (
      !programRef.current ||
      !playerKeypairRef.current ||
      !playerPdaRef.current ||
      !routerConnectionRef.current
    )
      return
    if (!isDelegated || isDelegating || isRolling || isAwaitingResult) return

    setIsUndelegating(true)
    try {
      // Store refs in local variables for TypeScript
      const playerKeypair = playerKeypairRef.current
      const playerPda = playerPdaRef.current
      const program = programRef.current
      
      if (!playerKeypair || !playerPda || !program) {
        throw new Error("Required refs not available")
      }

      // Get the FQDN from delegation status
      const delegationStatus = await routerConnectionRef.current.getDelegationStatus(playerPda)
      const delegationStatusWithFqdn = delegationStatus as { isDelegated: boolean; fqdn?: string }
      
      if (!delegationStatusWithFqdn.fqdn) {
        throw new Error("FQDN not found in delegation status")
      }

      const validatorFqdn = delegationStatusWithFqdn.fqdn
      const wsEndpoint = validatorFqdn.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
      
      // Create connection to the specific validator we're delegated to
      const connection = new Connection(validatorFqdn, {
        wsEndpoint,
        commitment: "processed",
      })

      const provider = new anchor.AnchorProvider(
        connection,
        walletAdapterFrom(playerKeypair),
        anchor.AnchorProvider.defaultOptions()
      )

      const idl = await loadIdl(PROGRAM_ID, program.provider, randomDiceDelegatedIdl)
      const ephemeralProgram = new anchor.Program(idl, provider)
      console.log(ephemeralProgram.programId.toBase58(), "vs", program.programId.toBase58())
      
      // Send undelegate RPC to the specific validator endpoint.
      await ephemeralProgram.methods
        .undelegate()
        .accounts({
          payer: playerKeypair.publicKey,
          user: playerPda,
        })
        .rpc({ skipPreflight: true })

      console.log(`Undelegation sent to ${validatorFqdn}`)

      pollDelegationStatus(
        false,
        () => setIsUndelegating(false),
        () => {
          console.error("Timed out waiting for undelegation status")
          setIsUndelegating(false)
        },
      )
    } catch (error: any) {
      // Aggressive unwrap — SendTransactionError stores everything as
      // non-enumerable, and Anchor wraps it with another object whose
      // `.message` may itself be an object (printing as "[object Object]").
      // Walk the layers and dump JSON for anything that isn't a string.
      const safe = (v: any) => {
        if (v == null) return v
        if (typeof v === "string") return v
        try { return JSON.stringify(v, Object.getOwnPropertyNames(v), 2) }
        catch { return String(v) }
      }
      // One combined string so the Next.js error overlay (which only
      // surfaces the first console.error per render) shows everything.
      let extraLogs: string | null = null
      if (typeof error?.getLogs === "function") {
        try {
          const logs = await error.getLogs(ephemeralConnectionRef.current ?? undefined)
          extraLogs = safe(logs)
        } catch { /* getLogs may fail if the tx never landed */ }
      }
      console.error(
        "Undelegation failed:\n" +
          `  error:     ${safe(error)}\n` +
          `  message:   ${safe(error?.message)}\n` +
          `  cause:     ${safe(error?.cause)}\n` +
          `  logs:      ${safe(error?.logs)}\n` +
          `  signature: ${error?.signature ?? error?.txid ?? error?.tx ?? "(none)"}\n` +
          `  getLogs(): ${extraLogs ?? "(unavailable)"}`,
      )
      cancelDelegationStatusPolling()
      setIsUndelegating(false)
    }
  }, [cancelDelegationStatusPolling, isAwaitingResult, isDelegated, isDelegating, isRolling, pollDelegationStatus])

  const handleRollDice = useCallback(async () => {
    if (
      isRolling ||
      isAwaitingResult ||
      isDelegating ||
      isUndelegating ||
      pendingRollRef.current ||
      !isInitialized ||
      !isDelegated
    ) return
    const program = ephemeralProgramRef.current
    const playerKeypair = playerKeypairRef.current
    const playerPda = playerPdaRef.current
    const connection = ephemeralConnectionRef.current
    if (!program || !playerKeypair || !playerPda || !connection) return
    if (unavailableClientSeedsRef.current.size >= 256) {
      console.error("[RollDice] No client seeds available while previous callbacks remain unresolved")
      return
    }

    let randomValue = nextClientSeedRef.current
    while (unavailableClientSeedsRef.current.has(randomValue)) {
      randomValue = (randomValue + 1) % 256
    }
    unavailableClientSeedsRef.current.add(randomValue)
    nextClientSeedRef.current = (randomValue + 1) % 256

    console.log("[RollDice] Starting roll")
    clearAllIntervals()
    clearRequestTracking()

    const rollGeneration = pendingRollGenerationRef.current + 1
    const connectionGeneration = ephemeralConnectionGenerationRef.current
    const callbackInstructionLog = "Program log: Instruction: CallbackRollDiceSimple"
    const callbackSeedLog = `Program log: client_seed=${randomValue}`
    let requestSignature: string | null = null

    pendingRollGenerationRef.current = rollGeneration
    pendingRollRef.current = true
    setIsRolling(true)
    setIsAwaitingResult(true)

    const isCurrentRoll = () => (
      pendingRollRef.current &&
      pendingRollGenerationRef.current === rollGeneration
    )
    const isCurrentConnection = () => (
      isCurrentRoll() &&
      connectionGeneration === ephemeralConnectionGenerationRef.current &&
      connection === ephemeralConnectionRef.current
    )
    const isCurrentRequest = () => (
      isCurrentConnection() &&
      requestSignature !== null &&
      pendingRequestSignatureRef.current === requestSignature
    )

    const failPendingRoll = () => {
      if (!isCurrentRoll()) return
      pendingRollRef.current = false
      pendingRollGenerationRef.current = rollGeneration + 1
      unavailableClientSeedsRef.current.delete(randomValue)
      clearRequestTracking()
      clearAllIntervals()
      setIsRolling(false)
      setIsAwaitingResult(false)
      setRollHistory(prev => prev.filter(entry => !entry.isPending))
    }

    const expirePendingRoll = () => {
      if (!isCurrentRoll()) return
      pendingRollRef.current = false
      pendingRollGenerationRef.current = rollGeneration + 1
      clearRequestTracking()
      clearAllIntervals()
      setIsRolling(false)
      setIsAwaitingResult(false)
      setRollHistory(prev => {
        const idx = prev.findIndex(entry => entry.isPending)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          endTime: Date.now(),
          isPending: false,
          timedOut: true,
        }
        return updated
      })
    }

    rollIntervalRef.current = setInterval(() => {
      if (!isCurrentRoll()) return
      setDiceValue(Math.floor(Math.random() * 6) + 1)
    }, ROLL_ANIMATION_INTERVAL_MS)

    // Create a pending entry immediately; its start time is replaced when the transaction is sent.
    setRollHistory(prev => {
      const newEntry = {
        value: null,
        startTime: Date.now(),
        endTime: null,
        isPending: true,
      }
      return [newEntry, ...prev]
    })

    resultDeadlineTimeoutRef.current = setTimeout(() => {
      if (!isCurrentRoll()) return
      console.error("[RollDice] Timed out waiting for the VRF callback")
      expirePendingRoll()
    }, ROLL_RESULT_DEADLINE_MS)

    try {
      try {
        const id = connection.onLogs(
          playerPda,
          (info, context) => {
            if (
              info.err ||
              !info.logs.includes(callbackInstructionLog) ||
              !info.logs.includes(callbackSeedLog)
            ) return

            const observedAt = Date.now()
            void (async () => {
              const signature = requestSignature
              if (!signature || !isCurrentRequest()) return

              const requestSlot = pendingRequestSlotRef.current
              if (requestSlot !== null && context.slot < requestSlot) return

              unavailableClientSeedsRef.current.delete(randomValue)
              await refreshPlayerAccount(
                connection,
                "callback",
                connectionGeneration,
                rollGeneration,
                context.slot,
                observedAt,
              )
            })().catch(error => {
              console.error("[RollDice] Callback account refresh failed:", error)
            })
          },
          "processed",
        )
        callbackLogsSubscriptionRef.current = { connection, id }
      } catch (error) {
        console.error("[RollDice] Callback log subscription failed; using history fallback:", error)
      }

      const [tx, latestBlockhash] = await Promise.all([
        program.methods.rollDiceDelegated(randomValue).accounts({
          payer: playerKeypair.publicKey,
          player: playerPda,
          oracleQueue: ORACLE_QUEUE,
        }).transaction(),
        getBlockhashAsync(connection, true)
      ])
      if (!isCurrentRoll()) return
      if (!isCurrentConnection()) {
        failPendingRoll()
        return
      }

      tx.recentBlockhash = latestBlockhash.blockhash
      tx.feePayer = playerKeypair.publicKey
      tx.sign(playerKeypair)
      if (!tx.signature) throw new Error("Roll transaction signature missing")

      const transactionStartTime = Date.now()
      const signature = anchor.utils.bytes.bs58.encode(tx.signature)
      requestSignature = signature
      trackRequestSlot(connection, signature)
      setRollHistory(prev => {
        const idx = prev.findIndex(entry => entry.isPending)
        if (idx === -1) return prev
        const updated = [...prev]
        updated[idx] = { ...updated[idx], startTime: transactionStartTime, signature }
        return updated
      })

      connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }).catch((error) => {
        // Submission errors are ambiguous: keep reconciling the signed transaction.
        console.error("[RollDice] Transaction send error; waiting for account or signature status:", error)
      })

      let didTimeout = false
      let nextPollDelay = ROLL_FALLBACK_POLL_INITIAL_MS
      const reconcileCallback = async () => {
        const requestSlot = pendingRequestSlotRef.current
        if (!isCurrentRequest() || requestSlot === null) return

        const candidates = await connection.getSignaturesForAddress(
          playerPda,
          { limit: 20, until: signature },
          "confirmed",
        )
        if (!isCurrentRequest()) return

        for (const candidate of candidates) {
          if (
            candidate.err ||
            candidate.slot < requestSlot
          ) continue

          const callback = await connection.getTransaction(candidate.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          })
          if (!isCurrentRequest()) return

          const logs = callback?.meta?.logMessages ?? []
          if (
            logs.includes(callbackInstructionLog) &&
            logs.includes(callbackSeedLog)
          ) {
            unavailableClientSeedsRef.current.delete(randomValue)
            await refreshPlayerAccount(
              connection,
              "callback",
              connectionGeneration,
              rollGeneration,
              candidate.slot,
            )
            return
          }
        }
      }

      const pollForResult = async () => {
        if (!isCurrentRequest()) return
        try {
          await refreshPlayerAccount(connection, "poll", connectionGeneration)
          if (!isCurrentRequest()) return

          const [{ value: signatureStatus }, blockHeight] = await Promise.all([
            connection.getSignatureStatus(signature, { searchTransactionHistory: true }),
            didTimeout ? connection.getBlockHeight("processed") : Promise.resolve(null),
          ])
          if (!isCurrentRequest()) return

          if (signatureStatus && !signatureStatus.err) {
            recordRequestSlot(signature, signatureStatus.slot)
            await reconcileCallback()
          }
          if (!isCurrentRequest()) return

          if (signatureStatus?.err || (!signatureStatus && blockHeight !== null && blockHeight > latestBlockhash.lastValidBlockHeight)) {
            console.error("[RollDice] Roll transaction failed or expired:", signatureStatus?.err ?? "blockhash expired")
            failPendingRoll()
            return
          }
        } catch (error) {
          console.error("[RollDice] Fallback account refresh failed:", error)
        }
        if (isCurrentRequest()) {
          const delay = didTimeout
            ? ROLL_TIMEOUT_MS
            : Math.min(nextPollDelay, Math.max(0, transactionStartTime + ROLL_TIMEOUT_MS - Date.now()))
          resultPollTimeoutRef.current = setTimeout(pollForResult, delay)
          nextPollDelay = Math.min(nextPollDelay * 2, ROLL_TIMEOUT_MS)
        }
      }

      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        if (!isCurrentRequest()) return
        didTimeout = true
        if (rollIntervalRef.current) {
          clearInterval(rollIntervalRef.current)
          rollIntervalRef.current = null
        }
        setIsRolling(false)
        setRollHistory(prev => {
          const idx = prev.findIndex(entry => entry.isPending)
          if (idx === -1) return prev
          const updated = [...prev]
          updated[idx] = {
            ...updated[idx],
            timedOut: true,
          }
          return updated
        })
      }, ROLL_TIMEOUT_MS)

      // Callback logs are primary; guarded reads and transaction history hedge delayed WebSocket delivery.
      resultPollTimeoutRef.current = setTimeout(pollForResult, nextPollDelay)
      nextPollDelay *= 2
      
      fetchAndCacheBlockhash(connection, cachedEphemeralBlockhashRef).catch(console.error)
    } catch (error) {
      console.error("Error rolling dice:", error)
      failPendingRoll()
    }
  }, [
    clearAllIntervals,
    clearRequestTracking,
    getBlockhashAsync,
    isAwaitingResult,
    isDelegated,
    isDelegating,
    isInitialized,
    isRolling,
    isUndelegating,
    recordRequestSlot,
    refreshPlayerAccount,
    trackRequestSlot,
  ])

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
                        disabled={!isInitialized || !isDelegated || isDelegating || isRolling || isAwaitingResult || isUndelegating}
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
                if (ephemeralConnectionRef.current && !isRolling && !isAwaitingResult && !isDelegating && !isUndelegating && isInitialized && isDelegated) {
                  const cached = getCachedBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef)
                  if (!cached) {
                    fetchAndCacheBlockhash(ephemeralConnectionRef.current, cachedEphemeralBlockhashRef).catch(console.error)
                  }
                }
              }}
              disabled={isRolling || isAwaitingResult || isDelegating || isUndelegating || !isInitialized || !isDelegated}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isRolling ? "Rolling..." : isAwaitingResult ? "Waiting for result..." : isDelegating ? "Delegating..." : isUndelegating ? "Undelegating..." : !isInitialized ? "Initializing..." : !isDelegated ? "Delegate First" : "Roll Dice"}
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
                            <TableCell className={`text-right font-mono whitespace-pre ${entry.timedOut ? "text-amber-600 font-medium" : entry.isPending ? "text-blue-600 font-medium" : ""}`}>
                              <RollLatency entry={entry} />
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
