import { defineConfig } from 'vitest/config';

/** Unit tests only — no database. Integration tests live in `*.int.test.ts` (see vitest.integration.config.ts). */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.int.test.ts'],
  },
});
