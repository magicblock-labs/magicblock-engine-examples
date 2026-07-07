import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "@coral-xyz/anchor",
      "@coral-xyz/borsh",
      "@magicblock-labs/ephemeral-rollups-sdk",
      "@solana/spl-token",
      "@solana/web3.js",
      "bn.js",
      "bs58",
      "buffer",
    ],
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
});
