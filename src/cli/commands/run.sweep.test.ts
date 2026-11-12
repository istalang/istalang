/**
 * Every runnable corpus program (test/corpus/programs.ts) runs through `ista run`, in-process, and
 * must have the outcome it states, so the whole pipeline (checker, lowering, runtime, boundary)
 * is what's tested, on real time, its heaps checked by the oracle of static lifetimes.
 */

import { describe, expect, it } from 'vitest';
import { corpusDirectory as corpus, runPrograms } from '../../../test/corpus/programs.ts';
import { oracleFor } from '../../runtime/lifetimes/oracle.test-kit.ts';
import { istaChecked } from '../cli.test-kit.ts';

describe('ista run', () => {
  it.each(runPrograms.filter(({ expects }) => expects === 'outcome'))(
    'prints the outcome of $name',
    async ({ name, expected }) => {
      const oracle = oracleFor(name);
      expect(await istaChecked(oracle, corpus, 'run', name)).toEqual({
        code: 0,
        out: `${expected}\n`,
        err: '',
      });
      expect(oracle.asExpected()).toBe(true);
    },
  );

  it.each(runPrograms.filter(({ expects }) => expects === 'panic'))(
    'reports the panic of $name with a trace of where each frame stood',
    async ({ name, expected }) => {
      const oracle = oracleFor(name);
      const run = await istaChecked(oracle, corpus, 'run', name);
      expect(oracle.asExpected()).toBe(true);
      expect(run.code).toBe(1);
      expect(run.out).toBe('');
      expect(run.err).toMatch(
        new RegExp(`^panic: ${expected}\\n(at \\S+ \\(\\S+:\\d+:\\d+\\)\\n)+$`, 'u'),
      );
    },
  );
});
