/**
 * Bracketed constructs and error recovery.
 *
 * Every bracketed construct in the grammar goes through `parseEnclosed` (or, for braces whose lines
 * matter, `parseEnclosedIn`), so trailing commas (§2), line-break rules (§2) and recovery
 * behave the same everywhere. A caller names only the opener; its closer comes from `openers`
 * (cursor.ts). The closer is consumed inside the construct's own region, so a closer on a line of
 * its own still closes it. Lists of items separated by `;` or line breaks are layout's (layout.ts).
 *
 * Recovery:
 * - It skips to the next separator, the construct's closer, or a line break.
 * - It never consumes a closer that belongs to an enclosing bracket, so one bad list can't swallow
 *   the code after it.
 * - Nested bracket groups inside skipped tokens are skipped whole.
 * - Skipped tokens become an Invalid node in the list, after one diagnostic. When the item itself
 *   already reported the problem, no second diagnostic is added.
 * Each loop iteration consumes a token or stops, so parsing always terminates.
 */

import type { Invalid } from '../syntax/node.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import { type Closer, type CursorKind, isBracketOpener, type Opener, openers } from './cursor.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';

export interface Enclosed<Value> {
  readonly value: Value;
  /** From the opener to the closer, or to the last token read if the closer is missing. */
  readonly span: AnchoredSpan;
}

export interface CommaSeparated<Item> {
  readonly items: readonly (Item | Invalid)[];
  /** Whether any comma was written, which tells `(x,)` from `(x)`. */
  readonly separated: boolean;
}

export type DelimitedList<Item> = CommaSeparated<Item> & { readonly span: AnchoredSpan };

/**
 * Parses `opener`, whatever `parseInner` reads, and the matching closer; the cursor must be at
 * `opener`. Anything left before the closer is reported and skipped.
 */
export function parseEnclosed<Value>(
  parser: Parser,
  opener: Opener,
  parseInner: () => Value,
): Enclosed<Value> {
  return parseEnclosedIn(
    parser,
    opener,
    (parse) => parser.cursor.within(opener, parse),
    parseInner,
  );
}

/**
 * `opener`, whatever `parseInner` reads, and the matching closer, inside the region `enter` opens
 * (cursor.ts): a bracket region, or the line-sensitive one of a block or entries in braces.
 */
export function parseEnclosedIn<Value>(
  parser: Parser,
  opener: Opener,
  enter: (parse: () => Value) => Value,
  parseInner: () => Value,
): Enclosed<Value> {
  const { cursor } = parser;
  const openerToken = cursor.advance();
  const { closer } = openers[opener];
  const value = enter(() => {
    const reported = parser.diagnostics.length;
    const result = parseInner();
    if (!atRegionEnd(parser)) {
      skipUnexpected(parser, reported, `'${closer}'`, [closer]);
    }
    if (cursor.eat(closer) === undefined) {
      parser.report(parserDiagnostics.unclosedBracket(openerToken.span, opener, closer));
    }
    return result;
  });
  return { value, span: parser.spanFrom(openerToken.span.start) };
}

/** `opener item, item, … closer`; the cursor must be at `opener`. */
export function parseDelimited<Item>(
  parser: Parser,
  opener: Opener,
  parseItem: () => Item,
): DelimitedList<Item> {
  const { value, span } = parseEnclosed(parser, opener, () =>
    parseCommaSeparated(parser, parseItem),
  );
  return { ...value, span };
}

/** How `parseGroup` builds what it parsed: a tuple, or a group around one item. */
export interface GroupShapes<Item, Node> {
  readonly tuple: (span: AnchoredSpan, elements: readonly (Item | Invalid)[]) => Node;
  readonly grouped: (span: AnchoredSpan, item: Item | Invalid) => Node;
}

/**
 * `(…)` of `parseItem`s: one item and no comma groups it, anything else, `()` and `(x,)` included,
 * is a tuple (§3.15). Expressions, patterns and types all read parentheses this way.
 */
export function parseGroup<Item, Node>(
  parser: Parser,
  parseItem: () => Item,
  shapes: GroupShapes<Item, Node>,
): Node {
  const list = parseDelimited(parser, '(', parseItem);
  const [only] = list.items;
  return list.items.length === 1 && !list.separated && only !== undefined
    ? shapes.grouped(list.span, only)
    : shapes.tuple(list.span, list.items);
}

/** `item, item, …` up to the current region's closer, inside `parseEnclosed`. */
export function parseCommaSeparated<Item>(
  parser: Parser,
  parseItem: () => Item,
): CommaSeparated<Item> {
  const { cursor } = parser;
  const items: (Item | Invalid)[] = [];
  let separated = false;
  while (!atRegionEnd(parser)) {
    const before = cursor.index;
    const reported = parser.diagnostics.length;
    items.push(parseItem());
    if (!(cursor.at(',') || atRegionEnd(parser))) {
      items.push(
        ...skipUnexpected(parser, reported, `',' or ${describeCloser(cursor.closer)}`, [',']),
      );
    }
    if (cursor.eat(',') === undefined || cursor.index === before) {
      break;
    }
    separated = true;
  }
  return { items, separated };
}

/**
 * After an item of a `;`- or line-separated list: reports and skips whatever stands before the
 * next `;` or the end of the region, unless an error since `reported` already explains it.
 */
export function skipToSeparator(parser: Parser, reported: number): Invalid[] {
  if (parser.cursor.at(';') || atRegionEnd(parser)) {
    return [];
  }
  const expected = `';', a line break or ${describeCloser(parser.cursor.closer)}`;
  return skipUnexpected(parser, reported, expected, [';']);
}

/** Whether the next token ends the current region: its closer, an enclosing closer, a line break, or the end. */
export function atRegionEnd(parser: Parser): boolean {
  const { cursor } = parser;
  const { kind } = cursor;
  return (
    kind === cursor.closer || kind === 'end' || kind === 'lineBreak' || cursor.closesEnclosing(kind)
  );
}

function describeCloser(closer: Closer | undefined): string {
  return closer === undefined ? 'the end' : `'${closer}'`;
}

/**
 * Reports what stands where `expected` should (unless an error since `reported` already explains
 * it) and skips it, up to one of `stops` or the end of the region. Returns the skipped tokens as an
 * Invalid node.
 */
function skipUnexpected(
  parser: Parser,
  reported: number,
  expected: string,
  stops: readonly CursorKind[],
): Invalid[] {
  if (parser.diagnostics.length === reported) {
    parser.reportExpected(expected);
  }
  return skipUntil(parser, stops);
}

/**
 * Skips tokens, a bracket group at a time, up to one of `stops` or the end of the region; returns
 * them as an Invalid node. While speculating, nothing is skipped: the attempt will be undone.
 */
export function skipUntil(parser: Parser, stops: readonly CursorKind[]): Invalid[] {
  if (parser.isSpeculating) {
    return [];
  }
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const before = cursor.index;
  while (!(stops.includes(cursor.kind) || atRegionEnd(parser))) {
    if (isBracketOpener(cursor.kind)) {
      cursor.skipGroup();
    } else {
      cursor.advance();
    }
  }
  return cursor.index === before ? [] : [{ kind: 'Invalid', span: parser.spanFrom(start) }];
}
