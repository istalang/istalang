/**
 * A literal field's place: where a struct or variant literal's item names its field, the fields
 * the literal builds that its other items don't give (§3.1), by the checker's one rule of which
 * field an item gives (struct-items.ts), so a value given by position counts; none for a literal
 * checking found no declared fields for.
 *
 * Right after its `{`, a literal building one field also takes that field's value without its name
 * (§3.1), so a value may stand there too, and the visible names are offered beside the field when
 * completion is invoked, bare variants aside, as no enum is expected of a name there; typing the
 * `{` asks for fields alone. A visible variable named like a field
 * not given yet is offered too, as the shorthand writing both (`Pair{first}`); the leading spread
 * only where it may stand, as the first item.
 */

import { itemField } from '../../../compiler/checker/struct-items.ts';
import type { FieldMember } from '../../../compiler/checker/types/type.ts';
import {
  type FieldItem,
  type FieldsLiteral,
  itemName,
} from '../../../compiler/syntax/expressions/index.ts';
import type { Identifier } from '../../../compiler/syntax/node.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import { nodesAt, type SyntaxNode } from '../../../compiler/syntax/tree.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { isBareVariant } from '../expected.ts';
import { visibleCandidates } from '../visible.ts';

/**
 * Where a field's name is written in a struct or variant literal: right after the literal's own
 * `{` (`opens`) or one of its `,`, the only tokens an item follows, whatever the parser made of a
 * name half written there (`item`, the item it starts) or of a literal not closed yet.
 */
export interface LiteralFieldPlace {
  readonly kind: 'literalField';
  readonly literal: FieldsLiteral;
  readonly item: FieldsLiteral['items'][number] | undefined;
  readonly opens: boolean;
}

export function literalFieldPlaceAt({ tree, name, before }: Cursor): LiteralFieldPlace | undefined {
  if (before?.kind !== '{' && before?.kind !== ',') {
    return undefined;
  }
  const literal = nodesAt(tree, before.span.start).at(-1);
  if (!isFieldsLiteral(literal)) {
    return undefined;
  }
  const item = literal.items.find(
    ({ span }) => name !== undefined && spanIn(tree, span).start === name.span.start,
  );
  return { kind: 'literalField', literal, item, opens: before.kind === '{' };
}

function isFieldsLiteral(node: SyntaxNode | undefined): node is FieldsLiteral {
  return node?.kind === 'StructLiteral' || node?.kind === 'NewStructLiteral';
}

export function offerLiteralFields(
  cursor: Cursor,
  { literal, item, opens }: LiteralFieldPlace,
): readonly Candidate[] {
  const { checker, module } = cursor;
  const fields = checker.lookup.bodyHolding(module, literal)?.literalFieldsOf(literal) ?? [];
  const others = literal.items.flatMap((each) =>
    each !== item && isFieldItem(each) ? [itemName(each)] : [],
  );
  const first = literal.items.every((each) => each === item);
  return literalItems(cursor, { fields, others, opens, first });
}

function isFieldItem(item: FieldsLiteral['items'][number]): item is FieldItem {
  return item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer';
}

/** What a literal's item may start with, as the literal's own braces and items say. */
interface LiteralItemSlot {
  /** The fields the literal builds. */
  readonly fields: readonly FieldMember[];
  /** The name each of its other items gives its field by; undefined for one given by position. */
  readonly others: readonly (Identifier | undefined)[];
  /** Whether the item follows the literal's `{` rather than a `,`. */
  readonly opens: boolean;
  /** Whether no other item comes before it. */
  readonly first: boolean;
}

/**
 * The candidates for an item of a literal building `fields`: those its `others` don't give, each
 * after a variable that would write it as shorthand; the leading spread where the first item
 * stands; and, after the `{` of a literal building one field, invoked, the values it may take
 * unnamed.
 */
function literalItems(
  cursor: Cursor,
  { fields, others, opens, first }: LiteralItemSlot,
): readonly Candidate[] {
  const visible = visibleCandidates(cursor);
  const given = new Set(others.map((named) => fields[itemField(named, fields)]));
  const offered = fields
    .filter((field) => !given.has(field))
    .flatMap((field): readonly Candidate[] => [
      ...shorthandFor(visible, field.name),
      { name: field.name, subject: { kind: 'field', field } },
    ]);
  const startsItems = opens && first && fields.length > 0;
  const takesValue = opens && fields.length === 1 && cursor.trigger === undefined;
  const values = takesValue ? visible.filter((candidate) => !isBareVariant(candidate)) : [];
  return [...offered, ...(startsItems ? [spread] : []), ...values];
}

/** The leading spread, `...value`, which only the first item may be (§3.1). */
const spread: Candidate = { name: '...', subject: { kind: 'keyword' } };

/** A variable named like the field `name`, which writes the field as shorthand, `Pair{first}`. */
function shorthandFor(visible: readonly Candidate[], name: string): readonly Candidate[] {
  return visible.filter(
    (candidate) =>
      candidate.name === name &&
      candidate.subject.kind === 'entity' &&
      candidate.subject.entity.kind === 'variable',
  );
}
