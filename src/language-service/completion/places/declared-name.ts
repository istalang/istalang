/**
 * What a `declaredName` place offers. Where a name is declared: a function, a type, a variable, a parameter, a field, a variant, a binding.
 *
 * It offers the names visible where the name being written starts, and every keyword (visible.ts).
 */

import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleCandidates } from '../visible.ts';

export function offerDeclaredName(cursor: Cursor): readonly Candidate[] {
  return visibleCandidates(cursor);
}
