import { generateKeyPair, createKeyPairFromPrivateKeyBytes, createKeyPairFromBytes, Address, createSolanaRpc, createSolanaRpcSubscriptions, airdropFactory, lamports, getAddressFromPublicKey, address, pipe, createTransactionMessage, setTransactionMessageFeePayer, appendTransactionMessageInstructions } from "@solana/kit"

import * as fs from 'fs'

import dotenv from 'dotenv'
import { Connection } from "@magicblock-labs/ephemeral-rollups-kit";
import { getTransferSolInstruction } from "@solana-program/system";
dotenv.config()

// Initialize Keypair for SOL (delegated account)
export async function initializeSolSignerKeypair() : Promise<ReturnType<typeof createKeyPairFromPrivateKeyBytes>> {

    let keypair: CryptoKeyPair
    if (!process.env.PRIVATE_KEY) {
        const { privateKey, publicKey } = await crypto.subtle.generateKey(
            'Ed25519',
            true,
            ['sign', 'verify'],
        );
        const privateKeyBytes = (new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey))).slice(-32);
        const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
        const keypairBytes = new Uint8Array([...privateKeyBytes, ...publicKeyBytes]);
        // Append the new key-value pair to the contents of the .env file
        fs.writeFileSync('.env', `PRIVATE_KEY=${JSON.stringify(Array.from(keypairBytes))}\n`);

        keypair = await createKeyPairFromBytes(keypairBytes)
        return keypair
    
    } else {
        const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[]
        keypair = await createKeyPairFromBytes(
            new Uint8Array(secret),
        );
    }
    return keypair

}

// Initialize Keypair for fee payer and signer
export async function initializeFeePayer(connection: Connection, userKeypair: CryptoKeyPair ) : Promise<ReturnType<typeof createKeyPairFromPrivateKeyBytes>> {

    let feePayerKeypair: CryptoKeyPair

    if (!process.env.FEE_PAYER_PRIVATE_KEY) {

        const { privateKey, publicKey } = await crypto.subtle.generateKey(
            'Ed25519',
            true,
            ['sign', 'verify'],
        );
        const privateKeyBytes = (new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey))).slice(-32);
        const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
        const keypairBytes = new Uint8Array([...privateKeyBytes, ...publicKeyBytes]);
        // Append the new key-value pair to the contents of the .env file
        let envContent = fs.readFileSync('.env', 'utf-8')
        envContent += `FEE_PAYER_PRIVATE_KEY=${JSON.stringify(Array.from(keypairBytes))}\n`
        fs.writeFileSync('.env', envContent);

        feePayerKeypair = await createKeyPairFromBytes(keypairBytes)    
    } else {
        const secret = JSON.parse(process.env.FEE_PAYER_PRIVATE_KEY ?? "") as number[]
        feePayerKeypair = await createKeyPairFromBytes(
            new Uint8Array(secret),
        );
    }

    // Transfer 0.1 SOL to fee payer if needed
    const userAddress = await getAddressFromPublicKey(userKeypair.publicKey);
    const feePayerAddress = await getAddressFromPublicKey(feePayerKeypair.publicKey);
    const TRANSFER_AMOUNT = 100_000_000n; // 0.1 SOL
    const userBalance = await connection.getBalance(userAddress);
    const feePayerBalance = await connection.getBalance(feePayerAddress);
    
    if (feePayerBalance < TRANSFER_AMOUNT && userBalance >= 2n * TRANSFER_AMOUNT) {
        const userSigner = await cryptoKeyPairToTransactionSigner(userKeypair);
        const transferInstruction = getTransferSolInstruction({
            source: userSigner,
            destination: feePayerAddress,
            amount: lamports(TRANSFER_AMOUNT),
        });
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            (tx) => setTransactionMessageFeePayer(userAddress, tx),
            (tx) => appendTransactionMessageInstructions([transferInstruction], tx)
        );
        await connection.sendAndConfirmTransaction(
            transactionMessage,
            [userKeypair],
            { commitment: "confirmed", skipPreflight: true }
        );
    }
    return feePayerKeypair
}

// Helper to convert CryptoKeyPair to TransactionSigner for instruction builders
export async function cryptoKeyPairToTransactionSigner(keypair: Awaited<ReturnType<typeof createKeyPairFromPrivateKeyBytes>>) {
    return {
        address: await getAddressFromPublicKey(keypair.publicKey),
        privateKey: keypair.privateKey,
    } as any; // Cast needed due to Kit's type system
}

export async function airdropSolIfNeeded(rpcEndpoint: string, wsEndpoint: string, address: Address, amount: number, threshold: number = 1) {

    const SOL_PER_LAMPORTS = BigInt("100000000");

    if (rpcEndpoint.includes('dev') || rpcEndpoint.includes('test') || rpcEndpoint.includes('local') || rpcEndpoint.includes('http://')) {

        const rpc = await createSolanaRpc(rpcEndpoint)
        const rpcSubscriptions = createSolanaRpcSubscriptions(wsEndpoint);
        const balance = (await rpc.getBalance(address).send())?.value
        console.log('Current balance is', balance / SOL_PER_LAMPORTS, ' SOL','\n')
        if (balance < (BigInt(threshold) * SOL_PER_LAMPORTS)) {
            console.log(`Selected cluster: ${rpcEndpoint}`)
            console.log(`Airdropping ${amount} SOL... to ${address}`)
            const airdrop = airdropFactory({ rpc, rpcSubscriptions });
            try {
                await airdrop({
                    commitment: 'confirmed',
                    recipientAddress: address,
                    lamports: lamports(BigInt(SOL_PER_LAMPORTS) * BigInt(amount))
                });
            } catch (e) {
                console.error('Airdrop failed:', e);
                throw e;
            }
            console.log(`\rAirdrop of ${amount} SOL was successful.`)
        }
    }

}
