/**
 * What a `pattern` place offers. Where a pattern a `case` or an `is` tests is written.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerPattern(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
