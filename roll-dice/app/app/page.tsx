"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import SolanaAddress from "@/components/solana-address"
// @ts-ignore
import * as anchor from "@coral-xyz/anchor"
// @ts-ignore
import {Connection, Keypair, PublicKey, Transaction, VersionedTransaction} from "@solana/web3.js"
import { useToast } from "@/hooks/use-toast"
import Image from "next/image"

// Program ID for the dice game
const PROGRAM_ID = new anchor.web3.PublicKey("5AUHCWm4TzipCWK9H3EKx9JNccEA3rfNSUp4BCy2Zy2f")

// Character classes with their probabilities (must sum to 100)
const CHARACTER_CLASSES = [
  { name: "Warrior", probability: 40, image: "/placeholder.jpg" },
  { name: "Mage", probability: 30, image: "/placeholder.jpg" },
  { name: "Rogue", probability: 20, image: "/placeholder.jpg" },
  { name: "Paladin", probability: 10, image: "/placeholder.jpg" },
]

interface CharacterStats {
  atk: number;
  def: number;
  dex: number;
  class: string;
  image: string;
}

export default function CharacterGenerator() {
  const [character, setCharacter] = useState<CharacterStats>({
    atk: 0,
    def: 0,
    dex: 0,
    class: "",
    image: "/placeholder.jpg"
  })
  const [isRolling, setIsRolling] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [key, setKey] = useState(0)
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
        setCharacter({
          atk: ply.atk,
          def: ply.def,
          dex: ply.dex,
          class: CHARACTER_CLASSES[ply.characterClass].name,
          image: CHARACTER_CLASSES[ply.characterClass].image
        })
      }

      // Clean up existing subscription if it exists
      if (subscriptionIdRef.current !== null) {
        try {
          await connection.removeAccountChangeListener(subscriptionIdRef.current);
        } catch (error) {
          console.log("No existing subscription to clean up");
        }
        subscriptionIdRef.current = null;
      }

      // Subscribe to account changes
      subscriptionIdRef.current = connection.onAccountChange(
          playerPk,
          // @ts-ignore
          (accountInfo) => {
            const player = program.coder.accounts.decode("player", accountInfo.data)
            console.log("Player account changed:", player)
            setCharacter({
              atk: player.atk,
              def: player.def,
              dex: player.dex,
              class: CHARACTER_CLASSES[player.characterClass].name,
              image: CHARACTER_CLASSES[player.characterClass].image
            })
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

  const generateCharacterStats = (roll: number): CharacterStats => {
    // Determine class based on roll and probabilities
    let classIndex = 0;
    let className = "Warrior";
    
    if (roll <= 40) {
      classIndex = 0;
      className = "Warrior";
    } else if (roll <= 70) {
      classIndex = 1;
      className = "Mage";
    } else if (roll <= 90) {
      classIndex = 2;
      className = "Rogue";
    } else {
      classIndex = 3;
      className = "Paladin";
    }

    // Generate a 6-digit number for stats
    const statsRoll = Math.floor(Math.random() * 900000) + 100000;
    
    // Split the 6-digit number into three 2-digit numbers
    const atk = Math.floor(statsRoll / 10000) % 100;
    const def = Math.floor(statsRoll / 100) % 100;
    const dex = statsRoll % 100;

    return {
      atk,
      def,
      dex,
      class: className,
      image: CHARACTER_CLASSES[classIndex].image
    };
  };

  const handleRollCharacter = useCallback(async () => {
    if (isRolling || !isInitialized) return;

    setIsRolling(true)
    clearRollInterval()

    if (programRef.current) {
      try {
        // Generate a random number between 1-100
        const roll = Math.floor(Math.random() * 100) + 1;
        const tx = await programRef.current.methods.rollDice(roll).rpc()
        console.log("Character rolled on-chain with tx:", tx)

        toast({
          title: "Character Generated",
          description: `Result: TX: ${tx.slice(0, 8)}...`,
        })

        // Simulate rolling animation by changing values rapidly
        rollIntervalRef.current = setInterval(() => {
          const tempRoll = Math.floor(Math.random() * 100) + 1;
          setCharacter(generateCharacterStats(tempRoll));
        }, 100)

        // Add a timeout to stop rolling after 10 seconds if still rolling
        setTimeout(() => {
          if (isRolling) {
            console.log("Rolling timeout reached (10s), stopping animation")
            setIsRolling(false)
            clearRollInterval()
            toast({
              title: "Notice",
              description: "Character generation is taking longer than expected. Check transaction status in explorer.",
              variant: "destructive",
            })
          }
        }, 10000)

      } catch (error) {
        console.error("Error generating character:", error)
        toast({
          title: "Error",
          description: "Failed to generate character",
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
        <h1 className="text-3xl font-bold mb-8">Character Generator</h1>
        
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
          <div className="relative w-48 h-48 mx-auto mb-6">
            <Image
              src={character.image || "/placeholder.jpg"}
              alt={character.class || "Character"}
              fill
              className="object-contain"
            />
          </div>
          
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold mb-2">{character.class}</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-100 p-3 rounded">
                <div className="font-bold">ATK</div>
                <div className="text-xl">{character.atk}</div>
              </div>
              <div className="bg-gray-100 p-3 rounded">
                <div className="font-bold">DEF</div>
                <div className="text-xl">{character.def}</div>
              </div>
              <div className="bg-gray-100 p-3 rounded">
                <div className="font-bold">DEX</div>
                <div className="text-xl">{character.dex}</div>
              </div>
            </div>
          </div>

          <button
            onClick={handleRollCharacter}
            disabled={isRolling || !isInitialized}
            className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isRolling ? "Generating..." : !isInitialized ? "Initializing..." : "Generate Character"}
          </button>
        </div>
      </div>
    </div>
  )
}
