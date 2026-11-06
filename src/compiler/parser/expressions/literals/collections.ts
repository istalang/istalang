/**
 * Bracket literals (§2, §4): arrays, maps and comprehensions.
 *
 * The syntax alone decides between array and map: a `key: value` entry, or `[:]`, makes a map. The
 * checker decides what the literal builds, since a map literal also builds any `IndexAssignable`
 * type the context expects, and `[...m]` may spread a map. The first token inside the brackets
 * tells the three shapes apart: `for` starts a comprehension, `:` before `]` is the empty map, and
 * anything else starts a list of elements or entries. A comprehension whose `in` a `...` follows
 * runs over a struct's fields (§4), as a field loop does.
 */

import type {
  Comprehension,
  Expression,
  FieldComprehension,
  MapEntry,
  MapLiteral,
  Spread,
} from '../../../syntax/expressions/index.ts';
import type { Invalid } from '../../../syntax/node.ts';
import { type AnchoredSpan, endOf } from '../../../syntax/positions.ts';
import { parseCommaSeparated, parseList } from '../../brackets/recovery.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';
import { parseFieldHeaderAfter } from '../../parts/field-headers.ts';
import { parseTargets } from '../../parts/names.ts';
import { parseSpread, spreadOpener } from '../../parts/spreads.ts';

type CollectionItem = Expression | Spread | MapEntry;

type ComprehensionParts =
  | Omit<Comprehension, 'kind' | 'span'>
  | Omit<FieldComprehension, 'kind' | 'span'>;

type Contents =
  | { readonly shape: 'comprehension'; readonly parts: ComprehensionParts }
  | { readonly shape: 'emptyMap' }
  | { readonly shape: 'list'; readonly items: readonly (CollectionItem | Invalid)[] };

/** A bracket literal, starting at the `[`. */
export function parseCollection(parser: Parser): Expression {
  const { value: contents, span } = parseList(parser, '[', () => parseContents(parser));
  switch (contents.shape) {
    case 'comprehension':
      return 'header' in contents.parts
        ? { kind: 'FieldComprehension', span, ...contents.parts }
        : { kind: 'Comprehension', span, ...contents.parts };
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
  if (parser.cursor.at(spreadOpener)) {
    return parseSpread(parser);
  }
  const key = parser.expression();
  if (parser.cursor.eat(':') === undefined) {
    return key;
  }
  const value = parser.expression();
  return { kind: 'MapEntry', span: parser.spanFrom(parser.startOf(key)), key, value };
}

function toLiteral(
  parser: Parser,
  items: readonly (CollectionItem | Invalid)[],
  span: AnchoredSpan,
): Expression {
  if (!items.some((item) => item.kind === 'MapEntry')) {
    return { kind: 'ArrayLiteral', span, elements: items.filter(isArrayItem) };
  }
  const stray = items.find((item) => !isMapItem(item));
  if (stray !== undefined) {
    parser.report(parserDiagnostics.mixedCollection(parser.textSpanOf(stray.span)));
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
  return {
    kind: 'MapEntry',
    span: item.span,
    key: item,
    value: { kind: 'Missing', span: endOf(item.span) },
  };
}

/** `for x in xs if cond: body`, or `for k, v in ...x: body`, inside the brackets. */
function parseComprehension(parser: Parser): ComprehensionParts {
  const { start } = parser.cursor.advance().span;
  const targets = parseTargets(parser);
  parser.expect('in');
  if (parser.cursor.at('...')) {
    const header = parseFieldHeaderAfter(parser, start, targets);
    parser.expect(':');
    return { header, body: parser.expression() };
  }
  const iterable = parser.expression();
  const condition = parser.cursor.eat('if') === undefined ? undefined : parser.expression();
  parser.expect(':');
  const body = parser.expression();
  return { targets, iterable, condition, body };
}
