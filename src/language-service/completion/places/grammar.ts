/**
 * What a `grammar` place offers. Where the grammar admits a declaration, a statement or an expression to start, or an operand to go on.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerGrammar(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
