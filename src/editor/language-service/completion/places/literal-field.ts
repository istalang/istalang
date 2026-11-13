/**
 * A literal field's place: where a struct literal's item names its field, the fields
 * the literal builds that its other items don't give (§3.1), by the checker's one rule of which
 * field an item gives (struct-items.ts), so a value given by position counts; none for a literal
 * checking found no declared fields for. An indented value's entry (§2) is the same place, read
 * through the literal checking built it as: a struct's fields, or the keys a map's key type
 * spells, quoted.
 *
 * Right after its `{`, a struct literal building one field also takes that field's value without
 * its name (§3.1), so a value may stand there too, and what an expression starts with is offered
 * beside the field when completion is invoked (grammar/expression.ts); typing the `{` asks for
 * fields alone. Braces after a variant's name build nothing, a variant
 * being built by its call (§3.11), so they offer no field. A visible variable named like a field
 * not given yet is offered too, as the shorthand writing both (`Pair{first}`); the leading spread
 * only where it may stand, as the first item.
 */

import { itemField } from '../../../../compiler/checker/surface/struct-items.ts';
import type { FieldMember, Type } from '../../../../compiler/checker/types/type/index.ts';
import { membersOf } from '../../../../compiler/checker/types/type/index.ts';
import type {
  FieldItem,
  FieldsLiteral,
  IndentedEntry,
  IndentedValue,
} from '../../../../compiler/syntax/expressions/index.ts';
import { itemName } from '../../../../compiler/syntax/expressions/readings.ts';
import type { Token } from '../../../../compiler/syntax/tokens/index.ts';
import {
  childrenOf,
  nodesAt,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { indentationAt, lineStartAt } from '../../../../foundation/text/line-map.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { visibleNames } from '../visible.ts';
import { expressionCandidates } from './grammar/expression.ts';

/**
 * Where a field's name is written in a struct literal: right after the literal's own
 * `{` (`opens`) or one of its `,`, or first on a line after one of its items, where the line break
 * separates two items as a `,` does (§2), whatever the parser made of a name half written there
 * (`item`, the item it starts) or of a literal not closed yet.
 */
export interface LiteralFieldPlace {
  readonly kind: 'literalField';
  /** The literal in braces, or the indented value, whose item or entry the cursor writes. */
  readonly literal: FieldsLiteral | IndentedValue;
  readonly item: FieldsLiteral['items'][number] | IndentedEntry | undefined;
  readonly opens: boolean;
}

export function literalFieldPlaceAt({
  tree,
  name,
  before,
  offset,
}: Cursor): LiteralFieldPlace | undefined {
  if (before === undefined) {
    return undefined;
  }
  const separated = before.kind === '{' || before.kind === ',';
  const literal = separated
    ? nodesAt(tree, before.span.start).at(-1)
    : literalWithItemBefore(tree, before, name?.span.start ?? offset);
  if (!isFieldsLiteral(literal)) {
    return indentedEntryPlaceAt(tree, before, name?.span.start ?? offset);
  }
  const item = itemAt(tree, literal.items, name?.span.start);
  return { kind: 'literalField', literal, item, opens: before.kind === '{' };
}

/** The item of `items` written at `start`, the cursor's name, if any. */
function itemAt<Item extends { readonly span: FieldsLiteral['span'] }>(
  tree: SyntaxTree,
  items: readonly Item[],
  start: number | undefined,
): Item | undefined {
  return items.find(({ span }) => start !== undefined && spanIn(tree, span).start === start);
}

/**
 * An indented value's entry starting at `start`, first on its line: of the innermost value around
 * `before` whose entries stand at that column, or, with none yet, whose block would open there, as
 * the value of a key whose `:` is `before` does, which holds no token to stand around.
 */
function indentedEntryPlaceAt(
  tree: SyntaxTree,
  before: Token,
  start: number,
): LiteralFieldPlace | undefined {
  const { text } = tree.source;
  const lineStart = lineStartAt(text, start);
  if (text.slice(lineStart, start).trim() !== '' || lineStart <= before.span.end) {
    return undefined;
  }
  const column = start - lineStart;
  const around = [...nodesAt(tree, before.span.start), ...nodesAt(tree, before.span.end)].flatMap(
    (node) => [node, ...childrenOf(tree, node)],
  );
  const value = around
    .filter((node): node is IndentedValue => node.kind === 'IndentedValue')
    .findLast((each) => {
      const [first] = each.entries;
      if (first === undefined) {
        return column > indentationAt(text, spanIn(tree, each.span).start);
      }
      const at = spanIn(tree, first.span).start;
      return at - lineStartAt(text, at) === column;
    });
  if (value === undefined) {
    return undefined;
  }
  const item = itemAt(tree, value.entries, start);
  return { kind: 'literalField', literal: value, item, opens: false };
}

/**
 * The literal one of whose items ends at `before`, where `start`, the cursor's name or the cursor,
 * stands first on a later line: the next item starts there.
 */
function literalWithItemBefore(
  tree: SyntaxTree,
  before: Token,
  start: number,
): FieldsLiteral | undefined {
  const { text } = tree.source;
  if (
    text.slice(lineStartAt(text, start), start).trim() !== '' ||
    lineStartAt(text, start) <= before.span.end
  ) {
    return undefined;
  }
  return nodesAt(tree, before.span.start)
    .filter(isFieldsLiteral)
    .findLast((literal) =>
      literal.items.some((item) => spanIn(tree, item.span).end === before.span.end),
    );
}

function isFieldsLiteral(node: SyntaxNode | undefined): node is FieldsLiteral {
  return node?.kind === 'StructLiteral' || node?.kind === 'NewStructLiteral';
}

export function offerLiteralFields(cursor: Cursor, place: LiteralFieldPlace): readonly Candidate[] {
  const { literal, item, opens } = place;
  const { checker, module } = cursor;
  const body = checker.lookup.bodyHolding(module, literal);
  const built = literal.kind === 'IndentedValue' ? body?.builtLiteralOf(literal) : literal;
  const items = literal.kind === 'IndentedValue' ? literal.entries : literal.items;
  const others = items.flatMap((each) =>
    each !== item && isFieldItem(each) ? [itemName(each)] : [],
  );
  const first = items.every((each) => each === item);
  if (built?.kind === 'MapLiteral') {
    const keys = items.flatMap((each) =>
      each !== item && each.kind === 'QuotedEntry' ? [each.key.value] : [],
    );
    return mapKeys(body?.typeOf(built), keys);
  }
  const fields =
    built === undefined || !isFieldsLiteral(built) ? [] : (body?.literalFieldsOf(built) ?? []);
  const startsItems = first && (opens || literal.kind === 'IndentedValue');
  return literalItems(cursor, place, { fields, others, startsItems });
}

function isFieldItem(item: FieldsLiteral['items'][number] | IndentedEntry): item is FieldItem {
  return item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer';
}

/**
 * The keys an indented map's key type spells (§2) that its other entries don't give: each String
 * literal among its members, quoted.
 */
function mapKeys(type: Type | undefined, given: readonly string[]): readonly Candidate[] {
  const key = type?.kind === 'nominal' ? type.arguments[0] : undefined;
  const taken = new Set(given);
  return (key === undefined ? [] : membersOf(key)).flatMap((member): readonly Candidate[] =>
    member.kind === 'literal' && typeof member.value === 'string' && !taken.has(member.value)
      ? [{ name: JSON.stringify(member.value), subject: { kind: 'literal', type: member } }]
      : [],
  );
}

/** What a literal's item may start with, as the literal's own braces and items say. */
interface LiteralItemSlot {
  /** The fields the literal builds. */
  readonly fields: readonly FieldMember[];
  /** The name each of its other items gives its field by; undefined for one given by position. */
  readonly others: readonly (Identifier | undefined)[];
  /** Whether it is the first item, where the leading spread may stand. */
  readonly startsItems: boolean;
}

/**
 * The candidates for an item of a literal building `fields`: those its `others` don't give, each
 * after a variable that would write it as shorthand; the leading spread where a struct literal's
 * first item stands; and, after the `{` of a struct literal building one field, invoked, the values
 * it may take unnamed.
 */
function literalItems(
  cursor: Cursor,
  place: LiteralFieldPlace,
  { fields, others, startsItems }: LiteralItemSlot,
): readonly Candidate[] {
  const variables = visibleNames(cursor, (entity) => entity.kind === 'variable');
  const given = new Set(others.map((named) => fields[itemField(named, fields)]));
  const offered = fields
    .filter((field) => !given.has(field))
    .flatMap((field): readonly Candidate[] => [
      ...variables.filter((variable) => variable.name === field.name),
      { name: field.name, subject: { kind: 'field', field } },
    ]);
  const takesValue = place.opens && fields.length === 1 && cursor.trigger === undefined;
  const values = takesValue ? expressionCandidates(cursor, place) : [];
  const spreads = startsItems && fields.length > 0;
  return [...offered, ...(spreads ? [spread] : []), ...values];
}

/** The leading spread, `...value`, which only the first item may be (§3.1). */
const spread: Candidate = { name: '...', subject: { kind: 'keyword' } };
