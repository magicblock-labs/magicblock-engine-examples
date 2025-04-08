"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Dice from "@/components/dice"
import SolanaAddress from "@/components/solana-address"
// @ts-ignore
import * as anchor from "@coral-xyz/anchor"
// @ts-ignore
import {Connection, Keypair, PublicKey, Transaction, VersionedTransaction} from "@solana/web3.js"
import { useToast } from "@/hooks/use-toast"

// Program ID for the dice game
const PROGRAM_ID = new anchor.web3.PublicKey("8xgZ1hY7TnVZ4Bbh7v552Rs3BZMSq3LisyWckkBsNLP")

export default function DiceRoller() {
  const [diceValue, setDiceValue] = useState(1)
  const [isRolling, setIsRolling] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [key, setKey] = useState(0) // Used to force re-render the component
  const programRef = useRef<anchor.Program | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const { toast } = useToast()

  // Clear the rolling animation interval
  const clearRollInterval = () => {
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current)
      rollIntervalRef.current = null
    }
  }

  const initializeProgram = async () => {
    try {
      // Get or create keypair
      let storedKeypair = localStorage.getItem("solanaKeypair")
      let keypair: Keypair

      const connection = new Connection("https://rpc.magicblock.app/devnet", "confirmed")

      if (storedKeypair) {
        const secretKey = Uint8Array.from(JSON.parse(storedKeypair))
        keypair = Keypair.fromSecretKey(secretKey)
      } else {
        keypair = Keypair.generate()
        localStorage.setItem("solanaKeypair", JSON.stringify(Array.from(keypair.secretKey)))
      }

      // Create the provider
      const provider = new anchor.AnchorProvider(
          connection,
          {
            publicKey: keypair.publicKey,
            signTransaction: async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
              // @ts-ignore
              transaction.sign(keypair)
              return transaction
            },
            signAllTransactions: async <T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> => {
              for (const tx of transactions) {
                // @ts-ignore
                tx.sign(keypair)
              }
              return transactions
            },
          },
          anchor.AnchorProvider.defaultOptions()
      )

      // User
      console.log("User: ", keypair.publicKey.toBase58())

      // Fetch the IDL
      const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
      if (!idl) throw new Error("IDL not found")

      // Create the program instance
      const program = new anchor.Program(idl, provider)
      programRef.current = program

      console.log("Program instance created successfully: ", program.programId.toBase58())

      // Initialize the program
      const playerPk = PublicKey.findProgramAddressSync([Buffer.from("playerd"), provider.publicKey.toBytes()], program.programId)[0];
      let account = await connection.getAccountInfo(playerPk);
      // @ts-ignore
      if(!account || !account.data || account.data.length === 0) {
        console.log("Player account not found, creating new one...")
        const tx = await program.methods.initialize().rpc()
        console.log("User initialized with tx:", tx)
      }else{
        const ply = program.coder.accounts.decode("player", account.data)
        console.log("Player account:", playerPk.toBase58(), "lastResult:", ply.lastResult)
        setDiceValue(ply.lastResult)
      }

      // Subscribe to account changes
      if (subscriptionIdRef.current !== null) {
        await connection.removeAccountChangeListener(subscriptionIdRef.current);
      }

      subscriptionIdRef.current = connection.onAccountChange(
          playerPk,
          // @ts-ignore
          (accountInfo) => {
            const player = program.coder.accounts.decode("player", accountInfo.data)
            console.log("Player account changed:", player)
            setDiceValue(player.lastResult)
            setIsRolling(false)
            clearRollInterval()
          },
          {commitment: "processed"}
      );

      // Set initialization as successful
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

    // Cleanup function
    return () => {
      clearRollInterval()
      // Clean up subscription
      if (subscriptionIdRef.current !== null) {
        const connection = new Connection("https://rpc.magicblock.app/devnet", "confirmed")
        connection.removeAccountChangeListener(subscriptionIdRef.current).catch(console.error)
      }
    }
  }, [toast, key]) // Add key as dependency to re-run when key changes

  const handleBalanceChange = useCallback((newBalance: number) => {
    console.log("Balance changed:", newBalance)

    // If not initialized, try to initialize again or force component reload
    if (!isInitialized) {
      console.log("Not initialized, attempting to reinitialize...")

      // Option 1: Call initializeProgram again
      initializeProgram()

      // Option 2: Force component reload by changing the key
      setKey(prevKey => prevKey + 1)

      toast({
        title: "Reinitializing",
        description: "Balance changed, attempting to reinitialize the program",
      })
    }
  }, [isInitialized, toast])

  const handleRollDice = useCallback(async () => {
    if (isRolling || !isInitialized) return;

    setIsRolling(true)

    // Clear any existing interval
    clearRollInterval()

    if (programRef.current) {
      try {
        const tx = await programRef.current.methods.rollDice(Math.floor(Math.random() * 6) + 1).rpc()
        console.log("Dice rolled on-chain with tx:", tx)

        toast({
          title: "Dice Rolled",
          description: `Result: TX: ${tx.slice(0, 8)}...`,
        })

        // Simulate rolling animation by changing values rapidly
        rollIntervalRef.current = setInterval(() => {
          setDiceValue(Math.floor(Math.random() * 6) + 1)
        }, 100)

        // Add a timeout to stop rolling after 10 seconds if still rolling
        setTimeout(() => {
          if (isRolling) {
            console.log("Rolling timeout reached (10s), stopping animation")
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
    } else {
      console.error("Program not initialized")
      toast({
        title: "Error",
        description: "Program not initialized",
        variant: "destructive",
      })
      setIsRolling(false)
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
