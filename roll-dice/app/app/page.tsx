"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Dice from "@/components/dice"
import SolanaAddress from "@/components/solana-address"
import * as anchor from "@coral-xyz/anchor"
import {Connection, Keypair, PublicKey, Transaction, VersionedTransaction} from "@solana/web3.js"
import { useToast } from "@/hooks/use-toast"

// Program ID for the dice game
const PROGRAM_ID = new anchor.web3.PublicKey("53rd42GvfyHQEy9xEPtcYVdzkyXKrN7KTbqBPsa676CE")

export default function DiceRoller() {
  const [diceValue, setDiceValue] = useState(1)
  const [isRolling, setIsRolling] = useState(false)
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

  useEffect(() => {
    const initializeProgram = async () => {
      try {
        // Get or create keypair
        let storedKeypair = localStorage.getItem("solanaKeypair")
        let keypair: Keypair

        if (storedKeypair) {
          const secretKey = Uint8Array.from(JSON.parse(storedKeypair))
          keypair = Keypair.fromSecretKey(secretKey)
        } else {
          keypair = Keypair.generate()
          localStorage.setItem("solanaKeypair", JSON.stringify(Array.from(keypair.secretKey)))
        }

        const connection = new Connection("https://rpc.magicblock.app/devnet", "confirmed")

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
        console.log(idl)
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
            (accountInfo) => {
              const player = program.coder.accounts.decode("player", accountInfo.data)
              console.log("Player account changed:", player)
              setDiceValue(player.lastResult)
              setIsRolling(false)
              clearRollInterval()
            },
            {commitment: "processed"}
        );
      } catch (error) {
        console.error("Failed to initialize program:", error)
        toast({
          title: "Error",
          description: "Failed to initialize dice program",
          variant: "destructive",
        })
      }
    }

    initializeProgram()

    // Cleanup function
    return () => {
      clearRollInterval()
    }
  }, [toast])

  const handleRollDice = useCallback(async () => {
    if (isRolling) return;

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
  }, [isRolling, toast])

  return (
      <div className="flex flex-col min-h-screen bg-gray-100">
        <div className="absolute top-4 right-4 z-10">
          <SolanaAddress />
        </div>

        <div className="flex flex-col items-center justify-center flex-grow">
          <h1 className="text-3xl font-bold mb-8">Dice Roller</h1>
          <div className="mb-8">
            <Dice value={diceValue} isRolling={isRolling} onClick={handleRollDice} />
          </div>
          <button
              onClick={handleRollDice}
              disabled={isRolling}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isRolling ? "Rolling..." : "Roll Dice"}
          </button>
        </div>
      </div>
  )
}