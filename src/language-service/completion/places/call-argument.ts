/**
 * What a `callArgument` place offers. Where a call's argument starts, which a name may label.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerCallArgument(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
