/**
 * Unit tests live beside their code; cross-phase tests and inputs live under test/. The include
 * globs encode that layout; a test file outside them never runs.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
