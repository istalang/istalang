/**
 * The bodies that follow a construct's `:` (spec §4), and the docstring of a declaration without
 * one (§2).
 *
 * A body after `:` is either one item on the same line, or a block indented deeper than the line
 * the construct starts on. A `;` right after a one-line body is an error (§4): a Python reader
 * would think `if x: a; b` puts both statements in the body.
 *
 * A function's body is entered as a segment of its own (syntax/positions.ts) after the `:` and its
 * docstring, so what describes the items, as their span, is made inside it. A trait's members may
 * each head a segment, so their list has no span of its own.
 */

import type { Docstring } from '../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import { spanAcross } from '../../syntax/positions.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import { atRegionEnd } from '../cursor/recovery.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { parseDocstring, type WithDocstring } from './docstrings.ts';
import { type ItemRules, type Items, parseAnnotatedItems, parseLines } from './index.ts';

/** A list of items after a declaration's `:`, and where its header ends: before the list. */
export interface Members<Item> {
  readonly items: Items<Item>;
  /** Whether its items head segments of their own (`ItemRules.headsSegments`). */
  readonly headedSegments: boolean;
  /** Where the construct's header ends and its body begins: after its `:` and any docstring. */
  readonly headerEnd: number;
}

/** A body after a construct's `:`: its items, from the first to the last (`span`). */
export interface Body<Item> extends Members<Item> {
  readonly span: AnchoredSpan;
}

/** Runs the parse of a body's items: in a segment of its own, for a function's body. */
export type BodyEntry = <Result>(parse: () => Result) => Result;

const inPlace: BodyEntry = (parse) => parse();

/**
 * The body after a construct's `:`. `headerStart` is where the construct starts: an indented
 * body must be deeper than that line.
 */
export function parseBody<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
): Body<Item> {
  return parseBlockBelow(parser, rules, parser.indentationAt(headerStart));
}

/**
 * A body whose block must stand right of `column`: an indented value's, whose column may be that of
 * the entries it stands among rather than its line's (§2). As `parseBody` otherwise.
 */
export function parseBlockBelow<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  column: number,
): Body<Item> {
  const reading = { above: column, isDocumented: false, enter: inPlace, describe: spanned(parser) };
  return parseBodyOf(parser, rules, reading).value;
}

/**
 * The body after a declaration's `:`, whose first line may be its docstring when indented. Its
 * items are parsed through `enter`, which a function's body enters its segment by.
 */
export function parseDocumentedBody<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
  enter: BodyEntry,
): WithDocstring<Body<Item>> {
  return parseBodyOf(parser, rules, {
    above: parser.indentationAt(headerStart),
    isDocumented: true,
    enter,
    describe: spanned(parser),
  });
}

/**
 * The members after a type declaration's `:`, whose first line may be its docstring when
 * indented. Members may head segments, which a span over them all would cross, so they have none.
 */
export function parseDocumentedMembers<Item extends SyntaxNode>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
): WithDocstring<Members<Item>> {
  const reading = {
    above: parser.indentationAt(headerStart),
    isDocumented: true,
    enter: inPlace,
    describe: () => ({}),
  };
  return parseBodyOf(parser, rules, reading);
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

/** Items as a body reads them, and whether they head segments of their own. */
type ReadItems<Item> = Pick<Members<Item>, 'items' | 'headedSegments'>;

/** What a body's items describe beyond themselves, made where they were parsed. */
type Description<Item, Extra> = (items: Items<Item>) => Extra;

/**
 * How to read a body: the column its block must stand right of (its construct's line's), whether a
 * docstring may come first, and how its items are entered and described.
 */
interface BodyReading<Item, Extra> {
  readonly above: number;
  readonly isDocumented: boolean;
  readonly enter: BodyEntry;
  readonly describe: Description<Item, Extra>;
}

/** Describes items by their span: from the first to the last, or empty where they would be. */
function spanned(parser: Parser) {
  return <Item extends SyntaxNode>(items: Items<Item>) => ({ span: spanOfItems(parser, items) });
}

function parseBodyOf<Item extends SyntaxNode, Extra>(
  parser: Parser,
  rules: ItemRules<Item>,
  { above, isDocumented, enter, describe }: BodyReading<Item, Extra>,
): WithDocstring<Members<Item> & Extra> {
  const { cursor } = parser;
  const read = (parse: () => ReadItems<Item>) => entered(parser, enter, parse, describe);
  const alone = (parse: () => Items<Item>) =>
    read(() => ({ items: parse(), headedSegments: false }));
  const next = cursor.lineStart;
  if (next !== undefined) {
    const column = parser.columnOf(next);
    if (column <= above || cursor.closesAny(next.kind)) {
      return { value: alone(() => emptyBody(parser)), doc: undefined };
    }
    return cursor.inBlock(column, () => {
      const doc = isDocumented ? parseDocstring(parser) : undefined;
      return { value: read(() => parseLines(parser, rules)), doc };
    });
  }
  if (cursor.at(';') || atRegionEnd(parser)) {
    return { value: alone(() => emptyBody(parser)), doc: undefined };
  }
  const value = alone(() => cursor.onOneLine(() => parseAnnotatedItems(parser, rules)));
  if (cursor.at(';')) {
    parser.report(parserDiagnostics.semicolonAfterInlineBody(cursor.token.span));
  }
  return { value, doc: undefined };
}

/**
 * The items `parse` reads through `enter`, described there, with where the header ends: where
 * `enter` was.
 */
function entered<Item, Extra>(
  parser: Parser,
  enter: BodyEntry,
  parse: () => ReadItems<Item>,
  describe: Description<Item, Extra>,
): Members<Item> & Extra {
  const headerEnd = parser.cursor.previousEnd;
  return enter(() => {
    const { items, headedSegments } = parse();
    return { items, headedSegments, headerEnd, ...describe(items) };
  });
}

/** From the first item to the end of the last, its body included, or empty where one would be. */
function spanOfItems(parser: Parser, items: Items<SyntaxNode>): AnchoredSpan {
  const [first] = items;
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    const at = parser.cursor.previousEnd;
    return parser.anchor({ start: at, end: at });
  }
  return spanAcross(first.span, parser.wholeSpanOf(last));
}

/** A body that isn't there: reported where it should start. */
function emptyBody<Item>(parser: Parser): Items<Item> {
  parser.report(parserDiagnostics.expectedIndentedBlock(parser.nextSpan, parser.describeNext()));
  return [];
}
