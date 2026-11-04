/**
 * Pattern grammar (§3.11).
 *
 * Patterns parse as expressions do, through tables: a prefix parselet per token that starts one,
 * and the operators that extend one, at their levels: `|` between alternatives, then `..` and
 * `..=` between a range's literals. `as name` binds the whole pattern, alternatives included, so
 * `A | B as x` binds what either matched. A name may take type arguments, `Entry<S, "a">{value}`
 * or `Box<Int> as b`, which select a generic member of a union (§3.11); a pattern holds no
 * comparison, but an `is` expression around it may, so they are only read when they parse.
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

import { isUnnamed } from '../../language/naming.ts';
import type { PatternWord } from '../syntax/grammar-words.ts';
import { isComparisonOperator, operatorLevels, tighterLevel } from '../syntax/operators.ts';
import type {
  LiteralPattern,
  Pattern,
  RestPattern,
  StructPattern,
  WildcardPattern,
} from '../syntax/patterns.ts';
import type { NamedType, TypeNode } from '../syntax/types.ts';
import type { CursorKind } from './cursor/index.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';
import { type LeveledParselet, leveledGrammar } from './parts/levels.ts';
import {
  literalFrom,
  type Negatable,
  parseLiteral,
  parseNegativeLiteral,
} from './parts/literals.ts';
import { namedTypeFrom, parseQualifiedName } from './parts/names.ts';
import { afterStructKeyword } from './parts/structs.ts';
import { parseDelimited, parseGroup } from './recovery.ts';
import type { StartParselets } from './word-parselets.ts';

export function parsePattern(parser: Parser): Pattern {
  const pattern = parsePatternAt(parser, 'alternatives');
  if (parser.cursor.eat('as') === undefined) {
    return pattern;
  }
  const name = parser.identifier('a name to bind');
  return { kind: 'AsPattern', span: parser.spanFrom(parser.startOf(pattern)), pattern, name };
}

/** How a pattern starting at a token of some kind is parsed. */
type PatternParselet = (parser: Parser) => Pattern;

/** The levels pattern operators bind at, loosest first. */
const patternLevels = ['alternatives', 'range'] as const;

type PatternLevel = (typeof patternLevels)[number];

/** A minus stands before any number in a pattern, as in an expression. */
const negatableNumbers: Negatable = {
  kinds: new Set(['integer', 'float', 'duration']),
  expected: 'a number after the minus',
};

const patternParselets: Partial<Record<CursorKind, PatternParselet>> = {
  identifier: parseNamedPattern,
  struct: parseAnonymousStructPattern,
  '(': parseTuplePattern,
  '-': (parser) => literalPattern(parseNegativeLiteral(parser, negatableNumbers)),
  '[': parseArrayPattern,
  '..': parseOpenRangePattern,
  '..=': parseOpenRangePattern,
  integer: parseLiteralPattern,
  float: parseLiteralPattern,
  duration: parseLiteralPattern,
  string: parseLiteralPattern,
  true: parseLiteralPattern,
  false: parseLiteralPattern,
  none: parseLiteralPattern,
} satisfies StartParselets<PatternWord, PatternParselet>;

const infixPatternParselets: Partial<Record<CursorKind, LeveledParselet<PatternLevel, Pattern>>> = {
  '|': { level: 'alternatives', parse: parseOrPattern },
  '..': { level: 'range', parse: parseRangePattern },
  '..=': { level: 'range', parse: parseRangePattern },
};

/** A pattern whose operators all bind at least as tightly as a level. */
const parsePatternAt = leveledGrammar(patternLevels, parsePrimaryPattern, infixPatternParselets);

function parsePrimaryPattern(parser: Parser): Pattern {
  const parselet = patternParselets[parser.cursor.kind];
  return parselet === undefined ? parser.missing('a pattern') : parselet(parser);
}

/** `A | B | C`, at the first `|`: one node for every alternative. */
function parseOrPattern(parser: Parser, first: Pattern): Pattern {
  const alternatives = [first];
  while (parser.cursor.eat('|') !== undefined) {
    alternatives.push(parsePatternAt(parser, 'range'));
  }
  return { kind: 'OrPattern', span: parser.spanFrom(parser.startOf(first)), alternatives };
}

/** `[first, ...rest, last]`; a second rest is reported, since the items between would be ambiguous. */
function parseArrayPattern(parser: Parser): Pattern {
  const { start } = parser.cursor.token.span;
  const { items } = parseDelimited(parser, '[', () =>
    parser.cursor.at('...') ? parseRestPattern(parser) : parser.pattern(),
  );
  for (const extra of items.filter((item) => item.kind === 'RestPattern').slice(1)) {
    parser.report(parserDiagnostics.secondRest(parser.textSpanOf(extra.span)));
  }
  return { kind: 'ArrayPattern', span: parser.spanFrom(start), elements: items };
}

/** `...rest` or `..._` in an array pattern. */
function parseRestPattern(parser: Parser): RestPattern {
  const { start } = parser.cursor.advance().span;
  const target = parseWildcard(parser) ?? parser.identifier('a name for the rest');
  return { kind: 'RestPattern', span: parser.spanFrom(start), target };
}

/** `_`, binding nothing, when the cursor stands at it. */
function parseWildcard(parser: Parser): WildcardPattern | undefined {
  const { cursor } = parser;
  return cursor.at('identifier') && isUnnamed(parser.textOf(cursor.token))
    ? { kind: 'WildcardPattern', span: parser.anchor(cursor.advance().span) }
    : undefined;
}

/** `1..5` or `1..=5` after its start, at the operator; `5..` is open at the end. */
function parseRangePattern(parser: Parser, start: Pattern): Pattern {
  const isInclusive = parser.cursor.advance().kind === '..=';
  const end = parseRangeBound(parser, isInclusive);
  return {
    kind: 'RangePattern',
    span: parser.spanFrom(parser.startOf(start)),
    start: boundOf(parser, start),
    isInclusive,
    end,
  };
}

/** `..5` or `..=5`, open at the start, at the operator. */
function parseOpenRangePattern(parser: Parser): Pattern {
  const operator = parser.cursor.advance();
  const isInclusive = operator.kind === '..=';
  const end = parseRangeBound(parser, true);
  return {
    kind: 'RangePattern',
    span: parser.spanFrom(operator.span.start),
    start: undefined,
    isInclusive,
    end,
  };
}

/**
 * A range pattern's end: a literal, which only an exclusive range open at its end may leave out.
 */
function parseRangeBound(parser: Parser, required: boolean): LiteralPattern | undefined {
  const { kind } = parser.cursor;
  const startsLiteral = kind === '-' || literalFrom(parser, parser.cursor.token) !== undefined;
  if (!startsLiteral) {
    if (required) {
      parser.reportExpected('a literal');
    }
    return undefined;
  }
  return boundOf(parser, parsePrimaryPattern(parser));
}

/** A range's bound as a literal pattern; anything else is reported, and leaves the bound out. */
function boundOf(parser: Parser, bound: Pattern): LiteralPattern | undefined {
  if (bound.kind === 'LiteralPattern') {
    return bound;
  }
  parser.report(parserDiagnostics.rangeBound(parser.textSpanOf(bound.span)));
  return undefined;
}

function parseNamedPattern(parser: Parser): Pattern {
  const { cursor } = parser;
  const wildcard = parseWildcard(parser);
  if (wildcard !== undefined) {
    return wildcard;
  }
  const path = parseQualifiedName(parser);
  const start = parser.startOf(path[0]);
  const typeArguments = parsePatternTypeArguments(parser);
  return cursor.at('{')
    ? parseStructPattern(parser, namedTypeFrom(parser, path, typeArguments), start)
    : { kind: 'NamePattern', span: parser.spanFrom(start), path, typeArguments };
}

/**
 * `<A, B>` after a pattern's name, when its contents parse as types; otherwise none, and the `<`
 * is left to what holds the pattern, as `x is P < y` compares.
 */
function parsePatternTypeArguments(parser: Parser): readonly TypeNode[] {
  return parser.cursor.at('<') ? (parser.speculate(() => parser.typeArguments()) ?? []) : [];
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
  const start = parser.startOf(field);
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
  return literalPattern(parseLiteral(parser));
}

function literalPattern(value: LiteralPattern['value']): Pattern {
  return { kind: 'LiteralPattern', span: value.span, value };
}
