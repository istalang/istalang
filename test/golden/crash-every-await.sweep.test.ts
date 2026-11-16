/**
 * Every golden program shows the same with its contexts crashing at every await (§10): each segment
 * runs again from the instance as it last committed, read back from its snapshot into a second
 * build of the same Definition, its functions emitted in a shuffled order into a fresh module, a
 * new order at every read-back (docs/work/ir-first/contracts.md, "Typed-IR gate"). So what a program
 * shows then is what committing and restoring keep, its suspended frames spilled and restored
 * included, whichever build commits and whichever restores (docs/work/ir-first/design.md,
 * "Verification"). It stands for the cross-check of two backends, gone with the interpreter
 * (docs/work/ir-first/coverage.md).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EmittedProgram, emitProgram } from '../../src/codegen/emit.ts';
import type { Definition } from '../../src/definition/definition.ts';
import { observeProgram } from './pipeline.ts';
import { defectsGroup, type ProgramSubject, subjectGroups } from './subjects.ts';

/** A subject run past a unit test's time: the supplier demo compiles for seconds. */
const subjectTimeout = 120_000;

/** Every program held to what it states: a defect's run shows something else already. */
const programs = [...subjectGroups]
  .filter(([group]) => group !== defectsGroup)
  .flatMap(([, subjects]) => subjects)
  .filter((subject): subject is ProgramSubject => subject.kind === 'program');

/** The runs read back into a second build: none would leave the property unexercised. */
let readBacks = 0;

/** A second build of `definition`, its functions emitted in an order of its own. */
function shuffledBuild(definition: Definition): EmittedProgram {
  readBacks += 1;
  const indexes = [...definition.functions.keys()];
  const shuffled = fc.shuffledSubarray(indexes, { minLength: indexes.length });
  const [order] = fc.sample(shuffled, { seed: readBacks, numRuns: 1 });
  return emitProgram(definition, order);
}

describe('a golden program crashing at every await, read back into another build', () => {
  it.each(programs.map((program) => [program.name, program] as const))(
    '%s shows the same',
    async (_, program) => {
      const crashing = await observeProgram(program, { crashEveryAwait: true }, shuffledBuild);
      expect(crashing).toEqual(await observeProgram(program));
    },
    subjectTimeout,
  );

  // Last, after every program: a sweep reading no run back would hold of nothing.
  it('read runs back into other builds', () => {
    expect(readBacks).toBeGreaterThan(0);
  });
});
