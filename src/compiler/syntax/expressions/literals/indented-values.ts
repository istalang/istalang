/**
 * What an indented value builds (§2), read off its entries alone, never the type it is built as,
 * so the parser reports what doesn't fit it and checking builds it (checker/desugaring/
 * indented-values.ts) by one rule.
 *
 * - The first entry deciding a form decides it: an item, an array; a quoted key, a map; a name, a
 *   shorthand or a struct comprehension, a struct. A value of spreads alone, and any below `T:`, is
 *   a struct.
 * - Each form holds its own entries, and the others are left out of what it builds: an array its
 *   items; a map its quoted keys and spreads; a struct its names, shorthands, spreads and struct
 *   comprehension.
 */

import type {
  IndentedEntry,
  IndentedItem,
  IndentedValue,
  QuotedEntry,
  Spread,
  StructLiteral,
} from '../index.ts';

/** What an indented value builds. */
export type LiteralForm = 'struct' | 'map' | 'array';

/** What `value` builds: what its first deciding entry says, a struct below `T:`. */
export function formOf(value: IndentedValue): LiteralForm {
  if (value.type !== undefined) {
    return 'struct';
  }
  const deciding = value.entries.find(
    (entry) => entry.kind !== 'Spread' && entry.kind !== 'Invalid',
  );
  switch (deciding?.kind) {
    case 'IndentedItem':
      return 'array';
    case 'QuotedEntry':
      return 'map';
    default:
      return 'struct';
  }
}

/** The entries `value` holds that what it builds leaves out, for the parser to report. */
export function entriesLeftOut(value: IndentedValue): readonly IndentedEntry[] {
  const holds = holdsOf[formOf(value)];
  return value.entries.filter((entry) => entry.kind !== 'Invalid' && !holds(entry));
}

/** An entry a struct literal holds as an item, as it was written. */
type StructItem = Extract<IndentedEntry, StructLiteral['items'][number]>;

/** Whether a struct holds `entry`: a name, a shorthand, a spread or a struct comprehension. */
export function isStructItem(entry: IndentedEntry): entry is StructItem {
  return (
    entry.kind === 'FieldInitializer' ||
    entry.kind === 'Spread' ||
    entry.kind === 'StructComprehension' ||
    entry.kind === 'Invalid'
  );
}

/** Whether a map holds `entry`: a quoted key or a spread. */
export function isMapItem(entry: IndentedEntry): entry is QuotedEntry | Spread {
  return entry.kind === 'QuotedEntry' || entry.kind === 'Spread';
}

/** Whether an array holds `entry`: an item. */
export function isArrayItem(entry: IndentedEntry): entry is IndentedItem {
  return entry.kind === 'IndentedItem';
}

const holdsOf: Record<LiteralForm, (entry: IndentedEntry) => boolean> = {
  struct: isStructItem,
  map: isMapItem,
  array: isArrayItem,
};
