/**
 * Indented values (spec §2), printed as written: a block stays a block and braces stay braces, so
 * the formatter never decides what a value would read better as.
 *
 * - The block stands below its opening, `T:`, `new T:`, or the `=`, `return`, key or `-` its parent
 *   prints (`opened`), with nothing after the opening on its line but a comment. Its entries keep
 *   the lines they were written on, `, ` between those sharing one (§2), and one blank line where
 *   the source had any between two lines.
 * - An item's value written as `- key: value`, its other entries lined up with `key`, keeps that
 *   form; a block below a lone `-` stands one level deeper than the `-`; any other value, `- T:`'s
 *   block included, stands as it would after the `- `, a level deeper than its own first line.
 */

import { builders } from 'prettier/doc';
import type {
  IndentedItem,
  IndentedValue,
  QuotedEntry,
} from '../../compiler/syntax/expressions/index.ts';
import { extentIn, type SyntaxNode } from '../../compiler/syntax/tree/index.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { blankBetween } from '../layout/lists.ts';
import type { Printer, Printers } from '../printer.ts';

const { align, hardline, indent, join } = builders;

/** `- `: an item's opening, whose width the entries of a `- key: value` item line up past. */
const itemOpening = '- ';

/** Whether `item`'s value is the `- key: value` form: entries starting on the item's own line. */
function keyedOnItemLine(
  printer: Printer,
  item: IndentedItem,
): item is IndentedItem & {
  readonly value: IndentedValue;
} {
  const { value } = item;
  if (value.kind !== 'IndentedValue' || value.type !== undefined) {
    return false;
  }
  return lineOf(printer, item, 'start') === lineOf(printer, value, 'start');
}

/** The line `node` itself starts or ends on, its comments left out. */
function lineOf(printer: Printer, node: SyntaxNode, end: 'start' | 'end'): number {
  return lineMapOf(printer.tree.source).positionAt(extentIn(printer.tree, node)[end]).line;
}

/** Whether `value` is a block on the lines below its opening, with no type before it. */
function isBlockBelow(value: SyntaxNode): boolean {
  return value.kind === 'IndentedValue' && value.type === undefined;
}

/**
 * `opening` (`=`, `return`, a key's `:`, an item's `-`) and the value it opens: a space between,
 * but none before a block on the lines below, where only a comment may follow the opening.
 */
export function opened(printer: Printer, opening: string, value: SyntaxNode): builders.Doc {
  return [opening, isBlockBelow(value) ? '' : ' ', printer.print(value)];
}

/** The entries of `value` on the lines they were written on, `, ` between those sharing one. */
function entries(printer: Printer, value: IndentedValue): builders.Doc {
  const rows: SyntaxNode[][] = [];
  for (const entry of value.entries) {
    const row = rows.at(-1);
    const last = row?.at(-1);
    if (row !== undefined && last !== undefined && sharesLine(printer, last, entry)) {
      row.push(entry);
    } else {
      rows.push([entry]);
    }
  }
  return rows.map((row, index) => {
    const printed = join(
      ', ',
      row.map((entry) => printer.print(entry)),
    );
    const above = rows[index - 1]?.at(-1);
    const [first] = row;
    if (above === undefined || first === undefined) {
      return printed;
    }
    return [hardline, blankBetween(printer, above, first) ? hardline : '', printed];
  });
}

/** Whether `next` starts on the line `entry` ends on: written after it, `,` between. */
function sharesLine(printer: Printer, entry: SyntaxNode, next: SyntaxNode): boolean {
  return lineOf(printer, entry, 'end') === lineOf(printer, next, 'start');
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const indentedValuePrinters: Printers<IndentedValue | QuotedEntry | IndentedItem> = {
  IndentedValue: (printer, node) => [
    node.type === undefined ? '' : [node.isNew ? 'new ' : '', printer.print(node.type), ':'],
    printer.dangling(node),
    indent([hardline, entries(printer, node)]),
  ],
  QuotedEntry: (printer, node) => [printer.print(node.key), opened(printer, ':', node.value)],
  IndentedItem: (printer, node) => {
    if (keyedOnItemLine(printer, node)) {
      const lined = align(itemOpening.length, entries(printer, node.value));
      return [itemOpening, printer.withComments(node.value, lined)];
    }
    return isBlockBelow(node.value)
      ? opened(printer, '-', node.value)
      : [itemOpening, align(itemOpening.length, printer.print(node.value))];
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
