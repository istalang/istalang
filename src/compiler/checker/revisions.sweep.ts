/**
 * A checker made after an earlier snapshot's (docs/work/m6-m7/incremental-checking.md, 7A.4): over
 * random edit sequences on corpus programs and std test modules, each revision answers every
 * module's diagnostics and every query at every node of every module the test owns as a checker
 * made afresh does. It runs in slices, the `revisions-<n>.sweep.test.ts` beside it
 * (test/slices.ts); revisions.test.ts holds the hand-written cases.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sliceOf } from '../../../test/slices.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { editedTexts, editSequences } from '../parser/edits.test-kit.ts';
import { ownModules } from '../program/program.test-kit.ts';
import { answeredBothWays, checkedRevision } from './revisions.test-kit.ts';

const sources = editedTexts.map(({ name, text }) => ({
  name,
  files: { 'main.test.ista': text },
}));

/** Registers the tests of the slice `file` (its `import.meta.url`) runs. */
export function revisionsSweepSlice(file: string): void {
  describe('a checker made after an earlier one', () => {
    describe.each(sliceOf(file).of(sources))('over $name', ({ files }) => {
      it('answers every revision as a checker made afresh', () => {
        const first = checkedRevision(stdProgramOf(files), ownModules);
        fc.assert(
          fc.property(editSequences, (edits) => {
            const { incremental, fresh } = answeredBothWays(first, {
              files,
              edited: 'main.test.ista',
              edits,
            });
            expect(incremental).toEqual(fresh);
          }),
          { numRuns: 2 },
        );
      });
    });
  });
}
