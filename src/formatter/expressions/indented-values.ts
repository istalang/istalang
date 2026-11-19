/**
 * Indented values (spec §3.2), printed as written, but for a struct value, whose form its width
 * picks (struct-values.ts): a map or an array stays a block, as do the lines its entries stand on.
 *
 * - The block stands below its opening, `T:`, `new T:`, or the `=`, `return`, key or `-` its parent
 *   prints (`opened`), with nothing after the opening on its line but a comment. Its entries keep
 *   the lines they were written on, `, ` between those sharing one (§3.2), and one blank line where
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
import type { SyntaxNode } from '../../compiler/syntax/tree/index.ts';
import type { Printer, Printers } from '../printer.ts';
import { entryRows, lineOf } from './entry-rows.ts';
import { structValueForms } from './struct-values.ts';

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
  return lineOf(printer, item, 'start') === lineOf(printer, value, 'start');
}

/** Whether `value` is a block on the lines below its opening, with no type before it. */
function isBlockBelow(value: SyntaxNode): boolean {
  return value.kind === 'IndentedValue' && value.type === undefined;
}

/**
 * `opening` (`=`, `return`, a key's `:`, an item's `-`) and the value it opens: a struct value in
 * the form its width picks (struct-values.ts), else as written, a space between, but none before a
 * block on the lines below, where only a comment may follow the opening.
 */
export function opened(printer: Printer, opening: string, value: SyntaxNode): builders.Doc {
  return (
    structValueForms(printer, opening, value) ?? [
      opening,
      isBlockBelow(value) ? '' : ' ',
      printer.print(value),
    ]
  );
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const indentedValuePrinters: Printers<IndentedValue | QuotedEntry | IndentedItem> = {
  IndentedValue: (printer, node) => [
    node.type === undefined ? '' : [node.isNew ? 'new ' : '', printer.print(node.type), ':'],
    printer.dangling(node),
    indent([hardline, entryRows(printer, node.entries, hardline)]),
  ],
  QuotedEntry: (printer, node) => [printer.print(node.key), opened(printer, ':', node.value)],
  IndentedItem: (printer, node) => {
    if (keyedOnItemLine(printer, node)) {
      const lined = align(itemOpening.length, entryRows(printer, node.value.entries, hardline));
      return [itemOpening, printer.withComments(node.value, lined)];
    }
    return isBlockBelow(node.value)
      ? opened(printer, '-', node.value)
      : [itemOpening, align(itemOpening.length, printer.print(node.value))];
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
