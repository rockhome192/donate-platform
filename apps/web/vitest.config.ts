import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests only: pure logic that needs no database and no browser. Anything
// that touches Prisma belongs in the integration layer (DESIGN.md 11.2).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
