"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import * as anchor from "@coral-xyz/anchor"
import { Connection, PublicKey } from "@solana/web3.js"
import { useToast } from "@/hooks/use-toast"
import Dice from "@/components/dice"
import SolanaAddress from "@/components/solana-address"
import { PROGRAM_ID_STANDARD, PLAYER_SEED, BASE_ENDPOINT, PLAYER_STORAGE_KEY } from "@/lib/config"
import { walletAdapterFrom, loadOrCreateKeypair } from "@/lib/solana-utils"

export default function DiceRoller() {
  const [diceValue, setDiceValue] = useState(1)
  const [isRolling, setIsRolling] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [key, setKey] = useState(0)
  
  const programRef = useRef<anchor.Program | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const { toast } = useToast()

  // Clear the rolling animation interval
  const clearRollInterval = () => {
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current)
      rollIntervalRef.current = null
    }
  }

  const clearAllIntervals = useCallback(() => {
    clearRollInterval()
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const initializeProgram = async () => {
    try {
      const keypair = loadOrCreateKeypair(PLAYER_STORAGE_KEY)
      const connection = new Connection(BASE_ENDPOINT, "confirmed")

      const provider = new anchor.AnchorProvider(
        connection,
        walletAdapterFrom(keypair),
        anchor.AnchorProvider.defaultOptions()
      )

      const idl = await anchor.Program.fetchIdl(PROGRAM_ID_STANDARD, provider)
      if (!idl) throw new Error("IDL not found")

      const program = new anchor.Program(idl, provider)
      programRef.current = program

      const playerPk = PublicKey.findProgramAddressSync(
        [Buffer.from(PLAYER_SEED), provider.publicKey.toBytes()],
        program.programId
      )[0]

      let account = await connection.getAccountInfo(playerPk)
      if (!account || !account.data || account.data.length === 0) {
        await program.methods.initialize().rpc()
      } else {
        const player = program.coder.accounts.decode("player", account.data)
        setDiceValue(player.lastResult)
      }

      if (subscriptionIdRef.current !== null) {
        await connection.removeAccountChangeListener(subscriptionIdRef.current)
      }

      subscriptionIdRef.current = connection.onAccountChange(
        playerPk,
        (accountInfo) => {
          const player = program.coder.accounts.decode("player", accountInfo.data)
          const newValue = Number(player.lastResult)
          setDiceValue(newValue)
          setIsRolling(false)
          clearAllIntervals()
        },
        { commitment: "processed" }
      )

      setIsInitialized(true)
    } catch (error) {
      console.error("Failed to initialize program:", error)
      setIsInitialized(false)
      toast({
        title: "Error",
        description: "Failed to initialize dice program",
        variant: "destructive",
      })
    }
  }

  useEffect(() => {
    initializeProgram()

    return () => {
      clearAllIntervals()
      if (subscriptionIdRef.current !== null) {
        const connection = new Connection(BASE_ENDPOINT, "confirmed")
        connection.removeAccountChangeListener(subscriptionIdRef.current).catch(console.error)
      }
    }
  }, [toast, key])

  const handleBalanceChange = useCallback((newBalance: number) => {
    if (!isInitialized) {
      initializeProgram()
      setKey(prevKey => prevKey + 1)
      toast({
        title: "Reinitializing",
        description: "Balance changed, attempting to reinitialize the program",
      })
    }
  }, [isInitialized, toast])

  const handleRollDice = useCallback(async () => {
    if (isRolling || !isInitialized) return

    setIsRolling(true)
    clearRollInterval()

    if (!programRef.current) {
      toast({
        title: "Error",
        description: "Program not initialized",
        variant: "destructive",
      })
      setIsRolling(false)
      return
    }

    try {
      await programRef.current.methods.rollDice(Math.floor(Math.random() * 6) + 1).rpc()

      rollIntervalRef.current = setInterval(() => {
        setDiceValue(Math.floor(Math.random() * 6) + 1)
      }, 100)

      setTimeout(() => {
        if (isRolling) {
          setIsRolling(false)
          clearRollInterval()
          toast({
            title: "Notice",
            description: "Dice roll is taking longer than expected. Check transaction status in explorer.",
            variant: "destructive",
          })
        }
      }, 10000)
    } catch (error) {
      console.error("Error rolling dice:", error)
      toast({
        title: "Error",
        description: "Failed to roll dice",
        variant: "destructive",
      })
      setIsRolling(false)
      clearRollInterval()
    }
  }, [isRolling, isInitialized, toast])

  return (
      <div className="flex flex-col min-h-screen bg-gray-100">
        <div className="absolute top-4 right-4 z-10">
          <SolanaAddress onBalanceChange={handleBalanceChange} />
        </div>

        <div className="flex flex-col items-center justify-center flex-grow">
          <h1 className="text-3xl font-bold mb-8">Dice Roller</h1>
          <div className="mb-8">
            <Dice value={diceValue} isRolling={isRolling} onClick={handleRollDice} />
          </div>
          <button
              onClick={handleRollDice}
              disabled={isRolling || !isInitialized}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isRolling ? "Rolling..." : !isInitialized ? "Initializing..." : "Roll Dice"}
          </button>
        </div>
      </div>
  )
}
