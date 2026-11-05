/**
 * What the text of a String literal offers: the String literals a value expected there may be
 * (§2), a key naming a field among them (§3.1 Key types), written without their quotes, which the
 * literal around the cursor already has. They come from the one source of expected literals
 * (expected.ts), as a value's place offers them quoted.
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { expectedLiterals } from '../expected.ts';
import type { Place } from '../place.ts';

export function offerStringText(cursor: Cursor, place: Place): readonly Candidate[] {
  return expectedLiterals(cursor, place).flatMap((candidate) => {
    const { subject } = candidate;
    return subject.kind === 'literal' && typeof subject.type.value === 'string'
      ? [{ ...candidate, name: subject.type.value }]
      : [];
  });
}
