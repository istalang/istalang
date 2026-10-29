/**
 * What a `import` place offers. Inside an import.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerImport(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
