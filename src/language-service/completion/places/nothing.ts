/**
 * What a `nothing` place offers. A comment, or the text of a string or a number.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerNothing(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
