/**
 * The entries of an indented value on the lines they were written on (spec §3.2): `, ` between those
 * sharing one, and one blank line where the source had any between two lines.
 */

import { builders } from 'prettier/doc';
import { extentIn, type SyntaxNode } from '../../compiler/syntax/tree/index.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { blankBetween } from '../layout/lists.ts';
import type { Printer } from '../printer.ts';

const { join } = builders;

/**
 * `entries` on the lines they were written on, `newline` between two lines: a hard line, or one
 * that breaks no group, for a form only a broken group prints.
 */
export function entryRows(
  printer: Printer,
  entries: readonly SyntaxNode[],
  newline: builders.Doc,
): builders.Doc {
  const rows: SyntaxNode[][] = [];
  for (const entry of entries) {
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
    return [newline, blankBetween(printer, above, first) ? newline : '', printed];
  });
}

/** Whether `next` starts on the line `entry` ends on: written after it, `,` between. */
function sharesLine(printer: Printer, entry: SyntaxNode, next: SyntaxNode): boolean {
  return lineOf(printer, entry, 'end') === lineOf(printer, next, 'start');
}

/** The line `node` itself starts or ends on, its comments left out. */
export function lineOf(printer: Printer, node: SyntaxNode, end: 'start' | 'end'): number {
  return lineMapOf(printer.tree.source).positionAt(extentIn(printer.tree, node)[end]).line;
}
