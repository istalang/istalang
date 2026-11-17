/**
 * A program lowered after others over its std, taking over the std's entries they kept
 * (src/compiler/lowering/tables/std-lowering.ts), lowers to the Definition it lowers to with
 * nothing kept: the sweep's compile, made after the subjects before it in its slice, against the
 * same checked program lowered again over a std lowering of its own.
 */

import { expect } from 'vitest';
import { checkProgram } from '../../../src/compiler/checker/check.ts';
import { mainOf } from '../../../src/compiler/compile.ts';
import { lower } from '../../../src/compiler/lowering/lower.ts';
import { StdLowering } from '../../../src/compiler/lowering/tables/std-lowering.ts';
import { encodeDefinition } from '../../../src/definition/definition.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf, encodedOf } from '../swept.ts';

function loweredAlike(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const { program, entry } = compiledOf(subject);
  const main = mainOf(program, entry);
  if (main === undefined) {
    throw new Error(`${subject.name} has no main.`);
  }
  const alone = lower(checkProgram(program), main, new StdLowering());
  expect(encodeDefinition(alone).hash).toBe(encodedOf(subject).hash);
  return 1;
}

export const stdReuse: Check = { holds: { stating: loweredAlike, example: loweredAlike } };
