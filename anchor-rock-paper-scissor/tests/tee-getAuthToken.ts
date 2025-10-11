import { Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";




export async function getAuthToken(endpoint: string, keypair: Keypair): Promise<string> {
    const challengeUrl = new URL("/auth/challenge", endpoint).toString();
    const challengeResponse = await fetch(`${challengeUrl}?pubkey=${keypair.publicKey.toString()}`);
    const { challenge } = await challengeResponse.json() as { challenge: string };
    const messageBytes = new TextEncoder().encode(challenge);
    // Sign the message
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
    const signatureString = bs58.encode(signature);
    const authUrl = new URL("/auth/login", endpoint).toString();
    const authResponse = await fetch(authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            pubkey: keypair.publicKey.toString(),
            challenge,
            signature: signatureString,
        }),
    });

  if (!authResponse.ok) {
    throw new Error(`Auth request failed: ${authResponse.statusText}`);
  }
  const data = await authResponse.json();
  return data.token;
}

export async function checkPermissionAccount(pda: string, endpoint: string = "https://tee.magicblock.app/permission") {
    const response = await fetch(`${endpoint}?pubkey=${pda}`);
    if (!response.ok) {
      throw new Error(`Permission account check failed: ${response.statusText}`);
    }
    return response;
}