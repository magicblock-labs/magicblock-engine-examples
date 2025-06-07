"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import SolanaAddress from "@/components/solana-address"
// @ts-ignore
import * as anchor from "@coral-xyz/anchor"
// @ts-ignore
import {Connection, Keypair, PublicKey, Transaction, VersionedTransaction} from "@solana/web3.js"
import Image from "next/image"

// =============================================
// Constants and Configuration
// =============================================

// Program ID for the dice game
const PROGRAM_ID = new anchor.web3.PublicKey("5AUHCWm4TzipCWK9H3EKx9JNccEA3rfNSUp4BCy2Zy2f")

// Character classes with their probabilities (must sum to 100)
const CHARACTER_CLASSES = [
  { name: "Warrior", probability: 32, image: "/images/classes/warrior.gif" },
  { name: "Mage", probability: 32, image: "/images/classes/mage.gif" },
  { name: "Archer", probability: 32, image: "/images/classes/archer.gif", scale: 3},
  { name: "Priest", probability: 4, image: "/images/classes/priest.gif" },
]

// Stat quality thresholds for character rarity
const STAT_THRESHOLDS = {
  top1Percent: 270,  
  top10Percent: 240, 
  top30Percent: 190 
}

// =============================================
// Type Definitions
// =============================================

interface CharacterStats {
  atk: number;
  def: number;
  dex: number;
  class: string;
  image: string;
  txId?: string;  // Transaction ID for on-chain verification
  scale?: number; // Optional scale factor for character images
}

// =============================================
// Utility Functions
// =============================================

/**
 * Checks if total stats meet a quality threshold
 */
const isTopStat = (atk: number, def: number, dex: number, threshold: number) => 
  (atk + def + dex) >= threshold;

/**
 * Determines the border color class based on character stats quality
 */
const getStatQualityClass = (atk: number, def: number, dex: number) => {
  if (isTopStat(atk, def, dex, STAT_THRESHOLDS.top1Percent)) return 'border-yellow-500';
  if (isTopStat(atk, def, dex, STAT_THRESHOLDS.top10Percent)) return 'border-purple-500';
  if (isTopStat(atk, def, dex, STAT_THRESHOLDS.top30Percent)) return 'border-blue-500';
  return 'border-gray-600';
};

// =============================================
// Main Component
// =============================================

/**
 * CharacterGenerator Component
 * 
 * A React component that generates random characters using Solana blockchain
 * for verifiable randomness. Each character has stats (ATK, DEF, DEX) and
 * belongs to one of four classes with different probabilities.
 * 
 * Features:
 * - On-chain character generation using MagicBlock's VRF
 * - Character history tracking
 * - Stat quality indicators
 * - Devnet wallet integration
 */

// Add this at the top of the file, after the imports
const styles = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
  }
  
  .animate-shake {
    animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
    animation-iteration-count: infinite;
  }
`;

export default function CharacterGenerator() {
  // Add this at the start of the component
  useEffect(() => {
    // Add the styles to the document
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
    
    // Cleanup
    return () => {
      document.head.removeChild(styleSheet);
    };
  }, []);

  // State management
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
  const [hasBalance, setHasBalance] = useState(false)
  const [isAirdropping, setIsAirdropping] = useState(false)

  // Refs for managing program state and subscriptions
  const programRef = useRef<anchor.Program | null>(null)
  const subscriptionIdRef = useRef<number | null>(null)
  const rollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const currentTxIdRef = useRef<string | null>(null)

  /**
   * Clears the rolling animation interval
   * Used to stop the character stat animation
   */
  const clearRollInterval = () => {
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current)
      rollIntervalRef.current = null
    }
  }

  /**
   * Initializes the Solana program connection and sets up account subscription
   * - Creates or retrieves a keypair
   * - Sets up the Anchor provider
   * - Fetches the program IDL
   * - Initializes or loads player account
   * - Sets up account change subscription
   */
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
        
        // Request airdrop for new keypair
        try {
          const signature = await connection.requestAirdrop(keypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
          await connection.confirmTransaction(signature)
          console.log("Airdrop successful:", signature)
        } catch (error) {
          console.error("Airdrop failed:", error)
        }
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
  }, [key]) // Add key as dependency to re-run when key changes

  /**
   * Handles balance changes from the Solana wallet
   * Triggers reinitialization if needed
   */
  const handleBalanceChange = useCallback((newBalance: number) => {
    console.log("Balance changed:", newBalance)
    setHasBalance(newBalance > 0)

    // If not initialized, try to initialize again or force component reload
    if (!isInitialized) {
      console.log("Not initialized, attempting to reinitialize...")

      // Option 1: Call initializeProgram again
      initializeProgram()

      // Option 2: Force component reload by changing the key
      setKey(prevKey => prevKey + 1)
    }
  }, [isInitialized])

  /**
   * Generates temporary character stats for animation
   * Used during the rolling animation phase
   */
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

  /**
   * Main function to roll a new character
   * - Triggers on-chain dice roll
   * - Manages rolling animation
   * - Updates character state
   */
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
          }
        }, 10000)

      } catch (error) {
        console.error("Error generating character:", error)
        setIsRolling(false)
        clearRollInterval()
      }
    } else {
      console.error("Program not initialized")
      setIsRolling(false)
    }
  }, [isRolling, isInitialized])

  return (
    <div className="flex min-h-screen bg-black">
      <div className="absolute top-4 left-4 z-20">
        <SolanaAddress onBalanceChange={handleBalanceChange} />
        <button
          onClick={async () => {
            if (isAirdropping) return
            setIsAirdropping(true)
            try {
              const storedKeypair = localStorage.getItem("solanaKeypair")
              if (!storedKeypair) return
              
              const secretKey = Uint8Array.from(JSON.parse(storedKeypair))
              const keypair = Keypair.fromSecretKey(secretKey)
              const connection = new Connection("https://api.devnet.solana.com", "confirmed")
              
              console.log("Requesting airdrop for:", keypair.publicKey.toString())
              const signature = await connection.requestAirdrop(
                keypair.publicKey,
                2 * anchor.web3.LAMPORTS_PER_SOL
              )
              console.log("Airdrop requested, signature:", signature)
              
              const confirmation = await connection.confirmTransaction(signature)
              if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${confirmation.value.err}`)
              }
              console.log("Airdrop successful:", signature)
            } catch (error) {
              console.error("Airdrop failed:", error)
            } finally {
              setIsAirdropping(false)
            }
          }}
          disabled={isAirdropping}
          className={`mt-2 w-full px-3 py-1 text-sm rounded transition-colors flex items-center justify-center ${
            isAirdropping 
              ? 'bg-gray-800 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isAirdropping ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Requesting...
            </>
          ) : (
            'Request Airdrop'
          )}
        </button>
      </div>

      {!hasBalance && (
        <div className="fixed inset-0 bg-black bg-opacity-95 z-10 flex items-center justify-center">
          <div className="bg-gray-900 p-8 rounded-lg shadow-lg max-w-md text-center border border-gray-800">
            <h2 className="text-2xl font-bold text-white mb-4">Welcome!</h2>
            <p className="text-gray-300 mb-6">
              A local devnet test wallet has been created! Please request airdrop on the top left to add SOL from the faucet.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center justify-center flex-grow p-8">
        <div className="mb-8 text-center">
          <div className="max-w-2xl mx-auto text-gray-300">
            <p className="mb-4">
              This is a proof of concept demonstrating MagicBlock's <a href="https://github.com/magicblock-labs/ephemeral-vrf" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">VRF(Verifiable Random Function)</a>. Each character roll is generated on-chain, 
              in a transparent and provably fair way. To learn more,
              <a href="https://github.com/magicblock-labs/ephemeral-vrf" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors"> click here</a>.
            </p>
          </div>
        </div>

        <div className={`bg-gray-900 p-16 rounded-lg shadow-lg max-w-md w-full border-2 ${getStatQualityClass(character.atk, character.def, character.dex)} ${isRolling ? 'animate-shake' : ''}`}>
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
            <h2 className={`text-2xl font-bold mb-2 ${character.class === "Priest" ? "text-orange-400" : "text-white"}`}>{character.class}</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-800 p-3 rounded flex flex-col items-center group relative border-2 border-gray-700">
                <div className="relative w-8 h-8 mb-1">
                  <Image
                    src="/images/icons/atk.png"
                    alt="Attack"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-xl font-bold text-white">{character.atk}</div>
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-gray-800">
                  Attack
                </div>
              </div>
              <div className="bg-gray-800 p-3 rounded flex flex-col items-center group relative border-2 border-gray-700">
                <div className="relative w-8 h-8 mb-1">
                  <Image
                    src="/images/icons/def.png"
                    alt="Defense"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-xl font-bold text-white">{character.def}</div>
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-gray-800">
                  Defense
                </div>
              </div>
              <div className="bg-gray-800 p-3 rounded flex flex-col items-center group relative border-2 border-gray-700">
                <div className="relative w-8 h-8 mb-1">
                  <Image
                    src="/images/icons/dex.png"
                    alt="Dexterity"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-xl font-bold text-white">{character.dex}</div>
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-gray-800">
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
            className="w-full px-6 py-3 mt-3 bg-gray-800 text-gray-400 rounded-lg font-medium shadow-md cursor-not-allowed transition-colors border border-gray-700"
          >
            Mint (Coming Soon)
          </button>
        </div>
      </div>

      {/* Character History Column */}
      <div className="w-80 bg-gray-900 shadow-lg p-4 overflow-y-auto max-h-screen border-l border-gray-800">
        <h2 className="text-xl font-bold mb-4 text-white">Character History</h2>
        <div className="space-y-4">
          {characterHistory.map((char, index) => (
            <div key={index} className={`bg-gray-800 rounded-lg p-4 shadow border-2 ${getStatQualityClass(char.atk, char.def, char.dex)} relative`}>
              {char.txId && (
                <a
                  href={`https://explorer.solana.com/tx/${char.txId}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 right-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {`${char.txId.slice(0, 4)}...${char.txId.slice(-4)}`}
                </a>
              )}
              <div className="flex items-center space-x-4">
                <div className="relative w-16 h-16 overflow-hidden">
                  <Image
                    src={char.image || "/images/placeholder.jpg"}
                    alt={char.class}
                    fill
                    className="object-cover rounded"
                    style={{ transform: `scale(${char.scale || 1.5})` }}
                  />
                </div>
                <div className="flex-1">
                  <h3 className={`font-semibold ${char.class === "Priest" ? "text-orange-400" : "text-white"}`}>{char.class}</h3>
                  <div className="flex items-center space-x-2 mt-2 font-bold">
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
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
