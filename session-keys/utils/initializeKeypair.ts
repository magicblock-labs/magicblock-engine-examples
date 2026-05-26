import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { readFileSync, writeFileSync } from 'fs'

import dotenv from 'dotenv'
dotenv.config()

// Initialize Keypair for Session Signer
export function initializeSessionSignerKeypair(): Keypair {

    let signer: Keypair

    if (!process.env.SESSION_SIGNER_PRIVATE_KEY) {
        signer = Keypair.generate()
        // Append the new key-value pair to the contents of the .env file
        writeFileSync('.env', `SESSION_SIGNER_PRIVATE_KEY=[${signer.secretKey.toString()}]\n`)
    } else {
        const secret = JSON.parse(process.env.SESSION_SIGNER_PRIVATE_KEY ?? "") as number[]
        const secretKey = Uint8Array.from(secret)
        signer = Keypair.fromSecretKey(secretKey)
    }

    return signer

}

export async function airdropSolIfNeeded(connection: Connection, pubkey: PublicKey, amount: number, threshold: number) {

    if (connection.rpcEndpoint.includes('dev') || connection.rpcEndpoint.includes('test') || connection.rpcEndpoint.includes('local') || connection.rpcEndpoint.includes('http://')) {
        const balance = await connection.getBalance(pubkey)
        console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL','\n')
        if (balance < threshold * LAMPORTS_PER_SOL) {
            console.log(`Selected cluster: ${connection.rpcEndpoint}`)
            console.log(`Airdropping ${amount} SOL... to ${pubkey.toString()}`)
            try {
                await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL)
                console.log(`\rAirdrop of ${amount} SOL was successful.`)
            } catch (e) {
                console.error('Airdrop failed:', e);
                throw e;
            }
        }
    }

}
