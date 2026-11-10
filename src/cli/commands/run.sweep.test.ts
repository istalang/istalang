/**
 * Every runnable corpus program (test/corpus/programs.ts) runs through `ista run`, in-process, and
 * must have the outcome it states, so the whole pipeline (checker, lowering, runtime, boundary)
 * is what's tested, on real time.
 */

import { describe, expect, it } from 'vitest';
import { corpusDirectory as corpus, runPrograms } from '../../../test/corpus/programs.ts';
import { ista } from '../cli.test-kit.ts';

describe('ista run', () => {
  it.each(runPrograms.filter(({ expects }) => expects === 'outcome'))(
    'prints the outcome of $name',
    async ({ name, expected }) => {
      expect(await ista(corpus, 'run', name)).toEqual({ code: 0, out: `${expected}\n`, err: '' });
    },
  );

  it.each(runPrograms.filter(({ expects }) => expects === 'panic'))(
    'reports the panic of $name with a trace of where each frame stood',
    async ({ name, expected }) => {
      const run = await ista(corpus, 'run', name);
      expect(run.code).toBe(1);
      expect(run.out).toBe('');
      expect(run.err).toMatch(
        new RegExp(`^panic: ${expected}\\n(at \\S+ \\(\\S+:\\d+:\\d+\\)\\n)+$`, 'u'),
      );
    },
  );
});
