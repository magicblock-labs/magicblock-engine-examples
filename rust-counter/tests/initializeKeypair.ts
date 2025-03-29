import * as web3 from '@solana/web3.js'
import * as fs from 'fs'

import dotenv from 'dotenv'
dotenv.config()

// Initialize Keypair for SOL
export function initializeSolSignerKeypair(): web3.Keypair {

    if (!process.env.PRIVATE_KEY) {
        const signer = web3.Keypair.generate()
        // Append the new key-value pair to the contents of the .env file
        console.log(`New SOL Public Key: ${signer.publicKey}`)
        fs.writeFileSync('.env', `PRIVATE_KEY=[${signer.secretKey.toString()}]\n`)
        return signer
    
      }
      
    const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[]
    const secretKey = Uint8Array.from(secret)
    const keypairFromSecretKey = web3.Keypair.fromSecretKey(secretKey)
    console.log(`\rCurrent SOL Public Key: ${keypairFromSecretKey.publicKey}`)

    return keypairFromSecretKey

}

export async function airdropSolIfNeeded(connection: web3.Connection, pubkey: web3.PublicKey, amount: number, threshold: number) {

    if (connection.rpcEndpoint.includes('dev') || connection.rpcEndpoint.includes('test')) {
        const balance = await connection.getBalance(pubkey)
        console.log('Current balance is', balance / web3.LAMPORTS_PER_SOL, ' SOL')
        if (balance < threshold * web3.LAMPORTS_PER_SOL) {
            console.log(`Airdropping ${amount} SOL...`)
            await connection.requestAirdrop(pubkey, amount * web3.LAMPORTS_PER_SOL )
            console.log(`\rAirdrop of ${amount} SOL was successful.`)
        }
    } 
    
    console.log(`Selected cluster: ${connection.rpcEndpoint}`)
    console.log('\n');

}