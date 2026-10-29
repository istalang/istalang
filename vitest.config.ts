/**
 * Unit tests live beside their code; cross-phase tests and inputs live under test/. The include
 * globs encode that layout; a test file outside them never runs.
 *
 * `.ista` imports become their text through the same plugin the build uses, so tests see what the
 * package embeds. The package is built before the tests run, so the CLI's end-to-end test always
 * runs the current code.
 *
 * What a test or a benchmark imports from the build (`dist/`) Node loads itself, as an app does,
 * not the module runner, whose export getters cost a call across modules more than the call:
 * language-service/edit.bench.ts times the code that ships.
 */

import { defineConfig } from 'vitest/config';
import { istaTextPlugin } from './scripts/ista-text-plugin.ts';

export default defineConfig({
  plugins: [istaTextPlugin()],
  test: {
    globalSetup: ['scripts/build-before-tests.ts'],
    server: { deps: { external: [/\/dist\//u] } },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
