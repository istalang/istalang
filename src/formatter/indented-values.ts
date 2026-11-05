/**
 * Indented values (spec §2), printed as written: a block stays a block and braces stay braces, so
 * the formatter never decides what a value would read better as.
 *
 * - The block stands below its opening, `T:`, `new T:`, or the `=`, `return`, key or `-` its parent
 *   prints, an entry per line, keeping one blank line where the source had any. Entries written on
 *   one line, `,` between them, go one per line, as a broken list's items do.
 * - An item's value written as `- key: value`, its other entries lined up with `key`, keeps that
 *   form; a block below a lone `-` stands one level deeper than the `-`; any other value, `- T:`'s
 *   block included, stands as it would after the `- `, a level deeper than its own first line.
 */

import { builders } from 'prettier/doc';
import type {
  IndentedItem,
  IndentedValue,
  QuotedEntry,
} from '../compiler/syntax/expressions/index.ts';
import type { SyntaxNode } from '../compiler/syntax/tree.ts';
import { lineMapOf } from '../text/line-map.ts';
import { itemLines } from './lists.ts';
import type { Printer, Printers } from './printer.ts';

const { align, hardline, indent } = builders;

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
  const lines = lineMapOf(printer.tree.source);
  const at = (node: SyntaxNode) => lines.positionAt(printer.extentOf(node).start).line;
  return at(item) === at(value);
}

/** Whether `value` is a block on the lines below a lone `-`, which stands deeper than the `-` alone. */
function isBlockBelow(value: IndentedItem['value']): boolean {
  return value.kind === 'IndentedValue' && value.type === undefined;
}

/** The entries of `value`, an entry per line. */
function entries(printer: Printer, value: IndentedValue): builders.Doc {
  return itemLines(printer, value.entries);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const indentedValuePrinters: Printers<IndentedValue | QuotedEntry | IndentedItem> = {
  IndentedValue: (printer, node) => [
    node.type === undefined ? '' : [node.isNew ? 'new ' : '', printer.print(node.type), ':'],
    printer.dangling(node),
    indent([hardline, entries(printer, node)]),
  ],
  QuotedEntry: (printer, node) => [printer.print(node.key), ': ', printer.print(node.value)],
  IndentedItem: (printer, node) => {
    if (keyedOnItemLine(printer, node)) {
      const lined = align(itemOpening.length, entries(printer, node.value));
      return [itemOpening, printer.withComments(node.value, lined)];
    }
    return isBlockBelow(node.value)
      ? [itemOpening, printer.print(node.value)]
      : [itemOpening, align(itemOpening.length, printer.print(node.value))];
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
