import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// --host so a phone on the same network can scan the QR code and join.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // the ephemeral-rollups-sdk dynamically `import("bs58")` inside
    // getAuthToken — pre-bundle it (and the heavy statics) so the dev server
    // doesn't discover deps mid-session and serve stale optimized chunks
    include: [
      "bs58",
      "buffer",
      "@coral-xyz/anchor",
      "@solana/web3.js",
      "@magicblock-labs/ephemeral-rollups-sdk",
      "tweetnacl",
    ],
  },
  define: {
    // web3.js / anchor expect these node globals in the browser; Buffer is
    // installed in src/main.tsx.
    "process.env": {},
    global: "globalThis",
  },
});
