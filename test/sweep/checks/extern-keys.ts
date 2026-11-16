/**
 * Every key and declared type a program persists is spelled as it was frozen
 * (extern-keys.test-kit.ts); recording freezes what the programs spell, beside the std's, and keeps
 * every frozen line when it didn't run on every program. What it holds of a program is each
 * spelling.
 */

import { expect } from 'vitest';
import {
  frozenSpellings,
  persistedSpellings,
  stdSpellings,
  writeFrozenSpellings,
} from '../../../src/compiler/lowering/tables/extern-keys.test-kit.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf, recording } from '../swept.ts';

/** What the programs this process ran on spelled, when recording. */
const spelled = new Set<string>();

function spelledAsFrozen(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const spellings = persistedSpellings(compiledOf(subject).definition);
  if (recording) {
    for (const spelling of spellings) {
      spelled.add(spelling);
    }
  } else {
    expect(spellings.filter((spelling) => !frozenSpellings.has(spelling))).toEqual([]);
  }
  return spellings.length;
}

export const externKeys: Check = {
  holds: { stating: spelledAsFrozen, example: spelledAsFrozen },
  record: (everySubject) => {
    writeFrozenSpellings([...(everySubject ? stdSpellings() : frozenSpellings), ...spelled]);
  },
};
