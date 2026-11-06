/**
 * What follows `is` (§3.5, §3.10): a trait, as a type names it, or a struct constraint, several
 * joined by `&`. Type parameters, a trait's associated types and a struct constraint's entries
 * all take constraints this way. A struct constraint is read only here, so it never stands where a
 * type does; `struct { … }` in a type is the shape it spells (§3.1), and an entry only a constraint
 * has (`[_]`, `name is C`) met there is read with `parseConstraintEntry`, then reported.
 */

import { isUnnamed } from '../../../../foundation/language/naming.ts';
import type {
  ConstraintNode,
  EntryField,
  FieldEntry,
  StructConstraint,
} from '../../../syntax/types/index.ts';
import { type ItemRules, parseItemEntries } from '../../layout/index.ts';
import { atPostfix, eatContinuing } from '../../layout/item-breaks.ts';
import type { Parser } from '../../parser.ts';

/** What follows `is` (§3.5): a struct constraint at `struct`, a trait's type otherwise. */
function parseConstraint(parser: Parser): ConstraintNode {
  return parser.cursor.at('struct') ? parseStructConstraint(parser) : parser.type();
}

/** `A & B` after `is`: each constraint `&` joins, at least one. */
export function parseConstraints(parser: Parser): ConstraintNode[] {
  const constraints = [parseConstraint(parser)];
  while (eatContinuing(parser, '&') !== undefined) {
    constraints.push(parseConstraint(parser));
  }
  return constraints;
}

/** `struct`, or `struct { title: String, [_] is FormNode }`, at `struct`. */
export function parseStructConstraint(parser: Parser): StructConstraint {
  const { start } = parser.cursor.advance().span;
  const entries = atPostfix(parser, '{') ? parseItemEntries(parser, entryRules).value : [];
  return { kind: 'StructConstraint', span: parser.spanFrom(start), entries };
}

const entryRules: ItemRules<FieldEntry> = {
  parseItem: parseConstraintEntry,
  separator: ',',
  annotate: undefined,
};

/** `name: Type`, `name is C`, `[_]: Type` or `[_] is C`. */
export function parseConstraintEntry(parser: Parser): FieldEntry {
  const field = parseEntryField(parser);
  const start = parser.startOf(field);
  if (parser.cursor.eat('is') !== undefined) {
    const constraints = parseConstraints(parser);
    return { kind: 'FieldConstraintEntry', span: parser.spanFrom(start), field, constraints };
  }
  const type = parser.expect(':') === undefined ? parser.placeholder() : parser.type();
  return { kind: 'FieldTypeEntry', span: parser.spanFrom(start), field, type };
}

/** A field's name, or `[_]` for every other field. */
function parseEntryField(parser: Parser): EntryField {
  const { cursor } = parser;
  const open = cursor.at('[') ? cursor.advance() : undefined;
  if (open === undefined) {
    return parser.identifier('a field name');
  }
  const underscore = parser.identifier("'_'");
  if (!isUnnamed(underscore.text)) {
    parser.reportExpected("'_'");
  }
  parser.expect(']');
  return { kind: 'OtherFields', span: parser.spanFrom(open.span.start) };
}
