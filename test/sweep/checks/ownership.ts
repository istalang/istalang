/**
 * The ownership verifier catches a register never let go of (ir-first design, "Verification"):
 * every leaking mutant of a program's verified code (ownership.test-kit.ts) is refused. What it
 * holds of a program is each mutant.
 */

import { expect } from 'vitest';
import { leakingMutants } from '../../../src/definition/validation/ownership.test-kit.ts';
import { ownershipIssues } from '../../../src/definition/validation/ownership.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf } from '../swept.ts';

function leaksRefused(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const mutants = leakingMutants(compiledOf(subject).definition);
  const passed = mutants.filter((mutant) => ownershipIssues(mutant).length === 0);
  expect(passed.map(({ name }) => name)).toEqual([]);
  return mutants.length;
}

export const ownership: Check = { holds: { stating: leaksRefused, example: leaksRefused } };
