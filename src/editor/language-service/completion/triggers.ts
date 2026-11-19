/**
 * The characters whose typing asks for completion, and where each opens a list. A trigger opens
 * one only where its character starts what the list completes: `.` a member or an import path's
 * segment, not a range's `..`; `>` only as the end of a `->` or `?->`, not a comparison or a type
 * argument list's close; `@` an annotation; a quote or `/` an import's path, and `"` a String
 * literal's text where literals are expected (a key, §5.2). Anywhere else such a
 * request is answered with nothing, so the list stays closed.
 *
 * `{`, `,` and a space go on a list of names (a literal's or a pattern's fields, an annotation's,
 * a call's or a call pattern's arguments, an import's) after a `{` or `,` with nothing but spaces
 * since, not a block's, a collection's or a parameter list's; a space also opens a value right
 * after the `name:` labelling it, a field's or an argument's, and stays silent anywhere else. A space is a
 * trigger because VS Code closes a list on any character that is neither a word's nor a trigger,
 * so one typed after `, ` would close it. `:` itself is no trigger: accepting a field or an
 * argument writes `name: ` and asks again, and a list opened by `:` would close on the space
 * typed after it.
 *
 * What the tokens at the cursor decide comes first, before the place: every space typed asks,
 * and most are answered without reading the place, which parses the module again.
 */

import type { TokenKind } from '../../../compiler/syntax/tokens/index.ts';
import { adjoinsBefore, type Cursor, touchingBefore } from './cursor.ts';
import type { Place, PlaceKind } from './place.ts';

/** Whether a list opens in a place. */
type PlaceTest = (place: Place) => boolean;

/** The places a typed trigger may open a list in, read from the cursor's tokens; none if absent. */
type Opening = (cursor: Cursor) => PlaceTest | undefined;

const anyPlace: PlaceTest = () => true;

const kinds =
  (...opened: readonly PlaceKind[]): PlaceTest =>
  (place) =>
    opened.includes(place.kind);

/** A call pattern's argument starts by position, which a field's name may label (§11.3). */
const startsPatternArgument: PlaceTest = (place) => {
  if (place.kind !== 'pattern') {
    return false;
  }
  const [call, pattern] = place.parsed.chain.slice(0, -1).slice(-2);
  return call?.kind === 'VariantCallPattern' && pattern?.kind === 'NamePattern';
};

const listedNames = kinds('literalField', 'patternField', 'annotation', 'callArgument', 'import');

const nameLists: PlaceTest = (place) => listedNames(place) || startsPatternArgument(place);

const always =
  (places: PlaceTest): Opening =>
  () =>
    places;

/** `>` opens only as the end of an arrow, touching the cursor. */
const endsArrow: Opening = (cursor) => {
  const kind = touchingBefore(cursor)?.kind;
  return kind === '->' || kind === '?->' ? kinds('member', 'type') : undefined;
};

/**
 * The cursor starts a value right after the `name:` labelling it: a literal's field's or a call's
 * argument's, as in `Pair{first: ‸`, or a call pattern's argument's pattern, `Rejected(by: ‸`.
 */
const startsLabelledValue: PlaceTest = (place) => {
  if (!('parsed' in place)) {
    return false;
  }
  const { chain } = place.parsed;
  const [holder, value] = chain.slice(-2);
  const [argument, pattern] = chain.slice(0, -1).slice(-2);
  const labelsValue =
    (holder?.kind === 'FieldInitializer' || holder?.kind === 'NamedArgument') &&
    holder.value === value;
  return labelsValue || (argument?.kind === 'NamedPatternArgument' && argument.pattern === pattern);
};

/** What goes on after each token: names after `{` or `,`, a value after `:`. */
const goingOn: ReadonlyMap<TokenKind, PlaceTest> = new Map([
  ['{', nameLists],
  [',', nameLists],
  [':', startsLabelledValue],
]);

/**
 * What goes on after the token before the cursor, with only spaces between on the cursor's line:
 * not across a comment or a line break.
 */
const goesOn: Opening = (cursor) => {
  const before = cursor.name === undefined ? adjoinsBefore(cursor) : undefined;
  return before === undefined ? undefined : goingOn.get(before.kind);
};

const opens: ReadonlyMap<string, Opening> = new Map([
  ['.', always(kinds('member', 'import'))],
  ['>', endsArrow],
  ['{', goesOn],
  [',', goesOn],
  [' ', goesOn],
  ['@', always(kinds('annotation'))],
  ["'", always(kinds('import'))],
  ['"', always(kinds('import', 'stringText'))],
  ['/', always(kinds('import'))],
]);

/** What the editor is told to ask on. */
export const completionTriggers: readonly string[] = [...opens.keys()];

/**
 * The places the request at `cursor` opens a list in, or undefined where it opens none whatever
 * the place: invoking opens one anywhere.
 */
export function placesOpenedAt(cursor: Cursor): PlaceTest | undefined {
  const opening = cursor.trigger === undefined ? undefined : opens.get(cursor.trigger);
  return opening === undefined ? anyPlace : opening(cursor);
}
