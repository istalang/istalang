/**
 * The characters whose typing asks for completion, and where each opens a list. A trigger opens
 * one only where its character starts what the list completes: `.` a member or an import path's
 * segment, not a range's `..`; `>` only as the end of a `->`, not a comparison or a type argument
 * list's close; `{` and `,` a list of names (a literal's or a pattern's fields, an annotation's,
 * a call's arguments, an import's), not a block, a collection or a parameter list; `@` an
 * annotation; a quote or `/` an import's path. Anywhere else such a request is answered with
 * nothing, so the list stays closed.
 *
 * A space is a trigger so that one typed after `{`, `,` or a field's `: ` keeps the list open, as
 * VS Code closes it on any other character that is neither a word's nor a trigger; it opens where
 * the punctuation before it would have, and after a `:` only at a value labelled by a field's or
 * an argument's name, so a space anywhere else stays silent. `:` itself is no trigger: accepting a
 * field or an argument writes `name: ` and asks again, and a list opened by `:` would close on the
 * space typed after it.
 */

import { type Cursor, touchingBefore } from './cursor.ts';
import type { Place, PlaceKind } from './place.ts';

/** Whether typing a trigger character at `cursor`, in `place`, opens a list there. */
type Opening = (cursor: Cursor, place: Place) => boolean;

const at =
  (...kinds: readonly PlaceKind[]): Opening =>
  (_cursor, place) =>
    kinds.includes(place.kind);

const writesArrow: Opening = (cursor, place) =>
  touchingBefore(cursor)?.kind === '->' && at('member', 'type')(cursor, place);

/** Nodes whose `value` follows a name and its `:`: a literal's field, a pattern's, an argument. */
const labelling: ReadonlySet<string> = new Set([
  'FieldInitializer',
  'CompareFieldPattern',
  'NamedArgument',
]);

/** The cursor starts a value right after the `name:` labelling it, as in `Pair{first: ‸`. */
function startsLabelledValue(place: Place): boolean {
  if (!('parsed' in place)) {
    return false;
  }
  const [holder, value] = place.parsed.chain.slice(-2);
  return (
    holder !== undefined &&
    labelling.has(holder.kind) &&
    'value' in holder &&
    holder.value === value
  );
}

/** A space after `{` or `,` opens where that character does; after a `:`, at a labelled value. */
const goesOn: Opening = (cursor, place) => {
  const punctuation = cursor.before?.kind;
  if (punctuation === ':') {
    return startsLabelledValue(place);
  }
  return (
    (punctuation === '{' || punctuation === ',') &&
    (opens.get(punctuation)?.(cursor, place) ?? false)
  );
};

const opens: ReadonlyMap<string, Opening> = new Map<string, Opening>([
  ['.', at('member', 'import')],
  ['>', writesArrow],
  ['{', at('literalField', 'pattern', 'annotation')],
  [',', at('literalField', 'pattern', 'annotation', 'callArgument', 'import')],
  [' ', goesOn],
  ['@', at('annotation')],
  ["'", at('import')],
  ['"', at('import')],
  ['/', at('import')],
]);

/** What the editor is told to ask on. */
export const completionTriggers: readonly string[] = [...opens.keys()];

/** Whether the request at `cursor` opens a list in `place`: invoking always does. */
export function opensAt(cursor: Cursor, place: Place): boolean {
  const opening = cursor.trigger === undefined ? undefined : opens.get(cursor.trigger);
  return opening?.(cursor, place) ?? true;
}
