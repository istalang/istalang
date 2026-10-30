/**
 * A literal field's place: where a struct or variant literal's item names its field, the fields
 * the literal builds that its other items don't give (§3.1); none for a literal checking found no
 * declared fields for.
 *
 * Right after its `{`, a literal building one field also takes that field's value without its name
 * (§3.1), so a value may stand there too, and the visible names are offered beside the field when
 * completion is invoked, bare variants aside, as no enum is expected of a name there; typing the
 * `{` asks for fields alone. A visible variable named like a field
 * not given yet is offered too, as the shorthand writing both (`Pair{first}`); the leading spread
 * only where it may stand, as the first item.
 */

import type { FieldsLiteral } from '../../../compiler/syntax/expressions/index.ts';
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
  const given = new Set(
    literal.items.flatMap((each) =>
      each !== item && each.kind === 'FieldInitializer' ? [each.name.text] : [],
    ),
  );
  const visible = visibleCandidates(cursor);
  const offered = fields
    .filter(({ name }) => !given.has(name))
    .flatMap((field): readonly Candidate[] => [
      ...shorthandFor(visible, field.name),
      { name: field.name, subject: { kind: 'field', field } },
    ]);
  const startsItems = opens && fields.length > 0 && literal.items.every((each) => each === item);
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
