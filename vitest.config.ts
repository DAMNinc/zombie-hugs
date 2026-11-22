import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/server/**/*.test.ts', 'tests/client/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    environment: 'node',
  },
});
