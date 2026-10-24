/**
 * Struct and variant literals (§3.1): `Pair{first: 1}`, `Pair{first}`, `Ok{42}`, `Req{...r, a: 0}`.
 *
 * The item forms are told apart by their first two tokens alone, without knowing the struct's
 * fields, as the spec requires:
 * - a name followed by `:` is a named field
 * - a bare name is the shorthand `first: first`
 * - anything else is a positional value, which must be the only item. `Ok{(x)}` is how a variable
 *   is passed positionally.
 */

import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import type { NamedType } from '../../syntax/types.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { skipStructKeyword } from '../parts/structs.ts';
import { parseDelimited } from '../recovery.ts';
import { parseSpread } from './spread.ts';

/** A struct literal's braced items, starting at the `{`; `type` is undefined for `struct{…}`. */
export function parseStructLiteralBody(
  parser: Parser,
  type: NamedType | undefined,
  start: number,
): StructLiteral {
  const { items } = parseDelimited(parser, '{', () => parseItem(parser));
  const positional = items.find((item) => item.kind === 'PositionalInitializer');
  if (positional !== undefined && items.length > 1) {
    parser.report(parserDiagnostics.positionalNotAlone(positional.span));
  }
  return { kind: 'StructLiteral', span: parser.spanFrom(start), type, items };
}

/** `struct{…}`, whose type comes from context. */
export function parseAnonymousStructLiteral(parser: Parser): Expression {
  const { start } = parser.cursor.token.span;
  return skipStructKeyword(parser) ?? parseStructLiteralBody(parser, undefined, start);
}

function parseItem(parser: Parser): StructLiteral['items'][number] {
  const { cursor } = parser;
  if (cursor.at('...')) {
    return parseSpread(parser);
  }
  const next = cursor.kindAt(1);
  if (cursor.at('identifier') && (next === ':' || next === ',' || next === '}')) {
    const name = parser.identifier();
    const value = cursor.eat(':') === undefined ? undefined : parser.expression();
    return { kind: 'FieldInitializer', span: parser.spanFrom(name.span.start), name, value };
  }
  const value = parser.expression();
  return { kind: 'PositionalInitializer', span: value.span, value };
}
