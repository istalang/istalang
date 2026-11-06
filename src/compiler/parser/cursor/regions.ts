/**
 * The regions the cursor reads tokens in (index.ts), one shape per kind: what a line break does
 * there, the closer that ends it, and whether that closer is its own. Each region the grammar
 * enters is made here, so the shapes are read side by side.
 */

import type { Closer } from './brackets.ts';

export interface Region {
  /**
   * What a line break does here: nothing (brackets), end the region, or separate a block's items;
   * in a list, nothing to the cursor, while the parser decides where one separates two items
   * (layout/item-breaks.ts).
   */
  readonly lineBreaks: 'ignored' | 'end' | 'separate' | 'betweenItems';
  /** Index of the first token that may start a line without reading as a break. */
  start: number;
  readonly closer: Closer | undefined;
  /** Whether the closer is this region's own, rather than one it keeps from an enclosing region. */
  readonly ownsCloser: boolean;
  /** A block's column; undefined for any other region. */
  readonly column: number | undefined;
  /**
   * Index of the token where a bracket no closer matches ends the region, or ends a region around
   * it (`entered`).
   */
  readonly until: number | undefined;
  /**
   * In a `<…>` list, the index of its `<`: `<` is no bracket, so nothing pairs it, and a line
   * heading no deeper than the `<`'s own ends the list unless its `>` heads it (§2), as one ends a
   * bracket left open (brackets.ts).
   */
  readonly angleOpener: number | undefined;
}

/** A region before the index it starts at is known: it starts at the next token. */
export type LineRegionShape = Omit<Region, 'start'>;

/**
 * What a region leaves out: no column, no end before its closer, no `<`. Every region spreads it
 * first, so all have one shape, which the cursor reads at every token.
 */
const plain = {
  column: undefined,
  until: undefined,
  angleOpener: undefined,
} as const satisfies Partial<Region>;

/** A module's top level, where a line break ends what is being parsed. */
export function topLevelRegion(): Region {
  return { ...plain, lineBreaks: 'end', start: 0, closer: undefined, ownsCloser: false };
}

/** Inside a bracket from `start`, where line breaks are ignored, up to `closer` or `until`. */
export function bracketRegion(start: number, closer: Closer, until: number | undefined): Region {
  return { ...plain, lineBreaks: 'ignored', start, closer, ownsCloser: true, until };
}

/** `{…}` whose lines form a block at `column`, as a block expression's do, up to `}` or `until`. */
export function blockBracesRegion(column: number, until: number | undefined): LineRegionShape {
  return { ...plain, lineBreaks: 'separate', closer: '}', ownsCloser: true, column, until };
}

/**
 * A list from `start`, whose items `,` or a line break separates (§2), up to `closer` or `until`:
 * the items of brackets, of `<…>`, and of the braces that list fields or variants.
 */
export function listRegion(start: number, closer: Closer, until: number | undefined): Region {
  return { ...plain, lineBreaks: 'betweenItems', start, closer, ownsCloser: true, until };
}

/** A `<…>` list from `start`, its `<` at `start - 1`, up to `>` or where indentation ends it. */
export function angleListRegion(start: number): Region {
  return { ...listRegion(start, '>', undefined), angleOpener: start - 1 };
}

/** A block at `column`, ended by the closer of the region it sits in. */
export function blockRegion(closer: Closer | undefined, column: number): LineRegionShape {
  return { ...plain, lineBreaks: 'separate', closer, ownsCloser: false, column };
}

/** Where line breaks are ignored from `start`, as in brackets, though no closer ends it. */
export function unbracketedRegion(start: number): Region {
  return { ...plain, lineBreaks: 'ignored', start, closer: undefined, ownsCloser: false };
}

/** Where a line break, after its first token, ends the region; `closer` is the one around it. */
export function oneLineRegion(closer: Closer | undefined): LineRegionShape {
  return { ...plain, lineBreaks: 'end', closer, ownsCloser: false };
}

/** `region` as entered inside `outer`: it ends no later than `outer` does. */
export function entered(region: Region, outer: Region): Region {
  const { until } = outer;
  return until === undefined || (region.until !== undefined && region.until <= until)
    ? region
    : { ...region, until };
}
