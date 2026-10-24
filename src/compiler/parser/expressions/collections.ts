/**
 * Bracket literals (§2, §4): arrays, maps and comprehensions.
 *
 * The syntax alone decides between array and map: a `key: value` entry, or `[:]`, makes a map. The
 * checker decides what the literal builds, since a map literal also builds any `IndexAssignable`
 * type the context expects, and `[...m]` may spread a map. The first token inside the brackets
 * tells the three shapes apart: `for` starts a comprehension, `:` before `]` is the empty map, and
 * anything else starts a list of elements or entries.
 */

import type { Span } from '../../../text/span.ts';
import type {
  Comprehension,
  Expression,
  MapEntry,
  MapLiteral,
  Spread,
} from '../../syntax/expressions.ts';
import type { Invalid } from '../../syntax/node.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { parseTargets } from '../parts/names.ts';
import { parseCommaSeparated, parseEnclosed } from '../recovery.ts';
import { parseSpread } from './spread.ts';

type CollectionItem = Expression | Spread | MapEntry;

type ComprehensionParts = Omit<Comprehension, 'kind' | 'span'>;

type Contents =
  | { readonly shape: 'comprehension'; readonly parts: ComprehensionParts }
  | { readonly shape: 'emptyMap' }
  | { readonly shape: 'list'; readonly items: readonly (CollectionItem | Invalid)[] };

/** A bracket literal, starting at the `[`. */
export function parseCollection(parser: Parser): Expression {
  const { value: contents, span } = parseEnclosed(parser, '[', () => parseContents(parser));
  switch (contents.shape) {
    case 'comprehension':
      return { kind: 'Comprehension', span, ...contents.parts };
    case 'emptyMap':
      return { kind: 'MapLiteral', span, entries: [] };
    default:
      return toLiteral(parser, contents.items, span);
  }
}

function parseContents(parser: Parser): Contents {
  const { cursor } = parser;
  if (cursor.at('for')) {
    return { shape: 'comprehension', parts: parseComprehension(parser) };
  }
  if (cursor.at(':') && cursor.kindAt(1) === ']') {
    cursor.advance();
    return { shape: 'emptyMap' };
  }
  return { shape: 'list', items: parseCommaSeparated(parser, () => parseItem(parser)).items };
}

function parseItem(parser: Parser): CollectionItem {
  if (parser.cursor.at('...')) {
    return parseSpread(parser);
  }
  const key = parser.expression();
  if (parser.cursor.eat(':') === undefined) {
    return key;
  }
  const value = parser.expression();
  return { kind: 'MapEntry', span: parser.spanFrom(key.span.start), key, value };
}

function toLiteral(
  parser: Parser,
  items: readonly (CollectionItem | Invalid)[],
  span: Span,
): Expression {
  if (!items.some((item) => item.kind === 'MapEntry')) {
    return { kind: 'ArrayLiteral', span, elements: items.filter(isArrayItem) };
  }
  const stray = items.find((item) => !isMapItem(item));
  if (stray !== undefined) {
    parser.report(parserDiagnostics.mixedCollection(stray.span));
  }
  return { kind: 'MapLiteral', span, entries: items.map(toMapItem) };
}

function isArrayItem(item: CollectionItem | Invalid): item is Expression | Spread {
  return item.kind !== 'MapEntry';
}

function isMapItem(item: CollectionItem | Invalid): item is MapLiteral['entries'][number] {
  return item.kind === 'MapEntry' || item.kind === 'Spread' || item.kind === 'Invalid';
}

/** Keeps a stray element of a map literal as a key whose value is missing. */
function toMapItem(item: CollectionItem | Invalid): MapLiteral['entries'][number] {
  if (isMapItem(item)) {
    return item;
  }
  const { end } = item.span;
  return {
    kind: 'MapEntry',
    span: item.span,
    key: item,
    value: { kind: 'Missing', span: { start: end, end } },
  };
}

/** `for x in xs if cond: body`, inside the brackets. */
function parseComprehension(parser: Parser): ComprehensionParts {
  parser.cursor.advance();
  const targets = parseTargets(parser);
  parser.expect('in');
  const iterable = parser.expression();
  const condition = parser.cursor.eat('if') === undefined ? undefined : parser.expression();
  parser.expect(':');
  const body = parser.expression();
  return { targets, iterable, condition, body };
}
