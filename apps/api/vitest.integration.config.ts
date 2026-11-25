import { defineConfig } from 'vitest/config';

/**
 * API integration tests: real Express app + real SQL Server, against a `*_TEST` database ONLY
 * (enforced by src/test-support/db-guard.ts). Run with `npm run test:integration`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    setupFiles: ['src/test-support/setup.ts'],
    fileParallelism: false, // one shared database — keep files sequential
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
