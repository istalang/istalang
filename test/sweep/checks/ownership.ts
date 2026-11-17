/**
 * The ownership verifier catches a dropped let-go and a dropped or doubled hold (ir-first design,
 * "Verification"): every broken mutant of a program's verified code (ownership.test-kit.ts) is
 * refused. What it
 * holds of a program is each mutant, and its own code read back as bytes from a store are, which
 * validates them: encoding checks a Definition's shape alone (definition/definition.ts).
 */

import { expect } from 'vitest';
import { readDefinition } from '../../../src/definition/definition.ts';
import { brokenMutants } from '../../../src/definition/validation/ownership.test-kit.ts';
import { ownershipIssues } from '../../../src/definition/validation/ownership.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf, encodedOf } from '../swept.ts';

function mutantsRefused(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  expect(() => readDefinition(encodedOf(subject).bytes)).not.toThrow();
  const mutants = brokenMutants(compiledOf(subject).definition);
  const passed = mutants.filter(({ code }) => ownershipIssues(code).length === 0);
  expect(passed.map(({ breakage, code }) => `${breakage}: ${code.name}`)).toEqual([]);
  return mutants.length + 1;
}

export const ownership: Check = { holds: { stating: mutantsRefused, example: mutantsRefused } };
