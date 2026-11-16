/**
 * Every program shows the same with its contexts crashing at every await (§10): each segment runs
 * again from the instance as it last committed, read back from its snapshot into a second build of
 * the same Definition, its functions emitted in a shuffled order into a fresh module, a new order
 * at every read-back (docs/work/ir-first/contracts.md, "Typed-IR gate"). So what a program shows
 * then is what committing and restoring keep, its suspended frames spilled and restored included,
 * whichever build commits and whichever restores (docs/work/ir-first/design.md, "Verification").
 * It stands for the cross-check of two backends, gone with the interpreter
 * (docs/work/ir-first/coverage.md). What it holds of a program is each run it read back.
 */

import fc from 'fast-check';
import { expect } from 'vitest';
import { type EmittedProgram, emitProgram } from '../../../src/codegen/emit.ts';
import type { Definition } from '../../../src/definition/definition.ts';
import { observeCompiled } from '../../golden/pipeline/index.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf, observedOf } from '../swept.ts';

async function readBacksAlike(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  let readBacks = 0;
  /** A second build of `definition`, its functions emitted in an order of its own. */
  const shuffledBuild = (built: Definition): EmittedProgram => {
    readBacks += 1;
    const indexes = [...built.functions.keys()];
    const shuffled = fc.shuffledSubarray(indexes, { minLength: indexes.length });
    const [order] = fc.sample(shuffled, { seed: readBacks, numRuns: 1 });
    return emitProgram(built, order);
  };
  const { definition } = compiledOf(subject);
  const crashing = await observeCompiled(
    definition,
    subject,
    { crashEveryAwait: true },
    shuffledBuild,
  );
  expect(crashing).toEqual(await observedOf(subject));
  return readBacks;
}

export const crashEveryAwait: Check = {
  holds: { stating: readBacksAlike, example: readBacksAlike },
};
