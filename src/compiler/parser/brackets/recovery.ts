/**
 * Bracketed constructs and error recovery.
 *
 * Every bracketed construct in the grammar goes through `parseEnclosed`, a list through `parseList`
 * (or, for braces whose lines matter, `parseEnclosedIn`), so trailing commas (§2), line-break
 * rules (§2) and recovery behave the same everywhere. A caller names only the opener; its closer
 * comes from `openers` (brackets.ts). The closer is consumed inside the construct's own region, so
 * a closer on a line of its own still closes it. A list's items are separated by `,` or by a line
 * break where layout/item-breaks.ts says one separates them; blocks, whose items line breaks
 * separate by their columns, are layout's (layout/index.ts).
 *
 * Recovery:
 * - It skips to the next separator, a line break separating a list's items, the construct's
 *   closer, or a line break ending its region.
 * - It never consumes a closer that belongs to an enclosing bracket, so one bad list can't swallow
 *   the code after it.
 * - Nested bracket groups inside skipped tokens are skipped whole.
 * - Skipped tokens become an Invalid node in the list, after one diagnostic. When the item itself
 *   already reported the problem, no second diagnostic is added.
 * Each loop iteration consumes a token or stops, so parsing always terminates.
 */

import type { Invalid } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { CursorKind } from '../cursor/index.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { breakSeparatesItems } from '../layout/item-breaks.ts';
import type { Parser } from '../parser.ts';
import {
  type BracketOpener,
  type Closer,
  isBracketOpener,
  type Opener,
  openers,
} from './brackets.ts';

export interface Enclosed<Value> {
  readonly value: Value;
  /** From the opener to the closer, or to the last token read if the closer is missing. */
  readonly span: AnchoredSpan;
}

export interface CommaSeparated<Item> {
  readonly items: readonly (Item | Invalid)[];
  /** Whether any comma was written, which tells `(x,)` from `(x)`; a line break doesn't. */
  readonly separated: boolean;
}

export type DelimitedList<Item> = CommaSeparated<Item> & { readonly span: AnchoredSpan };

/**
 * Parses `opener`, whatever `parseInner` reads, and the matching closer; the cursor must be at
 * `opener`. Anything left before the closer is reported and skipped.
 */
export function parseEnclosed<Value>(
  parser: Parser,
  opener: BracketOpener,
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
 * Parses `opener`, a list `parseInner` reads, and the matching closer, as `parseEnclosed` does: a
 * line break may separate the list's items (layout/item-breaks.ts).
 */
export function parseList<Value>(
  parser: Parser,
  opener: Opener,
  parseInner: () => Value,
): Enclosed<Value> {
  return parseEnclosedIn(
    parser,
    opener,
    (parse) => parser.cursor.withinList(opener, parse),
    parseInner,
  );
}

/**
 * `opener`, whatever `parseInner` reads, and the matching closer, inside the region `enter` opens
 * (cursor/regions.ts): a bracket's, a list's, or the line-sensitive one of a block in braces.
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
      skipUnexpected(parser, reported, `'${closer}'`, () => cursor.at(closer));
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
  const { value, span } = parseList(parser, opener, () => parseCommaSeparated(parser, parseItem));
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

/**
 * `item, item, …` up to the current region's closer, inside `parseList`: a `,`, or a line break
 * that separates two items (layout/item-breaks.ts), stands between two.
 */
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
    if (!(atListSeparator(parser) || atRegionEnd(parser))) {
      const expected = `',', a line break or ${describeCloser(cursor.closer)}`;
      items.push(...skipUnexpected(parser, reported, expected, () => atListSeparator(parser)));
    }
    const separator = takeListSeparator(parser);
    if (separator === undefined || cursor.index === before) {
      break;
    }
    separated ||= separator === ',';
  }
  return { items, separated };
}

/**
 * Whether a list's separator comes next: a `,`, a `;` read as one, or a line break separating two
 * items.
 */
function atListSeparator(parser: Parser): boolean {
  const { cursor } = parser;
  return cursor.at(',') || cursor.at(';') || breakSeparatesItems(parser);
}

/**
 * Takes the separator next, if any: a `,`, a `;` in its place, reported once (`;` separates only
 * statements, §2), or a line break separating two items, which leaves nothing to consume.
 */
function takeListSeparator(parser: Parser): ',' | 'lineBreak' | undefined {
  const { cursor } = parser;
  const semicolon = cursor.eat(';');
  if (semicolon !== undefined) {
    parser.report(parserDiagnostics.semicolonBetweenItems(semicolon.span));
    return ',';
  }
  if (cursor.eat(',') !== undefined) {
    return ',';
  }
  return breakSeparatesItems(parser) ? 'lineBreak' : undefined;
}

/**
 * What separates two items of a block on one line (layout/index.ts): `;` between statements, `,`
 * between a list's items, and only a line break between cases (§2).
 */
export type ItemSeparator = ';' | ',' | 'lineBreak';

/**
 * After an item of a block (layout/index.ts): reports and skips whatever stands before the next
 * separator or the end of the region, unless an error since `reported` already explains it.
 * Where `separator` separates items, the other kind stops the skip too: layout reports it as
 * misplaced, so one wrong separator costs one diagnostic.
 */
export function skipToSeparator(
  parser: Parser,
  reported: number,
  separator: ItemSeparator,
): Invalid[] {
  const stops: readonly CursorKind[] = separator === 'lineBreak' ? [] : [';', ','];
  if (stops.includes(parser.cursor.kind) || atRegionEnd(parser)) {
    return [];
  }
  const closer = describeCloser(parser.cursor.closer);
  const expected =
    separator === 'lineBreak'
      ? `a line break or ${closer}`
      : `'${separator}', a line break or ${closer}`;
  return skipUnexpected(parser, reported, expected, () => stops.includes(parser.cursor.kind));
}

/**
 * Whether the next token ends the current region: its closer, an enclosing closer, a line break, or
 * the end.
 */
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
 * it) and skips it, up to where `isStop` holds or the end of the region. Returns the skipped
 * tokens as an Invalid node.
 */
function skipUnexpected(
  parser: Parser,
  reported: number,
  expected: string,
  isStop: () => boolean,
): Invalid[] {
  if (parser.diagnostics.length === reported) {
    parser.reportExpected(expected);
  }
  return skipTo(parser, isStop);
}

/**
 * Skips tokens, a bracket group at a time, up to one of `stops` or the end of the region; returns
 * them as an Invalid node. While speculating, nothing is skipped: the attempt will be undone.
 */
export function skipUntil(parser: Parser, stops: readonly CursorKind[]): Invalid[] {
  return skipTo(parser, () => stops.includes(parser.cursor.kind));
}

/** `skipUntil`, up to where `isStop` holds. */
function skipTo(parser: Parser, isStop: () => boolean): Invalid[] {
  if (parser.isSpeculating) {
    return [];
  }
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const before = cursor.index;
  while (!(isStop() || atRegionEnd(parser))) {
    if (isBracketOpener(cursor.kind)) {
      cursor.skipGroup();
    } else {
      cursor.advance();
    }
  }
  return cursor.index === before ? [] : [{ kind: 'Invalid', span: parser.spanFrom(start) }];
}
