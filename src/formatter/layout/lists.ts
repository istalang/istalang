/**
 * The lists every construct prints its parts in (formatter.md, Style), and the only places the
 * formatter breaks a line inside a construct:
 * - items of a block, one per line, keeping one blank line where the source had any;
 * - lists in brackets, `()`, `[]` and a struct literal's `{}`, and field lists in braces: on one
 *   line, separated by `, `, when they fit, else one item per line with no `,`, since a line break
 *   between two items separates them as `,` does (spec §2.1). Every item starts with a token that
 *   starts an item on a new line, so the broken list reads back as the one printed.
 * Everywhere else a line break would end the construct, so nothing else here breaks a line.
 */

import { builders, utils } from 'prettier/doc';
import { extentIn, type SyntaxNode } from '../../compiler/syntax/tree/index.ts';
import { memo } from '../../foundation/structures/memo.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { hasBlankLine } from '../comments/comments.ts';
import type { Printer } from '../printer.ts';

const {
  breakParent,
  conditionalGroup,
  group,
  hardline,
  hardlineWithoutBreakParent,
  ifBreak,
  indent,
  join,
  line,
  softline,
} = builders;

/**
 * Items one per line, with one blank line where the source had one or more between them, and
 * after a declaration with a body or members printed on several lines (`spacedDeclaration`).
 */
export function itemLines(printer: Printer, items: readonly SyntaxNode[]): builders.Doc {
  return items.map((item, index) => {
    const previous = items[index - 1];
    if (previous === undefined) {
      return printer.print(item);
    }
    const blank = blankBetween(printer, previous, item) ? hardline : blankAfter(previous);
    return [hardline, blank, printer.print(item)];
  });
}

/** Declarations a blank line follows once printed on several lines. */
const spacedKinds: ReadonlySet<SyntaxNode['kind']> = new Set([
  'FunctionDeclaration',
  'StructDeclaration',
  'SharedStructDeclaration',
  'ExternStructDeclaration',
  'EnumDeclaration',
  'TraitDeclaration',
]);

const spacingGroups = new WeakMap<SyntaxNode, symbol>();

function spacingGroupOf(node: SyntaxNode): symbol {
  return memo(spacingGroups, node, () => Symbol(node.kind));
}

/**
 * `doc`, `node`'s, as one group, which breaks exactly when `node` takes several lines, so the item
 * after it knows (`itemLines`): a group around a whole item changes none of the choices inside it.
 */
export function spacedDeclaration(node: SyntaxNode, doc: builders.Doc): builders.Doc {
  return group(doc, { id: spacingGroupOf(node) });
}

/** A blank line after `node` when it is a declaration printed on several lines; else nothing. */
function blankAfter(node: SyntaxNode): builders.Doc {
  // A line only the broken declaration prints, which mustn't break the groups around.
  return spacedKinds.has(node.kind)
    ? ifBreak(hardlineWithoutBreakParent, '', { groupId: spacingGroupOf(node) })
    : '';
}

/** Whether the source has a blank line between two items, their comments included. */
export function blankBetween(printer: Printer, first: SyntaxNode, second: SyntaxNode): boolean {
  const { text } = printer.tree.source;
  return hasBlankLine(text, printer.extentOf(first).end, printer.extentOf(second).start);
}

/**
 * `items` between `open` and `close`, comma-separated. The comments `owner` holds inside it, which
 * have no item before them, print after `open`.
 */
export function bracketed(
  printer: Printer,
  owner: SyntaxNode,
  [open, close]: readonly [string, string],
  items: readonly SyntaxNode[],
): builders.Doc {
  return commaList(printer, owner, items, { open, close, trailingComma: '' });
}

/**
 * A tuple's elements in parentheses, of a value, a type or a pattern: one element keeps its comma,
 * broken or not, since without it `(x)` only groups `x`.
 */
export function tupleList(
  printer: Printer,
  owner: SyntaxNode,
  elements: readonly SyntaxNode[],
): builders.Doc {
  const trailingComma = elements.length === 1 ? ',' : '';
  return commaList(printer, owner, elements, { open: '(', close: ')', trailingComma });
}

/** What a comma list stands between, and what follows its last item. */
interface ListEnds {
  readonly open: builders.Doc;
  readonly close: builders.Doc;
  readonly trailingComma: string;
}

function commaList(
  printer: Printer,
  owner: SyntaxNode,
  items: readonly SyntaxNode[],
  { open, close, trailingComma }: ListEnds,
): builders.Doc {
  const inside = printer.dangling(owner);
  if (items.length === 0) {
    return inside === '' ? [open, close] : group([open, indent(inside), softline, close]);
  }
  return group([
    open,
    indent([
      inside,
      softline,
      join(
        [ifBreak('', ','), line],
        items.map((item) => printer.print(item)),
      ),
    ]),
    trailingComma,
    softline,
    close,
  ]);
}

/**
 * One item between `open` and `close` that only enclose it, as parentheses group and brackets
 * index: never a trailing comma, which would make a tuple of it.
 */
export function enclosed(
  printer: Printer,
  owner: SyntaxNode,
  [open, close]: readonly [string, string],
  inner: SyntaxNode,
): builders.Doc {
  return group([
    open,
    indent([printer.dangling(owner), softline, printer.print(inner)]),
    softline,
    close,
  ]);
}

/** Fields in braces: `{ a: Int, b: Int }` on one line, else one field per line with no `,`. */
export function fieldList(
  printer: Printer,
  owner: SyntaxNode,
  fields: readonly SyntaxNode[],
): builders.Doc {
  const inside = printer.dangling(owner);
  if (fields.length === 0) {
    return inside === '' ? '{}' : group(['{', indent(inside), softline, '}']);
  }
  return group([
    '{',
    indent([
      inside,
      line,
      join(
        [ifBreak('', ','), line],
        fields.map((field) => printer.print(field)),
      ),
    ]),
    line,
    '}',
  ]);
}

/** Type arguments or parameters, `<A, B>`: `<` is no bracket (spec §2.1), so they never break. */
export function angled(printer: Printer, items: readonly SyntaxNode[]): builders.Doc {
  return items.length === 0
    ? ''
    : [
        '<',
        join(
          ', ',
          items.map((item) => printer.print(item)),
        ),
        '>',
      ];
}

/** Whether comments are printed before or after `node`, which a run around it must keep apart. */
export function hasComments(printer: Printer, node: SyntaxNode): boolean {
  const withComments = printer.extentOf(node);
  const extent = extentIn(printer.tree, node);
  return withComments.start !== extent.start || withComments.end !== extent.end;
}

/**
 * Whether a comment is written in `node`'s own lines: inside the text it and everything under it
 * cover, or, when that text spans lines, at the end of its last line, where a comment belongs to
 * whatever that line ends with, whichever node it was placed on. A compressed form would part
 * either from its code.
 */
function holdsComments(printer: Printer, node: SyntaxNode): boolean {
  const extent = extentIn(printer.tree, node);
  if (printer.commentsIn(extent).length > 0) {
    return true;
  }
  const lines = lineMapOf(printer.tree.source);
  const last = lines.positionAt(extent.end).line;
  if (lines.positionAt(extent.start).line === last) {
    return false;
  }
  return printer.commentsIn({ start: extent.end, end: lines.lineSpan(last).end }).length > 0;
}

/**
 * Whether `items` of `node` keep the lines they stand on whatever their width: a comment in their
 * lines, on one of them, or a blank line between two has no place on one line.
 */
export function keepsItsLines(
  printer: Printer,
  node: SyntaxNode,
  items: readonly SyntaxNode[],
): boolean {
  return (
    holdsComments(printer, node) ||
    items.some((item) => hasComments(printer, item)) ||
    items.some((item, index) => index > 0 && blankBetween(printer, items[index - 1] ?? item, item))
  );
}

/**
 * `before`, `last` and `after` on one line when they fit. Else `last` hugged: broken inside its own
 * brackets with its first line still after `before`, as `fn tests(): [` or `test("…", fn(): {`
 * keep their opening bracket, when that line fits. Else `expanded`. A `last` that breaks anyway
 * breaks the groups around, which a conditional group would otherwise keep from it.
 */
export function hugging(
  [before, last, after]: readonly [builders.Doc, builders.Doc, builders.Doc],
  expanded: builders.Doc,
): builders.Doc {
  return [
    utils.willBreak(last) ? breakParent : '',
    conditionalGroup([
      [before, last, after],
      [before, group(last, { shouldBreak: true }), after],
      expanded,
    ]),
  ];
}
