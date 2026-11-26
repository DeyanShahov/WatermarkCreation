import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    // Each file gets a fresh module registry (and therefore a fresh IndexedDB).
    isolate: true,
  },
});
