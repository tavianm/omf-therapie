import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Integration tests — run against a REAL PostgreSQL (docker compose service or
// CI `services: postgres`). Never part of `npm run test` (unit-only): they are
// opt-in via `npm run test:integration` and skip with an explicit reason when
// no server is reachable, so a missing local Docker cannot fail the suite.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
