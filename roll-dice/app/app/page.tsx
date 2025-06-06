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
  { name: "Warrior", probability: 30, image: "/images/classes/warrior.gif" },
  { name: "Mage", probability: 30, image: "/images/classes/mage.gif" },
  { name: "Archer", probability: 30, image: "/images/classes/archer.gif", scale: 3},
  { name: "Priest", probability: 10, image: "/images/classes/priest.gif" },
]

interface CharacterStats {
  atk: number;
  def: number;
  dex: number;
  class: string;
  image: string;
  txId?: string;  // Add transaction ID to track
  scale?: number;
}

export default function CharacterGenerator() {
  const [character, setCharacter] = useState<CharacterStats>({
    atk: 0,
    def: 0,
    dex: 0,
    class: "",
    image: "/images/placeholder.jpg"
  })
  const [characterHistory, setCharacterHistory] = useState<CharacterStats[]>([])
  const [isRolling, setIsRolling] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [key, setKey] = useState(0)
  const programRef = useRef<anchor.Program | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const currentTxIdRef = useRef<string | null>(null)
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
          image: CHARACTER_CLASSES[ply.characterClass].image,
          scale: CHARACTER_CLASSES[ply.characterClass].scale
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
            const characterClass = CHARACTER_CLASSES[player.characterClass]
            const newCharacter: CharacterStats = {
              atk: player.atk,
              def: player.def,
              dex: player.dex,
              class: characterClass.name,
              image: characterClass.image,
              scale: characterClass.scale,
              txId: currentTxIdRef.current || undefined
            }
            setCharacter(newCharacter)
            
            // Only add to history if we have a transaction ID and it's not already in history
            if (currentTxIdRef.current) {
              setCharacterHistory(prev => {
                // Check if this transaction ID is already in history
                const isDuplicate = prev.some(char => char.txId === currentTxIdRef.current);
                if (isDuplicate) {
                  return prev;
                }
                return [newCharacter, ...prev];
              });
              // Clear the transaction ID after using it
              currentTxIdRef.current = null;
            }
            
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
        const roll = Math.floor(Math.random() * 100) + 1;
        const tx = await programRef.current.methods.rollDice(roll).rpc()
        console.log("Character rolled on-chain with tx:", tx)

        // Store the transaction ID in the ref
        currentTxIdRef.current = tx;

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
    <div className="flex min-h-screen bg-gray-900">
      <div className="absolute top-4 left-4 z-10">
        <SolanaAddress onBalanceChange={handleBalanceChange} />
      </div>

      <div className="flex flex-col items-center justify-center flex-grow p-8">
        <h1 className="text-3xl font-bold mb-8 text-white">Character Generator</h1>
        
        <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full border border-gray-700">
          <div className="relative w-48 h-48 mx-auto mb-6 overflow-hidden">
            <Image
              src={character.image || "/images/placeholder.jpg"}
              alt={character.class || "Character"}
              fill
              className="object-cover rounded"
              style={{ transform: `scale(${character.scale || 1.5})` }}
            />
          </div>
          
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold mb-2 text-white">{character.class}</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-700 p-3 rounded flex flex-col items-center group relative">
                <div className="relative w-8 h-8 mb-1">
                  <Image
                    src="/images/icons/atk.png"
                    alt="Attack"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-xl font-bold text-white">{character.atk}</div>
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-gray-700">
                  Attack
                </div>
              </div>
              <div className="bg-gray-700 p-3 rounded flex flex-col items-center group relative">
                <div className="relative w-8 h-8 mb-1">
                  <Image
                    src="/images/icons/def.png"
                    alt="Defense"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-xl font-bold text-white">{character.def}</div>
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-gray-700">
                  Defense
                </div>
              </div>
              <div className="bg-gray-700 p-3 rounded flex flex-col items-center group relative">
                <div className="relative w-8 h-8 mb-1">
                  <Image
                    src="/images/icons/dex.png"
                    alt="Dexterity"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-xl font-bold text-white">{character.dex}</div>
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-gray-700">
                  Dexterity
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleRollCharacter}
            disabled={isRolling || !isInitialized}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium shadow-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isRolling ? "Generating..." : !isInitialized ? "Initializing..." : "Generate Character"}
          </button>

          <button
            disabled
            className="w-full px-6 py-3 mt-3 bg-gray-700 text-gray-400 rounded-lg font-medium shadow-md cursor-not-allowed transition-colors border border-gray-600"
          >
            Mint (Coming Soon)
          </button>
        </div>
      </div>

      {/* Character History Column */}
      <div className="w-80 bg-gray-800 shadow-lg p-4 overflow-y-auto max-h-screen border-l border-gray-700">
        <h2 className="text-xl font-bold mb-4 text-white">Character History</h2>
        <div className="space-y-4">
          {characterHistory.map((char, index) => (
            <div key={index} className="bg-gray-700 rounded-lg p-4 shadow border border-gray-600">
              <div className="flex items-center space-x-4">
                <div className="relative w-16 h-16 overflow-hidden">
                  <Image
                    src={char.image || "/images/placeholder.jpg"}
                    alt={char.class}
                    fill
                    className={`object-cover ${char.scale ? `scale-[${char.scale}]` : 'scale-150'} rounded`}
                    style={{ transform: `scale(${char.scale || 1.5})` }}
                  />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-white">{char.class}</h3>
                  <div className="flex items-center space-x-2 mt-2">
                    <div className="flex items-center">
                      <div className="relative w-4 h-4 mr-1">
                        <Image
                          src="/images/icons/atk.png"
                          alt="Attack"
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span className="text-sm text-gray-300">{char.atk}</span>
                    </div>
                    <div className="flex items-center">
                      <div className="relative w-4 h-4 mr-1">
                        <Image
                          src="/images/icons/def.png"
                          alt="Defense"
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span className="text-sm text-gray-300">{char.def}</span>
                    </div>
                    <div className="flex items-center">
                      <div className="relative w-4 h-4 mr-1">
                        <Image
                          src="/images/icons/dex.png"
                          alt="Dexterity"
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span className="text-sm text-gray-300">{char.dex}</span>
                    </div>
                  </div>
                  {char.txId && (
                    <a
                      href={`https://explorer.solana.com/tx/${char.txId}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      View on Explorer
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
