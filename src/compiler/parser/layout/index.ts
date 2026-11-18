/**
 * Layout: blocks of lines, the bodies that follow a `:` (bodies.ts), and which line continues what
 * (spec §2, §4). Every decision to move past a line break is made here, and only here.
 *
 * A block is a run of items, one or more per line, at one column. Statements, struct fields, enum
 * variants, trait members and match cases are all laid out this way, so one loop serves them all.
 * At each line break the next line's column decides:
 * - the block's column: the next item
 * - deeper: an unexpected indent, reported, and the line parsed as the next item anyway
 * - shallower, but still deeper than the enclosing block: an inconsistent dedent, reported and
 *   kept in this block
 * - otherwise the block ends, and the enclosing construct carries on.
 * Within a line, the block's kind names what separates its items (§2): `;` between statements and
 * a module's declarations, `,` between the items of every list (fields, variants, trait members,
 * constraint entries), and nothing between cases, which stand one per line. The other separator
 * is reported as misplaced and read as the right one, so one slip costs one diagnostic. A module
 * is the block at column 0, so its first line is held to that column too. Entries in braces
 * (`struct Req { id: Int, value: String }`) are the same items as a list instead (§2): `,` or a
 * line break separating two of them (item-breaks.ts), so an entry may span lines.
 *
 * `elif` and `else` continue an `if` on its line, or first on a later line at the column where the
 * `if`'s line starts (§4, continuations.ts). A dangling `else` therefore binds to the nearest `if`
 * whose line it lines up with.
 *
 * Annotations are handled here, for every kind of item. One standing alone on its line waits for
 * the next item of the block, or of the list, which reads past the line break to it. One written on
 * an item's line applies to that item, before it or after it; in a list, one starting a line after
 * an item starts the next. Where items can't carry annotations (match and select cases), an
 * annotation is reported and kept as an Invalid node.
 *
 * Docstrings are placed here too (§2): first in a documented body (bodies.ts) or a module, or on
 * the line right after a declaration without an indented body, deeper than the declaration. A
 * docstring starting any other item is reported.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Span } from '../../../foundation/text/span.ts';
import type { Annotation } from '../../syntax/items.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { Invalid } from '../../syntax/tree/node.ts';
import type { CursorKind } from '../cursor/index.ts';
import {
  atRegionEnd,
  type Enclosed,
  type ItemSeparator,
  parseCommaSeparated,
  parseEnclosedIn,
  parseList,
  skipToSeparator,
} from '../cursor/recovery.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { annotationOpener, parseAnnotation, rejectAnnotations } from './annotations.ts';
import { misplacedDocstring, parseDocstring, type WithDocstring } from './docstrings.ts';

/** How to parse one kind of item, what separates two of them, and how they take annotations. */
export interface ItemRules<Item extends SyntaxNode> {
  readonly parseItem: (parser: Parser) => Item | Invalid;
  readonly separator: ItemSeparator;
  /**
   * Whether each item standing on lines of its own heads a segment of the text (syntax/tree/
   * positions.ts), its annotations included: a module's items and a trait's members do.
   */
  readonly headsSegments?: boolean;
  /** Undefined where items can't carry annotations. */
  readonly annotate:
    | ((parser: Parser, item: Item | Invalid, annotations: readonly Annotation[]) => Item | Invalid)
    | undefined;
}

export type Items<Item> = readonly (Item | Invalid)[];

interface Lines<Item> {
  readonly items: Items<Item>;
  /** Whether its items head segments of their own (`ItemRules.headsSegments`). */
  readonly headedSegments: boolean;
  /** Whether a separator stood between two items, which a block on one line needs (§4). */
  readonly separated: boolean;
}

/** One item on its line with the annotations there, as a one-line body: never any pending. */
export function parseAnnotatedItems<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): Items<Item> {
  const step = parseLineItem(parser, rules, [], false);
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

/** An item of these lists may start with its annotations, whose `@` starts it on a new line. */
const annotatedItemOpeners: ReadonlySet<CursorKind> = new Set([annotationOpener]);

/**
 * `{ a: Int, b: Int }`, or a variant's `(a: Int, b: Int)`: `rules` items as a list (§2), each with
 * its annotations; the cursor must be at `opener`.
 */
export function parseItemEntries<Item extends SyntaxNode>(
  parser: Parser,
  opener: '{' | '(',
  rules: ItemRules<Item>,
): Enclosed<Items<Item>> {
  return parseList(parser, opener, () =>
    parseCommaSeparated(
      parser,
      () => parseListItem(parser, rules),
      annotatedItemOpeners,
    ).items.flat(),
  );
}

/**
 * One item of a list with its annotations; annotations with no item after them, before a `,` or
 * the closer, are reported.
 */
function parseListItem<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): Items<Item> {
  const step = parseLineItem(parser, rules, [], false);
  return [...step.items, ...rejectAnnotations(parser, step.pending, danglingAnnotation)];
}

/**
 * The items of the current block (cursor/regions.ts), up to the line where it ends, each heading
 * a segment where the rules say so.
 */
export function parseLines<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
): Lines<Item> {
  return rules.headsSegments === true
    ? parser.restoringSegment(() => parseLinesOf(parser, rules, true))
    : parseLinesOf(parser, rules, false);
}

function parseLinesOf<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headsSegments: boolean,
): Lines<Item> {
  const { cursor } = parser;
  const items: (Item | Invalid)[] = [];
  let pending: readonly Annotation[] = [];
  let separated = false;
  while (moveToItem(parser)) {
    const before = cursor.index;
    if (headsSegments && pending.length === 0) {
      parser.startHeader();
    }
    const step = parseLine(parser, rules, pending, headsSegments);
    items.push(...step.items);
    ({ pending } = step);
    separated = skipSeparators(parser, rules.separator) || separated;
    if (cursor.index === before) {
      break;
    }
  }
  return {
    items: [...items, ...rejectAnnotations(parser, pending, danglingAnnotation)],
    headedSegments: headsSegments,
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
  headsSegment: boolean,
): LineItem<Item> {
  return parser.cursor.onOneLine(() => {
    const reported = parser.diagnostics.length;
    const step = parseLineItem(parser, rules, pending, headsSegment);
    const skipped = skipToSeparator(parser, reported, rules.separator);
    return { ...step, items: [...step.items, ...skipped] };
  });
}

/**
 * The current line's item with its annotations, or the annotations alone if nothing follows. An
 * item heading a segment marks where it starts, past its annotations.
 */
function parseLineItem<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  pending: readonly Annotation[],
  headsSegment: boolean,
): LineItem<Item> {
  const before = parseLeadingAnnotations(parser);
  if (before.length > 0 && (atSeparator(parser, rules.separator) || atRegionEnd(parser))) {
    return { items: [], pending: [...pending, ...before] };
  }
  if (headsSegment) {
    parser.markItemStart();
  }
  const item = parser.cursor.at('docstring') ? misplacedDocstring(parser) : rules.parseItem(parser);
  const annotations = {
    leading: [...pending, ...before],
    trailing: parseTrailingAnnotations(parser),
  };
  return { items: annotate(parser, rules, item, annotations), pending: [] };
}

/** The annotations from here up to the item they precede, on its line or the lines before. */
function parseLeadingAnnotations(parser: Parser): Annotation[] {
  return parseAnnotationsWhile(parser, () => true);
}

/** The annotations after an item on its line: in a list, one starting a line is the next item's. */
function parseTrailingAnnotations(parser: Parser): Annotation[] {
  return parseAnnotationsWhile(parser, () => !parser.cursor.startsLineInList());
}

function parseAnnotationsWhile(parser: Parser, goesOn: () => boolean): Annotation[] {
  const annotations: Annotation[] = [];
  while (parser.cursor.at(annotationOpener) && goesOn()) {
    const annotation = parseAnnotation(parser);
    if (annotation !== undefined) {
      annotations.push(annotation);
    }
  }
  return annotations;
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

/**
 * Whether a `;` or a `,` comes next where `separator` separates items on a line: either is read
 * as one, the wrong one reported. Between cases nothing is, so recovery skips either.
 */
function atSeparator(parser: Parser, separator: ItemSeparator): boolean {
  const { kind } = parser.cursor;
  return separator !== 'lineBreak' && (kind === ';' || kind === ',');
}

/**
 * Consumes any separators, since empty items are allowed (`{ a: Int, }`); whether there was one.
 * The other kind's separator is reported and consumed as this kind's.
 */
function skipSeparators(parser: Parser, separator: ItemSeparator): boolean {
  const { cursor } = parser;
  let skipped = false;
  while (atSeparator(parser, separator)) {
    const token = cursor.advance();
    if (token.kind === ';' && separator === ',') {
      parser.report(parserDiagnostics.semicolonBetweenItems(token.span));
    } else if (token.kind === ',' && separator === ';') {
      parser.report(parserDiagnostics.commaBetweenStatements(token.span));
    }
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
 * Where the next line stands relative to the current block, which holds its lines to its column:
 * - `sameBlock`, `deeper` or `strayDedent`: its next item, the last two reported
 * - `ownCloser`: the `}` of the block's own braces, which ends the block and closes them
 * - `outside`: it belongs to an enclosing construct.
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
  const column = cursor.blockColumn ?? unreachable('a region separating items is a block');
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
