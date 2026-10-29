/**
 * The characters whose typing asks for completion, and the places each opens a list in: typing
 * `.` asks wherever it is typed, while a `>` asks only where it writes a member's `->`, not a
 * comparison, and a `{` or `,` only in a struct literal, not a block, a call or a collection.
 * Anywhere else such a request is answered with nothing, so the list stays closed.
 */

import type { PlaceKind } from './place.ts';

type Opening = 'anywhere' | readonly PlaceKind[];

const opens: ReadonlyMap<string, Opening> = new Map<string, Opening>([
  ['.', 'anywhere'],
  ['>', ['member']],
  ['{', ['literalField']],
  [',', ['literalField']],
]);

/** What the editor is told to ask on. */
export const completionTriggers: readonly string[] = [...opens.keys()];

/** Whether typing `trigger` asks for a list at a place of kind `place`; invoking always does. */
export function opensAt(trigger: string | undefined, place: PlaceKind): boolean {
  const kinds = (trigger === undefined ? undefined : opens.get(trigger)) ?? 'anywhere';
  return kinds === 'anywhere' || kinds.includes(place);
}
