/**
 * The regions the cursor reads tokens in (index.ts), one shape per kind: what a line break does
 * there, the closer that ends it, and whether that closer is its own. Each region the grammar
 * enters is made here, so the shapes are read side by side.
 */

import type { Closer } from '../brackets.ts';

export interface Region {
  /** What a line break does here: nothing (brackets), end the region, or separate items. */
  readonly lineBreaks: 'ignored' | 'end' | 'separate';
  /** Index of the first token that may start a line without reading as a break. */
  start: number;
  readonly closer: Closer | undefined;
  /** Whether the closer is this region's own, rather than one it keeps from an enclosing region. */
  readonly ownsCloser: boolean;
  /** A block's column; undefined for any other region, entries in braces included. */
  readonly column: number | undefined;
  /** Index of the token where a bracket no closer matches ends. */
  readonly until?: number | undefined;
}

/** A region before the index it starts at is known: it starts at the next token. */
export type LineRegionShape = Omit<Region, 'start'>;

/** A module's top level, where a line break ends what is being parsed. */
export function topLevelRegion(): Region {
  return { lineBreaks: 'end', start: 0, closer: undefined, ownsCloser: false, column: undefined };
}

/** Inside a bracket from `start`, where line breaks are ignored, up to `closer` or `until`. */
export function bracketRegion(start: number, closer: Closer, until: number | undefined): Region {
  return { lineBreaks: 'ignored', start, closer, ownsCloser: true, column: undefined, until };
}

/** `{…}` whose lines form a block at `column`, as a block expression's do. */
export function blockBracesRegion(column: number): LineRegionShape {
  return { lineBreaks: 'separate', closer: '}', ownsCloser: true, column };
}

/** `{…}` whose entries are separated by `;` or line breaks, at any column. */
export function entryBracesRegion(): LineRegionShape {
  return { lineBreaks: 'separate', closer: '}', ownsCloser: true, column: undefined };
}

/** A block at `column`, ended by the closer of the region it sits in. */
export function blockRegion(closer: Closer | undefined, column: number): LineRegionShape {
  return { lineBreaks: 'separate', closer, ownsCloser: false, column };
}

/** Where line breaks are ignored from `start`, as in brackets, though no closer ends it. */
export function unbracketedRegion(start: number): Region {
  return { lineBreaks: 'ignored', start, closer: undefined, ownsCloser: false, column: undefined };
}

/** Where a line break, after its first token, ends the region; `closer` is the one around it. */
export function oneLineRegion(closer: Closer | undefined): LineRegionShape {
  return { lineBreaks: 'end', closer, ownsCloser: false, column: undefined };
}
