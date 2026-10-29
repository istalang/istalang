/**
 * The lists every construct prints its parts in (formatter.md, Style), and the only places the
 * formatter breaks a line inside a construct:
 * - items of a block, one per line, keeping one blank line where the source had any;
 * - comma lists in brackets, `()`, `[]` and a struct literal's `{}`, where line breaks mean nothing
 *   (spec §2): on one line when they fit, else one item per line with a trailing comma;
 * - field lists in braces, where a line break separates entries as `;` does.
 * Everywhere else a line break would end the construct, so nothing else here breaks a line.
 */

import { builders, printer as docPrinter, utils } from 'prettier/doc';
import type { SyntaxNode } from '../compiler/syntax/tree.ts';
import { hasBlankLine } from './comments.ts';
import type { Printer } from './printer.ts';

const { breakParent, conditionalGroup, group, hardline, ifBreak, indent, join, line, softline } =
  builders;

/** Items one per line, with one blank line where the source had one or more between them. */
export function itemLines(printer: Printer, items: readonly SyntaxNode[]): builders.Doc {
  return items.map((item, index) => {
    const previous = items[index - 1];
    if (previous === undefined) {
      return printer.print(item);
    }
    return [hardline, blankBetween(printer, previous, item) ? hardline : '', printer.print(item)];
  });
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
  return commaList(printer, owner, items, { open, close, trailingComma: ifBreak(',') });
}

/**
 * A tuple's elements in parentheses, of a value, a type or a pattern: one element keeps its comma
 * on one line too, since without it `(x)` only groups `x`.
 */
export function tupleList(
  printer: Printer,
  owner: SyntaxNode,
  elements: readonly SyntaxNode[],
): builders.Doc {
  const trailingComma = elements.length === 1 ? ',' : ifBreak(',');
  return commaList(printer, owner, elements, { open: '(', close: ')', trailingComma });
}

/** What a comma list stands between, and what follows its last item when it breaks. */
interface ListEnds {
  readonly open: string;
  readonly close: string;
  readonly trailingComma: builders.Doc;
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
        [',', line],
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

/** Fields in braces: `{ a: int; b: int }` on one line, else one field per line. */
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
        [ifBreak('', ';'), line],
        fields.map((field) => printer.print(field)),
      ),
    ]),
    line,
    '}',
  ]);
}

/** Type arguments or parameters, `<A, B>`: `<` is no bracket (spec §2), so they never break. */
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

/** `doc` on one line, however long, for a place that has no line break to offer. */
export function oneLine(doc: builders.Doc): string {
  return docPrinter.printDocToString(doc, { printWidth: Number.POSITIVE_INFINITY, tabWidth: 2 })
    .formatted;
}

/** Whether comments are printed before or after `node`, which a run around it must keep apart. */
export function hasComments(printer: Printer, node: SyntaxNode): boolean {
  const extent = printer.extentOf(node);
  return extent.start !== node.span.start || extent.end !== node.span.end;
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
