import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["tests/**/*.test.ts", "tests-magicsvm/**/*.test.ts"],
    reporters: "verbose",
  },
});
