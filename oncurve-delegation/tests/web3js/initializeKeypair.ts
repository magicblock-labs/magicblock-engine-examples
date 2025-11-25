import * as web3 from '@solana/web3.js'
import * as fs from 'fs'

import dotenv from 'dotenv'
dotenv.config()

// Initialize Keypair for SOL (delegated account)
export function initializeSolSignerKeypair(): web3.Keypair {

    let signer: web3.Keypair

    if (!process.env.PRIVATE_KEY) {
        signer = web3.Keypair.generate()
        // Append the new key-value pair to the contents of the .env file
        fs.writeFileSync('.env', `PRIVATE_KEY=[${signer.secretKey.toString()}]\n`)
    } else {
        const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[]
        const secretKey = Uint8Array.from(secret)
        signer = web3.Keypair.fromSecretKey(secretKey)
    }

    return signer

}

// Initialize Keypair for fee payer and signer
export async function initializeFeePayer(connection: web3.Connection, userKeypair: web3.Keypair): Promise<web3.Keypair> {

    let feePayer: web3.Keypair

    if (!process.env.FEE_PAYER_PRIVATE_KEY) {
        feePayer = web3.Keypair.generate()
        // Append the new key-value pair to the contents of the .env file
        let envContent = fs.readFileSync('.env', 'utf-8')
        envContent += `FEE_PAYER_PRIVATE_KEY=[${feePayer.secretKey.toString()}]\n`
        fs.writeFileSync('.env', envContent)
    } else {
        const secret = JSON.parse(process.env.FEE_PAYER_PRIVATE_KEY ?? "") as number[]
        const secretKey = Uint8Array.from(secret)
        feePayer = web3.Keypair.fromSecretKey(secretKey)
    }

    // Transfer 0.1 SOL to fee payer if needed
    const TRANSFER_AMOUNT = 0.1 * 1_000_000_000;
    const userBalance = await connection.getBalance(userKeypair.publicKey);
    const feePayerBalance = await connection.getBalance(feePayer.publicKey);
    
    if (feePayerBalance < TRANSFER_AMOUNT && userBalance >= TRANSFER_AMOUNT * 2) {
        try {
            const transferInstruction = web3.SystemProgram.transfer({
                fromPubkey: userKeypair.publicKey,
                toPubkey: feePayer.publicKey,
                lamports: TRANSFER_AMOUNT,
            });
            const tx = new web3.Transaction().add(transferInstruction);
            await web3.sendAndConfirmTransaction(
                connection,
                tx,
                [userKeypair],
                { skipPreflight: true }
            );
            console.log(`\rTransfer of 0.1 SOL to fee payer was successful.`)
        } catch (e) {
            console.error('Transfer failed:', e);
            throw e;
        }
    }
    return feePayer
}

export async function airdropSolIfNeeded(connection: web3.Connection, pubkey: web3.PublicKey, amount: number, threshold: number) {

    if (connection.rpcEndpoint.includes('dev') || connection.rpcEndpoint.includes('test') || connection.rpcEndpoint.includes('local') || connection.rpcEndpoint.includes('http://')) {
        const balance = await connection.getBalance(pubkey)
        console.log('Current balance is', balance / web3.LAMPORTS_PER_SOL, ' SOL','\n')
        if (balance < threshold * web3.LAMPORTS_PER_SOL) {
            console.log(`Selected cluster: ${connection.rpcEndpoint}`)
            console.log(`Airdropping ${amount} SOL... to ${pubkey.toString()}`)
            try {
                await connection.requestAirdrop(pubkey, amount * web3.LAMPORTS_PER_SOL)
                console.log(`\rAirdrop of ${amount} SOL was successful.`)
            } catch (e) {
                console.error('Airdrop failed:', e);
                throw e;
            }
        }
    }

}
