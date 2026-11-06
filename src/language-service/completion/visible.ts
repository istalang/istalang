/**
 * The names visible where the name being written starts (§3.4), every one or those a place keeps;
 * with every keyword after them, what a place with no list of its own offers.
 *
 * The name's start is the cursor's (cursor.ts), which counts a name spelled as a keyword so far,
 * so `in‸` on the way to `index` sees the scope `index` would.
 */

import type { Entity } from '../../compiler/binder/entities.ts';
import { keywords } from '../../compiler/syntax/tokens/index.ts';
import type { Candidate } from './candidate.ts';
import type { Cursor } from './cursor.ts';

/** The names visible at `cursor`, those `keeps` alone when given. */
export function visibleNames(
  { checker, module, name, offset }: Cursor,
  keeps: (entity: Entity) => boolean = () => true,
): readonly Candidate[] {
  return [...checker.bindings.visibleAt(module, name?.span.start ?? offset)].flatMap(
    ([named, entity]): Candidate[] =>
      keeps(entity) ? [{ name: named, subject: { kind: 'entity', entity } }] : [],
  );
}

export function visibleCandidates(cursor: Cursor): readonly Candidate[] {
  return [
    ...visibleNames(cursor),
    ...keywords.map((keyword): Candidate => ({ name: keyword, subject: { kind: 'keyword' } })),
  ];
}
