/**
 * A Definition never shows the numbers types are keyed by, which depend on what was numbered first
 * in the process: a program compiles alike however its identities were numbered before it
 * compiled, here its twin with them numbered last first (`numberBackwards`), the one compile of a
 * program the sweep makes twice, on purpose.
 */

import { expect } from 'vitest';
import { numberBackwards } from '../../../src/compiler/compile.test-kit.ts';
import { definitionFormat } from '../../../src/definition/definition.ts';
import { compiledAt } from '../../golden/pipeline/index.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, writtenOf } from '../swept.ts';

function writtenAlike(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const { directory, path, text, name } = subject;
  const twin = compiledAt(directory, path, text, numberBackwards);
  if ('problem' in twin) {
    throw new Error(`${name} numbered backwards doesn't compile: ${twin.problem}`);
  }
  expect(definitionFormat.write(twin.definition).text).toBe(writtenOf(subject));
  return 1;
}

export const numbering: Check = { holds: { stating: writtenAlike, example: writtenAlike } };
