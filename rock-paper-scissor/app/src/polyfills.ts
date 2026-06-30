// Must be the first import of the app: web3.js / anchor / the
// ephemeral-rollups-sdk touch Buffer at module-evaluation time.
import { Buffer } from "buffer";

(window as typeof window & { Buffer: typeof Buffer }).Buffer = Buffer;
