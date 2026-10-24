/**
 * Bracketed constructs and error recovery.
 *
 * Every bracketed construct in the grammar goes through `parseEnclosed`, so trailing commas (gap
 * G12), line-break rules (G13) and recovery behave the same everywhere. A caller names only the
 * opener; its closer and line rule come from `openers` (cursor.ts). The closer is consumed inside
 * the construct's own region, so a closer on a line of its own still closes it.
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

import type { Span } from '../../text/span.ts';
import type { Invalid } from '../syntax/node.ts';
import type { TokenKind } from '../syntax/tokens.ts';
import { type Closer, type CursorKind, type Opener, openers } from './cursor.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';

export interface Enclosed<Value> {
  readonly value: Value;
  /** From the opener to the closer, or to the last token read if the closer is missing. */
  readonly span: Span;
}

export interface CommaSeparated<Item> {
  readonly items: readonly (Item | Invalid)[];
  /** Whether any comma was written, which tells `(x,)` from `(x)`. */
  readonly separated: boolean;
}

export type DelimitedList<Item> = CommaSeparated<Item> & { readonly span: Span };

/**
 * Parses `opener`, whatever `parseInner` reads, and the matching closer; the cursor must be at
 * `opener`. Anything left before the closer is reported and skipped.
 */
export function parseEnclosed<Value>(
  parser: Parser,
  opener: Opener,
  parseInner: () => Value,
): Enclosed<Value> {
  const { cursor } = parser;
  const openerToken = cursor.advance();
  const { closer } = openers[opener];
  const value = cursor.within(opener, () => {
    const reported = parser.diagnostics.length;
    const inner = parseInner();
    if (!atRegionEnd(parser)) {
      skipUnexpected(parser, reported, `'${closer}'`, [closer]);
    }
    if (cursor.eat(closer) === undefined) {
      parser.report(parserDiagnostics.unclosedBracket(openerToken.span, opener, closer));
    }
    return inner;
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

/** The item of `(x)`: one item and no comma, which groups rather than making a tuple (§3.15). */
export function groupedItem<Item>(list: CommaSeparated<Item>): Item | Invalid | undefined {
  const [only] = list.items;
  return list.items.length === 1 && !list.separated ? only : undefined;
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
 * `{ entry; entry }`, the entries separated by `;` or line breaks (gap G13); the cursor must be at
 * the `{`. Each entry stays on one line, so a line break both ends one entry and starts the next.
 */
export function parseEntries<Item>(
  parser: Parser,
  parseItem: () => Item,
): Enclosed<readonly (Item | Invalid)[]> {
  const { cursor } = parser;
  return parseEnclosed(parser, '{', () => {
    const entries: (Item | Invalid)[] = [];
    skipSemicolons(parser);
    while (!atRegionEnd(parser)) {
      const before = cursor.index;
      entries.push(...cursor.onOneLine(() => parseEntry(parser, parseItem)));
      if (cursor.index === before) {
        break;
      }
      skipSemicolons(parser);
    }
    return entries;
  });
}

function parseEntry<Item>(parser: Parser, parseItem: () => Item): (Item | Invalid)[] {
  const reported = parser.diagnostics.length;
  const item = parseItem();
  if (parser.cursor.at(';') || atRegionEnd(parser)) {
    return [item];
  }
  return [item, ...skipUnexpected(parser, reported, "';', a line break or '}'", [';'])];
}

/** Empty entries are allowed: `{ a: int; }`. */
function skipSemicolons(parser: Parser): void {
  while (parser.cursor.eat(';') !== undefined) {
    // Each iteration consumed one `;`.
  }
}

/** Whether the next token ends the current region: its closer, an enclosing closer, a line break, or the end. */
function atRegionEnd(parser: Parser): boolean {
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
  if (parser.isSpeculating) {
    return [];
  }
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const before = cursor.index;
  while (!(stops.includes(cursor.kind) || atRegionEnd(parser))) {
    skipGroupOrToken(parser);
  }
  return cursor.index === before ? [] : [{ kind: 'Invalid', span: parser.spanFrom(start) }];
}

const bracketCloser: Partial<Record<TokenKind, Closer>> = Object.fromEntries(
  Object.entries(openers)
    .filter(([, opener]) => opener.isBracket)
    .map(([opener, { closer }]) => [opener, closer]),
);

/** Skips one token, or a whole bracket group, stopping early at a closer of an open region. */
function skipGroupOrToken(parser: Parser): void {
  const { cursor } = parser;
  const pending: TokenKind[] = [];
  do {
    const { kind } = cursor.token;
    const closer = bracketCloser[kind];
    if (closer !== undefined) {
      pending.push(closer);
    } else if (pending.includes(kind)) {
      pending.splice(pending.lastIndexOf(kind));
    } else if (kind === 'end' || (pending.length > 0 && cursor.closesAny(kind))) {
      return;
    }
    cursor.advance();
  } while (pending.length > 0);
}
