/**
 * The place a cursor is in, decided once per request: what kind of thing is written there, so
 * each kind has one provider (completion/index.ts) and the rules of one kind live together.
 *
 * Members and literal fields are read from the tree as it stands, since their providers need its
 * nodes; every other place from a parse with a placeholder name at the cursor (placeholder.ts),
 * which the place carries for its provider to read the construct around the cursor.
 * A member's place comes first, as a `.` admits nothing else.
 */

import type { Cursor } from './cursor.ts';
import { type ParsedPlace, parsedPlaceAt } from './placeholder.ts';
import { type LiteralFieldPlace, literalFieldPlaceAt } from './places/literal-field.ts';
import { type MemberPlace, memberPlaceAt } from './places/member.ts';

/**
 * - `nothing`: a comment, or the text of a string or a number;
 * - `grammar`: where the grammar admits a declaration, a statement or an expression to start, or
 *   an operand to go on: keywords and visible names;
 * - `type`: a type is written;
 * - `declaredName`: a name being declared (a function, a variable, a parameter, a field…);
 * - `member`: after a member's operator, or a qualifier's `.`;
 * - `literalField`: a struct or variant literal's item names its field;
 * - `callArgument`: a call's argument starts, which a name may label;
 * - `pattern`: a pattern tested by `case` or `is`;
 * - `import`, `annotation`: inside one.
 */
export type Place = MemberPlace | LiteralFieldPlace | ParsedPlace;

export type PlaceKind = Place['kind'];

export function placeAt(cursor: Cursor): Place {
  return memberPlaceAt(cursor) ?? literalFieldPlaceAt(cursor) ?? parsedPlaceAt(cursor);
}
