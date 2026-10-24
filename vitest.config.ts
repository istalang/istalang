/**
 * Unit tests live beside their code; cross-phase tests and inputs live under test/. The include
 * globs encode that layout; a test file outside them never runs.
 *
 * `.ista` imports become their text through the same plugin the build uses, so tests see what the
 * package embeds. The package is built before the tests run, so the CLI's end-to-end test always
 * runs the current code.
 */

import { defineConfig } from 'vitest/config';
import { istaTextPlugin } from './scripts/ista-text-plugin.ts';

export default defineConfig({
  plugins: [istaTextPlugin()],
  test: {
    globalSetup: ['scripts/build-before-tests.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
