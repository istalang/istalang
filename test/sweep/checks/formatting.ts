/**
 * `ista fmt` changes how a program reads, never what it does: the program formatted reports what
 * the original does, positions aside, and compiles to the same Definition but for where its code
 * stands (`withoutPlaces`); only when they differ anyway, as a lambda's name holds its place, do
 * both run, ending alike but for a panic's frame, which names a line. A program fmt leaves as it
 * is holds nothing. The CLI's side of `ista fmt` is test/fmt-corpus.sweep.test.ts's.
 */

import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import { diagnosticsWithoutPlaces } from '../../../src/compiler/compile.test-kit.ts';
import { withoutPlaces } from '../../../src/definition/definition.test-kit.ts';
import { formatText } from '../../../src/formatter/format.ts';
import type { Observation } from '../../golden/observation.ts';
import { compiledAt, observeCompiled } from '../../golden/pipeline/index.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf, observedOf } from '../swept.ts';

async function behavesAlike(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const text = formatText(subject.text);
  expect(text).toBeDefined();
  if (text === undefined || text === subject.text) {
    return 0;
  }
  const formatted = compiledAt(subject.directory, subject.path, text);
  if ('problem' in formatted) {
    throw new Error(`${subject.name} formatted doesn't compile: ${formatted.problem}`);
  }
  const original = compiledOf(subject);
  expect(diagnosticsWithoutPlaces(formatted.program)).toEqual(
    diagnosticsWithoutPlaces(original.program),
  );
  if (!isDeepStrictEqual(withoutPlaces(formatted.definition), withoutPlaces(original.definition))) {
    const shown = await observeCompiled(formatted.definition, { ...subject, text });
    expect(withoutFrame(shown)).toEqual(withoutFrame(await observedOf(subject)));
  }
  return 1;
}

/** `observation` but for a panic's frame. */
function withoutFrame({ ending, ...rest }: Observation): unknown {
  return { ...rest, ending: 'frame' in ending ? { panic: ending.panic } : ending };
}

export const formatting: Check = { holds: { stating: behavesAlike, example: behavesAlike } };
