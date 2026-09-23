import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    threads: false,
    isolate: true,
    hookTimeout: 60000,
    testTimeout: 60000,
    reporter: 'verbose',
  },
})
