import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Vitest config — alias mirrors tsconfig `@/* -> ./src/*`.
// The availability algorithm is a pure function over Intl (Europe/Paris) and
// has no network, so tests run in the node environment deterministically.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Stubs import.meta.env before test modules import their dependency graph.
    setupFiles: ['tests/unit/setup.ts'],
  },
});
