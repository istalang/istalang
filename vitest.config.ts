/**
 * Unit tests live beside their code, the scripts' too; cross-phase tests and inputs live under
 * test/. The include globs encode that layout; a test file outside them never runs.
 *
 * Two projects split the suite for iterating. A sweep (`*.sweep.test.ts`) runs a check over the
 * whole corpus, every program, document or name, and costs seconds. `quick` is what compiler work
 * iterates on: every test but the editor's and the sweeps outside the compiler, which `slow` runs.
 * A run of every project (`npm run test:full`, `verify`) runs both.
 *
 * A test gets 7 s, not vitest's 5: suites of several worktrees run side by side, and a property
 * over the corpus slows past 5 s under that load. One compiling whole programs case after case
 * takes `wholeProgramTimeout` (src/compiler/compile.test-kit.ts).
 *
 * `.ista` imports become their text through the same plugin the build uses, so tests see what the
 * package embeds. The package is built before the tests run, so the CLI's end-to-end test always
 * runs the current code.
 *
 * What a test or a benchmark imports from the build (`dist/`) Node loads itself, as an app does,
 * not the module runner, whose export getters cost a call across modules more than the call:
 * editor/language-service/edit.bench.ts times the code that ships.
 */

import { configDefaults, defineConfig } from 'vitest/config';
import { istaTextPlugin } from './scripts/ista-text-plugin.ts';

const tests = ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'];

/** What `slow` runs and `quick` leaves out. */
const slowTests = [
  'src/editor/**/*.test.ts',
  'src/!(compiler)/**/*.sweep.test.ts',
  'test/**/*.sweep.test.ts',
  'scripts/**/*.sweep.test.ts',
];

export default defineConfig({
  plugins: [istaTextPlugin()],
  test: {
    globalSetup: ['scripts/build-before-tests.ts'],
    server: { deps: { external: [/\/dist\//u] } },
    testTimeout: 7000,
    projects: [
      {
        extends: true,
        test: {
          name: 'quick',
          include: tests,
          exclude: [...configDefaults.exclude, ...slowTests],
        },
      },
      {
        extends: true,
        test: {
          name: 'slow',
          include: slowTests,
          // Benchmarks are quick's, so each runs once.
          benchmark: { include: [] },
        },
      },
    ],
  },
});
