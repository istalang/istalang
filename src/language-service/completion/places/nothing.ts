/**
 * What a `nothing` place offers: nothing. A comment, or the text of a string or a number, holds
 * no code, so no list opens there.
 */

import type { Candidate } from '../candidate.ts';

export function offerNothing(): readonly Candidate[] {
  return [];
}
