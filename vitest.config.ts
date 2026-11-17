/**
 * Unit tests live beside their code, the scripts' too; cross-phase tests and inputs live under
 * test/. The include globs encode that layout; a test file outside them never runs.
 *
 * Two projects split the suite for iterating. A sweep (`*.sweep.test.ts`) runs a check over the
 * whole corpus, every program, document or name, and costs seconds. `quick` is what compiler work
 * iterates on: every test but the editor's and the sweeps outside the compiler, which `slow` runs.
 * A run of every project (`npm run test:full`, `verify`) runs both.
 *
 * `quick` runs its files unisolated: the files a worker runs share one module graph, so they parse
 * and check the std modules once (`stdProgramOf`, `checkedAfterStd`) and the compiler stays JIT-warm,
 * which roughly halves the project's CPU time. Module state is therefore shared across files: a
 * test keeps nothing but what it derives from its inputs, nothing that hangs on which files ran
 * before. A sweep too long for one file runs in slices side by side (test/slices.ts).
 *
 * A test gets 20 s, not vitest's 5: suites of several worktrees run side by side, and at a load of
 * 21 on 12 cores a test takes four to five times what it takes alone. One compiling whole programs
 * case after case, and the setup a file's tests share that does (a corpus server's first check),
 * takes `wholeProgramTimeout` (src/compiler/compile.test-kit.ts). A test taking more than a third
 * of its limit under that load is made faster, sliced, or given the longer limit if it qualifies.
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
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'quick',
          isolate: false,
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
