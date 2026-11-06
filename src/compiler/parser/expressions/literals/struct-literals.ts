/**
 * Struct and variant literals (§3.1): `Pair{first: 1}`, `Pair{first}`, `Ok{42}`, `Req{...r, a: 0}`,
 * `struct{id, for k, v in ...rest: [k]: f(v)}`.
 *
 * The item forms are told apart by their first two tokens alone, without knowing the struct's
 * fields, as the spec requires:
 * - a name followed by `:` is a named field
 * - a bare name is the shorthand `first: first`
 * - `for` starts a struct comprehension, a field loop's header and `[key]: value`, which gives
 *   the literal's other fields itself: it is the last item, beside no spread, and its brackets
 *   hold the loop's key, so the entry never reads as a field's declaration
 * - anything else is a positional value, which must be the only item. `Ok{(x)}` is how a variable
 *   is passed positionally.
 */

import type {
  Expression,
  FieldsLiteral,
  StructComprehension,
  StructLiteral,
} from '../../../syntax/expressions/index.ts';
import { lastName } from '../../../syntax/node.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import type { NamedType } from '../../../syntax/types/index.ts';
import { parseDelimited } from '../../brackets/recovery.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { atPostfix, breakSeparatesItems } from '../../layout/item-breaks.ts';
import type { Parser } from '../../parser.ts';
import { parseFieldHeaderAfter } from '../../parts/field-headers.ts';
import { parseTargets } from '../../parts/names.ts';
import { spreadOpener } from '../../parts/spreads.ts';
import { afterStructKeyword } from '../../parts/structs.ts';
import { parseSpread } from '../spread.ts';

/** What opens a struct comprehension, the last item of a struct literal. */
export const structComprehensionOpener = 'for';

/** A struct literal's braced items, starting at the `{`; `type` is undefined for `struct{…}`. */
export function parseStructLiteralBody(
  parser: Parser,
  type: NamedType | undefined,
  start: number,
): StructLiteral {
  const items = parseItems(parser);
  return { kind: 'StructLiteral', span: parser.spanFrom(start), type, items };
}

/**
 * `new Name<T>{…}`, from `new`, a keyword only before a name (§2): a shared struct's literal
 * (§3.18). Only the literal is its operand, so `new Inbox<T>{…}.send(m)` sends to the new inbox.
 */
export function parseNew(parser: Parser): Expression {
  const { start } = parser.cursor.advance().span;
  const type = parser.type();
  if (type.kind !== 'NamedType' || !atPostfix(parser, '{')) {
    parser.report(parserDiagnostics.newWithoutLiteral(parser.textSpanFrom(start)));
    return { kind: 'Invalid', span: parser.spanFrom(start) };
  }
  const items = parseItems(parser);
  return { kind: 'NewStructLiteral', span: parser.spanFrom(start), type, items };
}

/** `struct{…}`, whose type comes from context. */
export function parseAnonymousStructLiteral(parser: Parser): Expression {
  const { start } = parser.cursor.token.span;
  return afterStructKeyword(parser, () => parseStructLiteralBody(parser, undefined, start));
}

/**
 * The braced items of a literal, from its `{`; a positional value must be the only one, and a
 * struct comprehension the last, with no spread beside it.
 */
function parseItems(parser: Parser): FieldsLiteral['items'] {
  const { items } = parseDelimited(parser, '{', () => parseItem(parser));
  const positional = items.find((item) => item.kind === 'PositionalInitializer');
  if (positional !== undefined && items.length > 1) {
    parser.report(parserDiagnostics.positionalNotAlone(parser.textSpanOf(positional.span)));
  }
  reportAfterComprehension(parser, items);
  return items;
}

/**
 * Reports what stands after a struct comprehension, or as a spread beside it: the comprehension
 * gives the literal's other fields itself, in braces and in an indented value alike (§3.1).
 */
export function reportAfterComprehension(
  parser: Parser,
  items: readonly { readonly kind: string; readonly span: AnchoredSpan }[],
): void {
  const comprehension = items.findIndex((item) => item.kind === 'StructComprehension');
  if (comprehension < 0) {
    return;
  }
  const misplaced = items.filter((item, index) => index > comprehension || item.kind === 'Spread');
  for (const item of misplaced) {
    parser.report(parserDiagnostics.structComprehensionLast(parser.textSpanOf(item.span)));
  }
}

function parseItem(parser: Parser): FieldsLiteral['items'][number] {
  const { cursor } = parser;
  if (cursor.at(spreadOpener)) {
    return parseSpread(parser);
  }
  if (cursor.at(structComprehensionOpener)) {
    return parseStructComprehension(parser);
  }
  const next = cursor.kindAt(1);
  const alone = next === ',' || next === '}' || breakSeparatesItems(parser, 1);
  if (cursor.at('identifier') && (next === ':' || alone)) {
    const name = parser.identifier();
    const value = cursor.eat(':') === undefined ? undefined : parser.expression();
    return { kind: 'FieldInitializer', span: parser.spanFrom(parser.startOf(name)), name, value };
  }
  const value = parser.expression();
  return { kind: 'PositionalInitializer', span: value.span, value };
}

/**
 * `for k, v in ...x: [k]: value`, from `for`; brackets naming anything but the loop's key are
 * reported.
 */
export function parseStructComprehension(parser: Parser): StructComprehension {
  const { start } = parser.cursor.advance().span;
  const targets = parseTargets(parser);
  parser.expect('in');
  const header = parseFieldHeaderAfter(parser, start, targets);
  parser.expect(':');
  parser.expect('[');
  const key = parser.identifier("the loop's key");
  parser.expect(']');
  parser.expect(':');
  const value = parser.expression();
  const named = header.key.kind === 'NamePattern' ? lastName(header.key.path).text : undefined;
  if (named !== key.text) {
    parser.report(parserDiagnostics.structComprehensionKey(parser.textSpanOf(key.span)));
  }
  return { kind: 'StructComprehension', span: parser.spanFrom(start), header, key, value };
}
