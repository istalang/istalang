/**
 * Layout: blocks of lines, the bodies that follow a `:`, and which line continues what (spec §2,
 * §4). Every decision to move past a line break is made here, and only here.
 *
 * A block is a run of items, one or more per line, at one column. Statements, struct fields, enum
 * variants, trait members and match cases are all laid out this way, so one loop serves them all.
 * At each line break the next line's column decides:
 * - the block's column: the next item
 * - deeper: an unexpected indent, reported, and the line parsed as the next item anyway
 * - shallower, but still deeper than the enclosing block: an inconsistent dedent, reported and
 *   kept in this block
 * - otherwise the block ends, and the enclosing construct carries on.
 * Within a line, items are separated by `;`. A module is the block at column 0, so its first line
 * is held to that column too. Entries in braces (`struct Req { id: int; value: string }`) are the
 * same list without a column: every line continues it until the `}`.
 *
 * A body after `:` is either one item on the same line, or a block indented deeper than the line
 * the construct starts on. A `;` right after a one-line body is an error (§4): a Python reader
 * would think `if x: a; b` puts both statements in the body.
 *
 * `elif` and `else` continue an `if` on its line, or first on a later line at the column where the
 * `if`'s line starts (§4). A dangling `else` therefore binds to the nearest `if` whose line it
 * lines up with.
 *
 * Annotations are handled here, for every kind of item. One standing alone on its line waits for
 * the next item of the block. One written on an item's line applies to that item, before it or
 * after it. Where items can't carry annotations (match and select cases), an annotation is
 * reported and kept as an Invalid node.
 *
 * Docstrings are placed here too (§2): first in a documented body or a module, or on the line right
 * after a declaration without an indented body, deeper than the declaration. A docstring starting
 * any other item is reported.
 */

import type { Span } from '../../text/span.ts';
import type { Annotation } from '../syntax/annotations.ts';
import type { Docstring } from '../syntax/declarations.ts';
import type { Invalid } from '../syntax/node.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import { parseAnnotations, rejectAnnotations } from './annotations.ts';
import type { CursorKind } from './cursor.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { misplacedDocstring, parseDocstring, type WithDocstring } from './docstrings.ts';
import type { Parser } from './parser.ts';
import {
  atRegionEnd,
  type Enclosed,
  parseEnclosedIn,
  skipToSeparator,
  skipUntil,
} from './recovery.ts';

/** How to parse one kind of item, and how it takes annotations. */
export interface ItemRules<Item extends SyntaxNode> {
  readonly parseItem: (parser: Parser) => Item | Invalid;
  /** Undefined where items can't carry annotations. */
  readonly annotate:
    | ((parser: Parser, item: Item | Invalid, annotations: readonly Annotation[]) => Item | Invalid)
    | undefined;
}

export type Items<Item> = readonly (Item | Invalid)[];

export interface Lines<Item> {
  readonly items: Items<Item>;
  /** Whether any `;` separated two items, which a block on one line needs (§4). */
  readonly separated: boolean;
}

export interface Body<Item> {
  readonly items: Items<Item>;
  readonly span: Span;
}

/**
 * The body after a construct's `:`. `headerStart` is where the construct starts: an indented
 * body must be deeper than that line.
 */
export function parseBody<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
): Body<Item> {
  return parseBodyOf(parser, rules, headerStart, false).value;
}

/** The body after a declaration's `:`, whose first line may be its docstring when indented. */
export function parseDocumentedBody<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
): WithDocstring<Body<Item>> {
  return parseBodyOf(parser, rules, headerStart, true);
}

/**
 * The docstring of a declaration without an indented body, starting at `headerStart`: on the next
 * line, deeper than the declaration's, and first there.
 */
export function parseDocstringBelow(parser: Parser, headerStart: number): Docstring | undefined {
  const { cursor } = parser;
  const next = cursor.lineStart;
  if (next?.kind !== 'docstring' || parser.columnOf(next) <= parser.indentationAt(headerStart)) {
    return undefined;
  }
  cursor.crossLineBreak();
  return parseDocstring(parser);
}

function parseBodyOf<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
  isDocumented: boolean,
): WithDocstring<Body<Item>> {
  const { cursor } = parser;
  const next = cursor.lineStart;
  if (next !== undefined) {
    const column = parser.columnOf(next);
    if (column <= parser.indentationAt(headerStart) || cursor.closesAny(next.kind)) {
      return { value: emptyBody(parser), doc: undefined };
    }
    return cursor.inBlock(column, () => {
      const doc = isDocumented ? parseDocstring(parser) : undefined;
      const { items } = parseLines(parser, rules);
      return { value: { items, span: spanOfItems(parser, items) }, doc };
    });
  }
  if (cursor.at(';') || atRegionEnd(parser)) {
    return { value: emptyBody(parser), doc: undefined };
  }
  const items = cursor.onOneLine(() => parseAnnotatedItems(parser, rules));
  if (cursor.at(';')) {
    parser.report(parserDiagnostics.semicolonAfterInlineBody(cursor.token.span));
  }
  return { value: { items, span: spanOfItems(parser, items) }, doc: undefined };
}

/** One item on its line with the annotations there, as a one-line body: never any pending. */
function parseAnnotatedItems<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): Items<Item> {
  const step = parseLineItem(parser, rules, []);
  return [...step.items, ...rejectAnnotations(parser, step.pending, danglingAnnotation)];
}

/**
 * A module: the block at column 0, whose first line, unlike a body's, may start too deep, and may
 * be the module's docstring.
 */
export function parseModuleLines<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): WithDocstring<Items<Item>> {
  const { cursor } = parser;
  const { token } = cursor;
  if (token.kind !== 'end' && parser.columnOf(token) > 0) {
    parser.report(parserDiagnostics.unexpectedIndent(token.span));
  }
  return cursor.inBlock(0, () => {
    const doc = parseDocstring(parser);
    return { value: parseLines(parser, rules).items, doc };
  });
}

/**
 * `{ … }` in an expression: a block of `rules` items at the column of the first token after the
 * `{`, on its line or the next.
 */
export function parseBlockBraces<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): Enclosed<Lines<Item>> {
  const { cursor } = parser;
  const enter = (parse: () => Lines<Item>): Lines<Item> =>
    cursor.withinBlockBraces(parser.columnOf(cursor.lineStart ?? cursor.token), parse);
  return parseEnclosedIn(parser, '{', enter, () => parseLines(parser, rules));
}

/** `{ a: int; b: int }`: `rules` items separated by `;` or line breaks, at any column. */
export function parseItemEntries<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): Enclosed<Items<Item>> {
  const { cursor } = parser;
  const enter = (parse: () => Items<Item>): Items<Item> => cursor.withinEntryBraces(parse);
  return parseEnclosedIn(parser, '{', enter, () => parseLines(parser, rules).items);
}

/** The items of the current list region (cursor.ts), up to the line where it ends. */
function parseLines<Item extends SyntaxNode>(parser: Parser, rules: ItemRules<Item>): Lines<Item> {
  const { cursor } = parser;
  const items: (Item | Invalid)[] = [];
  let pending: readonly Annotation[] = [];
  let separated = false;
  while (moveToItem(parser)) {
    const before = cursor.index;
    const step = parseLine(parser, rules, pending);
    items.push(...step.items);
    ({ pending } = step);
    separated = skipSemicolons(parser) || separated;
    if (cursor.index === before) {
      break;
    }
  }
  return {
    items: [...items, ...rejectAnnotations(parser, pending, danglingAnnotation)],
    separated,
  };
}

interface LineItem<Item> {
  readonly items: Items<Item>;
  /** Annotations alone on their line, waiting for the next item of the block. */
  readonly pending: readonly Annotation[];
}

/** One line of a list region: its item, alone on a one-line region, and what's left after it. */
function parseLine<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  pending: readonly Annotation[],
): LineItem<Item> {
  return parser.cursor.onOneLine(() => {
    const reported = parser.diagnostics.length;
    const step = parseLineItem(parser, rules, pending);
    return { ...step, items: [...step.items, ...skipToSeparator(parser, reported)] };
  });
}

/** The current line's item with its annotations, or the annotations alone if nothing follows. */
function parseLineItem<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  pending: readonly Annotation[],
): LineItem<Item> {
  const before = parseAnnotations(parser);
  if (before.length > 0 && (parser.cursor.at(';') || atRegionEnd(parser))) {
    return { items: [], pending: [...pending, ...before] };
  }
  const item = parser.cursor.at('docstring') ? misplacedDocstring(parser) : rules.parseItem(parser);
  const annotations = { leading: [...pending, ...before], trailing: parseAnnotations(parser) };
  return { items: annotate(parser, rules, item, annotations), pending: [] };
}

function annotate<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  item: Item | Invalid,
  {
    leading,
    trailing,
  }: { readonly leading: readonly Annotation[]; readonly trailing: readonly Annotation[] },
): Items<Item> {
  if (leading.length === 0 && trailing.length === 0) {
    return [item];
  }
  if (rules.annotate !== undefined) {
    return [rules.annotate(parser, item, [...leading, ...trailing])];
  }
  return [
    ...rejectAnnotations(parser, leading, misplacedAnnotation),
    item,
    ...rejectAnnotations(parser, trailing, misplacedAnnotation),
  ];
}

const { danglingAnnotation, misplacedAnnotation } = parserDiagnostics;

/** Consumes any `;`, since empty items are allowed (`{ a: int; }`); whether there was one. */
function skipSemicolons(parser: Parser): boolean {
  let skipped = false;
  while (parser.cursor.eat(';') !== undefined) {
    skipped = true;
  }
  return skipped;
}

/**
 * Moves to where the block's next item starts: across a line break if the next line continues
 * the block, or onto the block's own `}` if that comes next. Returns whether an item starts there.
 */
function moveToItem(parser: Parser): boolean {
  const { cursor } = parser;
  const next = cursor.lineStart;
  if (next !== undefined) {
    const place = placeOfNextLine(parser, next);
    // A deeper docstring reads as one below the item before; it is reported as misplaced instead.
    if (place === 'deeper' && next.kind !== 'docstring') {
      parser.report(parserDiagnostics.unexpectedIndent(next.span));
    } else if (place === 'strayDedent') {
      parser.report(parserDiagnostics.inconsistentDedent(next.span));
    }
    if (place !== 'outside') {
      cursor.crossLineBreak();
    }
    if (place === 'outside' || place === 'ownCloser') {
      return false;
    }
  }
  return !atRegionEnd(parser);
}

/**
 * Where the next line stands relative to the current list:
 * - `sameBlock`, `deeper` or `strayDedent`: its next item, the last two reported
 * - `ownCloser`: the `}` of the list's own braces, which ends the list and closes them
 * - `outside`: it belongs to an enclosing construct.
 * A block holds its lines to its column; entries in braces may start at any column.
 */
function placeOfNextLine(
  parser: Parser,
  next: { readonly kind: CursorKind; readonly span: Span },
): 'sameBlock' | 'deeper' | 'strayDedent' | 'ownCloser' | 'outside' {
  const { cursor } = parser;
  if (!cursor.separatesItems) {
    return 'outside';
  }
  if (next.kind === cursor.closer) {
    // A suite inside braces keeps their `}` as its closer, but only the braces may consume it.
    return cursor.ownsCloser ? 'ownCloser' : 'outside';
  }
  if (cursor.closesEnclosing(next.kind)) {
    return 'outside';
  }
  const column = cursor.blockColumn;
  if (column === undefined) {
    return 'sameBlock';
  }
  const at = parser.columnOf(next);
  if (at > column) {
    return 'deeper';
  }
  if (at === column) {
    return 'sameBlock';
  }
  const outer = cursor.enclosingBlockColumn;
  return outer === undefined || at <= outer ? 'outside' : 'strayDedent';
}

/**
 * Moves to `keyword` if it continues the construct that starts at `constructStart`: next on this
 * line, or first on the next line at the column where the construct's line starts (§4). Returns
 * whether it did.
 */
export function moveToContinuation(
  parser: Parser,
  keyword: CursorKind,
  constructStart: number,
): boolean {
  const { cursor } = parser;
  if (cursor.at(keyword)) {
    return true;
  }
  const next = cursor.lineStart;
  if (next?.kind !== keyword || parser.columnOf(next) !== parser.indentationAt(constructStart)) {
    return false;
  }
  cursor.crossLineBreak();
  return true;
}

/**
 * Skips every following line indented deeper than `indentation`: lines that can only belong to
 * a construct being skipped. While speculating, recovery skips nothing, so this crosses nothing.
 */
export function skipDeeperLines(parser: Parser, indentation: number): void {
  const { cursor } = parser;
  while (!parser.isSpeculating && deeperLineFollows(parser, indentation)) {
    cursor.crossLineBreak();
    skipUntil(parser, []);
  }
}

function deeperLineFollows(parser: Parser, indentation: number): boolean {
  const next = parser.cursor.lineStart;
  return next !== undefined && parser.columnOf(next) > indentation;
}

/** From the first item to the last, or empty where the next item would be. */
function spanOfItems(parser: Parser, items: Items<SyntaxNode>): Span {
  const at = parser.cursor.previousEnd;
  return { start: items[0]?.span.start ?? at, end: items.at(-1)?.span.end ?? at };
}

/** A body that isn't there: reported where it should start. */
function emptyBody<Item>(parser: Parser): Body<Item> {
  parser.report(parserDiagnostics.expectedIndentedBlock(parser.nextSpan, parser.describeNext()));
  return { items: [], span: spanOfItems(parser, []) };
}
