import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live alongside the component they cover; golden/integration tests live in /tests.
    include: ['**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    testTimeout: 20000,
  },
});
