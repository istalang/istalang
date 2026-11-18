/**
 * The widths the canonical format keeps within (formatter.md), which has no options: a line is at
 * most `printWidth` wide, one holding a compressed form at most two thirds of that (compact.ts),
 * and an indentation level is `tabWidth` spaces; and printing a doc to measure it. Only code shown
 * for reading, as a hover's, is printed narrower (format.ts `formatTextWithin`), the compressed
 * forms' width still two thirds of the line's.
 */

import { type builders, printer as docPrinter } from 'prettier/doc';

export const printWidth = 100;

/** A line holding a compressed form keeps within two of the thirds a line's width is cut in. */
const widthThirds = 3;

/** The width a line holding a compressed form keeps within: two thirds of a line's `width`. */
export function compactWidthOf(width: number): number {
  return Math.floor((width * 2) / widthThirds);
}

export const tabWidth = 2;

/** `doc` on one line, however long, for a place that has no line break to offer. */
export function oneLine(doc: builders.Doc): string {
  return docPrinter.printDocToString(doc, { printWidth: Number.POSITIVE_INFINITY, tabWidth })
    .formatted;
}

/**
 * Whether `doc`, standing at a line's start, prints on one line within `width`. It measures
 * against the width alone, so a doc holding a compressed form, whose narrower width only the
 * whole module's print applies (compact.ts), is never asked.
 */
export function printsOnOneLine(doc: builders.Doc, width: number): boolean {
  return !docPrinter
    .printDocToString(doc, { printWidth: width, tabWidth })
    .formatted.includes('\n');
}
