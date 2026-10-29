/**
 * What a `annotation` place offers. An annotation's name, or what it holds.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerAnnotation(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
