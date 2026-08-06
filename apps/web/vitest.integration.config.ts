import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Integration tests — the ones that need a real Postgres (DESIGN.md 11.2).
 *
 * Kept in a second config rather than folded into `vitest.config.ts` so the
 * unit suite stays what it says it is: pure logic, no database, runnable on a
 * clean checkout with no environment at all. `pnpm test` must never start
 * needing a connection string.
 *
 * These tests skip themselves when no database URL is present, so running this
 * config without one passes vacuously and prints why.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__integration__/**/*.int.test.ts'],
    // A round trip to Neon is far slower than the 5s default, and the seeding
    // transaction makes several.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One connection, one transaction at a time. Parallel files would each open
    // their own pool against the same demo database for no gain.
    fileParallelism: false,
  },
})
