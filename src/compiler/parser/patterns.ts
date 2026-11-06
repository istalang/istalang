/**
 * Pattern grammar (§3.11).
 *
 * Patterns parse as expressions do, through tables: a prefix parselet per token that starts one,
 * and the operators that extend one, at their levels: `|` between alternatives, then `..` and `..=`
 * between a range's literals. A parameter's pattern (§3.3) reads through the same grammar over one
 * start more, `{`, short for `struct{`, which every pattern nested in it takes too: a grammar hands
 * each parselet its own reader of nested patterns, so no flag says where it is. `as name` binds the
 * whole pattern, alternatives included, so `A | B as x` binds what either matched. A name may take
 * type arguments, `Entry<S, "a">{value}` or `Box<Int> as b`, which select a generic member of a
 * union (§3.11); a pattern holds no comparison, but an `is` expression around it may, so they are
 * only read when they parse.
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
import {
  binaryOperators,
  isComparisonOperator,
  operatorLevels,
  tighterLevel,
} from '../syntax/operators.ts';
import type {
  LiteralPattern,
  Pattern,
  RestPattern,
  StructPattern,
  WildcardPattern,
} from '../syntax/patterns.ts';
import type { TypeNode } from '../syntax/types/index.ts';
import type { CursorKind } from './cursor/index.ts';
import { parseDelimited, parseGroup } from './cursor/recovery.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { atPostfix, continues } from './layout/item-breaks.ts';
import { nested } from './nesting.ts';
import type { Parser } from './parser.ts';
import { type LeveledParselet, leveledGrammar } from './parts/levels.ts';
import {
  literalFrom,
  type Negatable,
  parseLiteral,
  parseNegativeLiteral,
} from './parts/literals.ts';
import { namedTypeFrom, parseQualifiedName } from './parts/names.ts';
import { spreadOpener } from './parts/spreads.ts';
import { afterStructKeyword } from './parts/structs.ts';
import type { StartParselets } from './word-parselets.ts';

/** `pattern`, or `pattern as name` binding the whole when `as` follows it. */
function withAsName(parser: Parser, pattern: Pattern): Pattern {
  if (parser.cursor.eat('as') === undefined) {
    return pattern;
  }
  const name = parser.identifier('a name to bind');
  return { kind: 'AsPattern', span: parser.spanFrom(parser.startOf(pattern)), pattern, name };
}

/** A pattern standing inside another, read by the grammar of the pattern holding it. */
type NestedPattern = (parser: Parser) => Pattern;

/**
 * How a pattern starting at a token of some kind is parsed; the patterns inside it are read by
 * `nested`, so they take the same short forms as the pattern holding them.
 */
type PatternParselet = (parser: Parser, nested: NestedPattern) => Pattern;

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

/**
 * The pattern grammar over `starts`: a pattern, its alternatives, ranges and `as name`, every
 * pattern nested in it read by the same grammar, each descending a level (nesting.ts).
 */
function patternGrammar(starts: Partial<Record<CursorKind, PatternParselet>>): NestedPattern {
  const nestedPattern: NestedPattern = (parser) => nested(parser, () => pattern(parser));
  const primary = (parser: Parser): Pattern => {
    const parselet = starts[parser.cursor.kind];
    return parselet === undefined ? parser.missing('a pattern') : parselet(parser, nestedPattern);
  };
  const alternatives = (parser: Parser, first: Pattern): Pattern =>
    parseOrPattern(parser, first, (inner) => parseAt(inner, 'range'));
  const parseAt = leveledGrammar(patternLevels, primary, {
    '|': { level: 'alternatives', parse: alternatives },
    '..': { level: 'range', parse: parseRangePattern },
    '..=': { level: 'range', parse: parseRangePattern },
  } satisfies Partial<Record<CursorKind, LeveledParselet<PatternLevel, Pattern>>>);
  const pattern = (parser: Parser): Pattern => withAsName(parser, parseAt(parser, 'alternatives'));
  return pattern;
}

/** A pattern, wherever one stands (§3.11). */
export const parsePattern = patternGrammar(patternParselets);

/**
 * A parameter's pattern (§3.3), where `{…}` is short for `struct{…}`, since a `{` can start
 * nothing else there; so it is in every pattern nested in it.
 */
export const parseParameterPattern = patternGrammar({
  ...patternParselets,
  '{': (parser, inner) => parseStructPattern(parser, inner, { type: undefined, isShort: true }),
});

/** A literal, standing as a range's bound, which no grammar's short form changes. */
function parsePrimaryPattern(parser: Parser): Pattern {
  const parselet = patternParselets[parser.cursor.kind];
  return parselet === undefined ? parser.missing('a pattern') : parselet(parser, parsePattern);
}

/** `A | B | C`, at the first `|`: one node for every alternative, each read by `alternative`. */
function parseOrPattern(parser: Parser, first: Pattern, alternative: NestedPattern): Pattern {
  const alternatives = [first];
  while (parser.cursor.eat('|') !== undefined) {
    alternatives.push(alternative(parser));
  }
  return { kind: 'OrPattern', span: parser.spanFrom(parser.startOf(first)), alternatives };
}

/**
 * `[first, ...rest, last]`; a second rest is reported, since the items between would be ambiguous.
 */
function parseArrayPattern(parser: Parser, inner: NestedPattern): Pattern {
  const { start } = parser.cursor.token.span;
  const { items } = parseDelimited(parser, '[', () =>
    parser.cursor.at(spreadOpener) ? parseRestPattern(parser) : inner(parser),
  );
  for (const extra of items.filter((item) => item.kind === 'RestPattern').slice(1)) {
    parser.report(parserDiagnostics.secondRest(parser.textSpanOf(extra.span)));
  }
  return { kind: 'ArrayPattern', span: parser.spanFrom(start), elements: items };
}

/** `...rest` or `..._`, in an array or a struct pattern. */
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
 * A range pattern's end: a literal, which only an exclusive range open at its end may leave out,
 * and does where an item of the enclosing list starts on the next line.
 */
function parseRangeBound(parser: Parser, required: boolean): LiteralPattern | undefined {
  const { kind } = parser.cursor;
  const startsLiteral = kind === '-' || literalFrom(parser, parser.cursor.token) !== undefined;
  if (!(startsLiteral && (required || continues(parser)))) {
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

function parseNamedPattern(parser: Parser, inner: NestedPattern): Pattern {
  const wildcard = parseWildcard(parser);
  if (wildcard !== undefined) {
    return wildcard;
  }
  const path = parseQualifiedName(parser);
  const start = parser.startOf(path[0]);
  const typeArguments = parsePatternTypeArguments(parser);
  if (!atPostfix(parser, '{')) {
    return { kind: 'NamePattern', span: parser.spanFrom(start), path, typeArguments };
  }
  const type = namedTypeFrom(parser, path, typeArguments);
  return parseStructPattern(parser, inner, { type, isShort: false }, start);
}

/**
 * `<A, B>` after a pattern's name, when its contents parse as types and no operator follows them;
 * otherwise none, and the `<` is left to what holds the pattern, as `x is P < y` and
 * `x is P < a >> b` compare.
 */
function parsePatternTypeArguments(parser: Parser): readonly TypeNode[] {
  if (!atPostfix(parser, '<')) {
    return [];
  }
  const typeArguments = parser.speculate(() => {
    const written = parser.typeArguments();
    return continuingOperators.has(parser.cursor.kind) ? undefined : written;
  });
  return typeArguments ?? [];
}

/**
 * The operators that, after what would be a pattern's type arguments, go on with the expression
 * holding the pattern instead; `and`, `or` and `|` join patterns and conditions.
 */
const continuingOperators: ReadonlySet<string> = new Set(
  Object.keys(binaryOperators).filter((operator) => !['and', 'or', '|'].includes(operator)),
);

/** `struct{…}`, matching an anonymous struct. */
function parseAnonymousStructPattern(parser: Parser, inner: NestedPattern): Pattern {
  const { start } = parser.cursor.token.span;
  return afterStructKeyword(parser, () =>
    parseStructPattern(parser, inner, { type: undefined, isShort: false }, start),
  );
}

/**
 * The braced field tests, starting at the `{`, and the rest after them, `head` saying how the
 * pattern names its struct; from `start`, its head's, or else the `{`'s. A rest anywhere but last,
 * or a second one, is reported; the first stands as the pattern's rest, so its name still binds.
 */
function parseStructPattern(
  parser: Parser,
  inner: NestedPattern,
  head: Pick<StructPattern, 'type' | 'isShort'>,
  start = parser.cursor.token.span.start,
): Pattern {
  const { items } = parseDelimited(parser, '{', () =>
    parser.cursor.at(spreadOpener) ? parseRestPattern(parser) : parseFieldPattern(parser, inner),
  );
  const [rest, ...extra] = items.filter((item) => item.kind === 'RestPattern');
  const fieldAfter = rest !== undefined && items.slice(items.indexOf(rest)).some(isFieldItem);
  for (const misplaced of [...(fieldAfter ? [rest] : []), ...extra]) {
    parser.report(parserDiagnostics.structRestLast(parser.textSpanOf(misplaced.span)));
  }
  const fields = items.filter(isFieldItem);
  return { kind: 'StructPattern', span: parser.spanFrom(start), ...head, fields, rest };
}

function isFieldItem<Item extends { readonly kind: string }>(
  item: Item,
): item is Exclude<Item, RestPattern> {
  return item.kind !== 'RestPattern';
}

function parseFieldPattern(parser: Parser, inner: NestedPattern): StructPattern['fields'][number] {
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
    const pattern = inner(parser);
    return { kind: 'NestedFieldPattern', span: parser.spanFrom(start), field, pattern };
  }
  return { kind: 'BindFieldPattern', span: parser.spanFrom(start), field, alias: undefined };
}

/** `()`, `(a,)` and `(a, b)` are tuple patterns; `(p)` groups. */
function parseTuplePattern(parser: Parser, inner: NestedPattern): Pattern {
  return parseGroup<Pattern, Pattern>(parser, () => inner(parser), {
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
