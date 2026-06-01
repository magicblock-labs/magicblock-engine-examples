import { generateKeyPair, createKeyPairFromPrivateKeyBytes, createKeyPairFromBytes, Address, createSolanaRpc, createSolanaRpcSubscriptions, airdropFactory, lamports, getAddressFromPublicKey, address} from "@solana/kit"
import * as fs from 'fs'

import dotenv from 'dotenv'
dotenv.config()

// Initialize Keypair for SOL
export async function initializeSolSignerKeypair() : Promise<ReturnType<typeof createKeyPairFromPrivateKeyBytes>> {

    if (!process.env.PRIVATE_KEY) {

        const { privateKey, publicKey } = await generateKeyPair();
        const privateKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', privateKey));
        const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
        const keypairBytes = new Uint8Array([...privateKeyBytes, ...publicKeyBytes]);
        // Append the new key-value pair to the contents of the .env file
        console.log(`New SOL Public Key: ${await getAddressFromPublicKey(publicKey)}`)
        fs.writeFileSync('.env', `PRIVATE_KEY=${JSON.stringify(Array.from(keypairBytes))}\n`);

        const keypair = await createKeyPairFromBytes(keypairBytes)
        return keypair
    
      }
      
    const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[]
    const keypair = await createKeyPairFromBytes(
        new Uint8Array(secret),
    );
    console.log(`\rCurrent SOL Public Key: ${await getAddressFromPublicKey(keypair.publicKey)}`)

    return keypair

}

export async function airdropSolIfNeeded(rpcEndpoint: string, wsEndpoint: string,  pubkey: Address, amount: number, threshold: number = 1) {

    const SOL_PER_LAMPORTS = BigInt("1000000000");

    if (rpcEndpoint.includes('dev') || rpcEndpoint.includes('test') || rpcEndpoint.includes('local') || rpcEndpoint.includes('http://')) {

        const rpc = await createSolanaRpc(rpcEndpoint)
        const rpcSubscriptions = createSolanaRpcSubscriptions(wsEndpoint);
        const balance = (await rpc.getBalance(pubkey).send())?.value
        console.log('Current balance is', balance / SOL_PER_LAMPORTS, ' SOL','\n')
        if (balance < (BigInt(threshold) * SOL_PER_LAMPORTS)) {
            console.log(`Selected cluster: ${rpcEndpoint}`)
            console.log(`Airdropping ${amount} SOL...`)
            const airdrop = airdropFactory({ rpc, rpcSubscriptions });
            await airdrop({
                commitment: 'confirmed',
                recipientAddress: address(pubkey),
                lamports: lamports(BigInt(SOL_PER_LAMPORTS) * BigInt(amount))
            });
            console.log(`\rAirdrop of ${amount} SOL was successful.`)
        }
    }

}
