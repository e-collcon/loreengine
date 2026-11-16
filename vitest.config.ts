import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    // The leak and allocation gates (spec 9.4, 9.5) call gc() between measurements.
    pool: 'forks',
    execArgv: ['--expose-gc'],
  },
});
