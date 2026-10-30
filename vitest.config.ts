// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2,
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/dist/**/*.js'],
      reportsDirectory: '.factory/coverage',
      reporter: ['text', 'json-summary'],
    },
  },
});
