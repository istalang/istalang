/**
 * Every program of the run corpus, compiled by the real compiler and run through the runtime's host
 * API on a manual clock, ends as it states: with its outcome, or its panic.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../test/corpus/programs.ts';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';

describe('advancing an instance', () => {
  it.each(runPrograms)(
    'runs $name to the outcome it states',
    async ({ text, expects, expected }) => {
      const test = testRuntime();
      const program = test.runtime.deploy(compiledText(text));
      const state = await runToEnd(test, 'corpus', await program.start('corpus'));
      const ended =
        state.kind === 'finished'
          ? { expects: 'outcome', expected: state.outcome }
          : { expects: 'panic', expected: state.kind === 'panicked' ? state.message : '' };
      expect(ended).toEqual({ expects, expected });
    },
  );
});
