/**
 * The widths the canonical format keeps within (formatter.md), which has no options: a line is at
 * most `printWidth` wide, one holding a compressed form at most `compactWidth` (compact.ts), and
 * an indentation level is `tabWidth` spaces.
 */

import { type builders, printer as docPrinter } from 'prettier/doc';

export const printWidth = 100;
/** Two thirds of the width. */
export const compactWidth = 66;
export const tabWidth = 2;

/** Whether `doc`, standing at a line's start, prints on one line within the width. */
export function printsOnOneLine(doc: builders.Doc): boolean {
  return !docPrinter.printDocToString(doc, { printWidth, tabWidth }).formatted.includes('\n');
}
