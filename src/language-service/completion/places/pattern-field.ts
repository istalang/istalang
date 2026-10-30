/**
 * What a `patternField` place offers: where a struct pattern's item names its field (§3.11), the
 * fields of the variant or struct the pattern names (matched-type.ts) that its other items don't
 * test yet. A pattern has no positional items, so nothing else may stand there.
 */

import type { StructPattern } from '../../../compiler/syntax/patterns.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { fieldsMatchedBy } from './matched-type.ts';

type PatternFieldPlace = Extract<ParsedPlace, { readonly kind: 'patternField' }>;

export function offerPatternFields(
  cursor: Cursor,
  { parsed }: PatternFieldPlace,
): readonly Candidate[] {
  const { chain } = parsed;
  const pattern = chain.findLast((node): node is StructPattern => node.kind === 'StructPattern');
  if (pattern === undefined) {
    return [];
  }
  const item = chain[chain.indexOf(pattern) + 1];
  const tested = new Set(
    pattern.fields.flatMap((each) =>
      each === item || each.kind === 'Invalid' ? [] : [each.field.text],
    ),
  );
  return fieldsMatchedBy(cursor, parsed, pattern)
    .filter(({ name }) => !tested.has(name))
    .map((field): Candidate => ({ name: field.name, subject: { kind: 'field', field } }));
}
