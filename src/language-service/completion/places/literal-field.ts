/**
 * A literal field's place: where a struct or variant literal's item names its field, the fields
 * the literal builds that its other items don't give (§3.1); none for a literal checking found no
 * declared fields for.
 *
 * Right after its `{`, a literal building one field also takes that field's value without its name
 * (§3.1), so a value may stand there too, and the visible names are offered beside the field when
 * completion is invoked; typing the `{` asks for fields alone.
 */

import type { FieldsLiteral } from '../../../compiler/syntax/expressions/index.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import { nodesAt, type SyntaxNode } from '../../../compiler/syntax/tree.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
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
  const offered = fields
    .filter(({ name }) => !given.has(name))
    .map((field): Candidate => ({ name: field.name, subject: { kind: 'field', field } }));
  const takesValue = opens && fields.length === 1 && cursor.trigger === undefined;
  return takesValue ? [...offered, ...visibleCandidates(cursor)] : offered;
}
