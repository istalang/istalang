/**
 * The widths the canonical format keeps within (formatter.md), which has no options: a line is at
 * most `printWidth` wide, one holding a compressed form at most `compactWidth` (compact.ts), and
 * an indentation level is `tabWidth` spaces; and printing a doc to measure it.
 */

import { type builders, printer as docPrinter } from 'prettier/doc';

export const printWidth = 100;
/** Two thirds of the width. */
export const compactWidth = 66;
export const tabWidth = 2;

/** `doc` on one line, however long, for a place that has no line break to offer. */
export function oneLine(doc: builders.Doc): string {
  return docPrinter.printDocToString(doc, { printWidth: Number.POSITIVE_INFINITY, tabWidth })
    .formatted;
}

/**
 * Whether `doc`, standing at a line's start, prints on one line within the width. It measures
 * against the width alone, so a doc holding a compressed form, whose narrower width only the
 * whole module's print applies (compact.ts), is never asked.
 */
export function printsOnOneLine(doc: builders.Doc): boolean {
  return !docPrinter.printDocToString(doc, { printWidth, tabWidth }).formatted.includes('\n');
}
