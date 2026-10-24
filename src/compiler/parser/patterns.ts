/**
 * Pattern grammar (§3.11).
 *
 * Inside a struct pattern's braces, the token after the field name picks the test:
 * - `as` renames the binding
 * - a comparison operator compares the field against an expression
 * - `is` matches it against a nested pattern
 * - nothing binds it under its own name
 * The compared expression is parsed one level above comparisons, so `amount > base * 2` works,
 * while a second comparison would need parentheses. `as name` after a whole pattern binds the
 * matched value; after a field it renames the field, so a field's own `as` is read first.
 */

import { isComparisonOperator, operatorLevels, tighterLevel } from '../syntax/operators.ts';
import type { Pattern, StructPattern } from '../syntax/patterns.ts';
import type { NamedType } from '../syntax/types.ts';
import type { Parser } from './parser.ts';
import { literalFrom } from './parts/literals.ts';
import { namedTypeFrom, parseQualifiedName } from './parts/names.ts';
import { afterStructKeyword } from './parts/structs.ts';
import { parseDelimited, parseGroup } from './recovery.ts';

export function parsePattern(parser: Parser): Pattern {
  const pattern = parsePrimaryPattern(parser);
  if (parser.cursor.eat('as') === undefined) {
    return pattern;
  }
  const name = parser.identifier('a name to bind');
  return { kind: 'AsPattern', span: parser.spanFrom(pattern.span.start), pattern, name };
}

function parsePrimaryPattern(parser: Parser): Pattern {
  const { cursor } = parser;
  switch (cursor.kind) {
    case 'identifier':
      return parseNamedPattern(parser);
    case 'struct':
      return parseAnonymousStructPattern(parser);
    case '(':
      return parseTuplePattern(parser);
    case '-':
      return parseNegativeLiteral(parser);
    default:
      return parseLiteralPattern(parser);
  }
}

function parseNamedPattern(parser: Parser): Pattern {
  const { cursor } = parser;
  if (parser.textOf(cursor.token) === '_') {
    return { kind: 'WildcardPattern', span: cursor.advance().span };
  }
  const path = parseQualifiedName(parser);
  const { start } = path[0].span;
  return cursor.at('{')
    ? parseStructPattern(parser, namedTypeFrom(parser, path, []), start)
    : { kind: 'NamePattern', span: parser.spanFrom(start), path };
}

/** `struct{…}`, matching an anonymous struct. */
function parseAnonymousStructPattern(parser: Parser): Pattern {
  const { start } = parser.cursor.token.span;
  return afterStructKeyword(parser, () => parseStructPattern(parser, undefined, start));
}

/** The braced field tests, starting at the `{`. */
function parseStructPattern(parser: Parser, type: NamedType | undefined, start: number): Pattern {
  const fields = parseDelimited(parser, '{', () => parseFieldPattern(parser)).items;
  return { kind: 'StructPattern', span: parser.spanFrom(start), type, fields };
}

function parseFieldPattern(parser: Parser): StructPattern['fields'][number] {
  const { cursor } = parser;
  const field = parser.identifier('a field name');
  const { start } = field.span;
  const { kind } = cursor;
  if (cursor.eat('as') !== undefined) {
    const alias = parser.identifier('a name to bind');
    return { kind: 'BindFieldPattern', span: parser.spanFrom(start), field, alias };
  }
  if (isComparisonOperator(kind)) {
    cursor.advance();
    const value = parser.expression(tighterLevel(operatorLevels.is));
    return {
      kind: 'CompareFieldPattern',
      span: parser.spanFrom(start),
      field,
      operator: kind,
      value,
    };
  }
  if (cursor.eat('is') !== undefined) {
    const pattern = parser.pattern();
    return { kind: 'NestedFieldPattern', span: parser.spanFrom(start), field, pattern };
  }
  return { kind: 'BindFieldPattern', span: parser.spanFrom(start), field, alias: undefined };
}

/** `()`, `(a,)` and `(a, b)` are tuple patterns; `(p)` groups. */
function parseTuplePattern(parser: Parser): Pattern {
  return parseGroup<Pattern, Pattern>(parser, () => parser.pattern(), {
    tuple: (span, elements) => ({ kind: 'TuplePattern', span, elements }),
    grouped: (span, pattern) => ({ kind: 'ParenthesizedPattern', span, pattern }),
  });
}

function parseLiteralPattern(parser: Parser): Pattern {
  const literal = literalFrom(parser.cursor.token);
  if (literal === undefined) {
    return parser.missing('a pattern');
  }
  parser.cursor.advance();
  return { kind: 'LiteralPattern', span: literal.span, value: literal };
}

/** `-1`: only a numeric literal may follow the minus. */
function parseNegativeLiteral(parser: Parser): Pattern {
  const { start } = parser.cursor.advance().span;
  const { kind } = parser.cursor;
  const operand =
    kind === 'integer' || kind === 'float' || kind === 'duration'
      ? literalFrom(parser.cursor.advance())
      : undefined;
  const value = operand ?? parser.missing('a number after the minus');
  const span = parser.spanFrom(start);
  return {
    kind: 'LiteralPattern',
    span,
    value: { kind: 'Unary', span, operator: '-', operand: value },
  };
}
