import { Buffer } from "buffer";

// @solana/web3.js expects Node's Buffer. Imported first from main.tsx.
globalThis.Buffer = globalThis.Buffer ?? Buffer;
