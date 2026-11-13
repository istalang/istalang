/**
 * What an indented value reads as (§2): the brace or bracket literal its entries say it builds,
 * made from its own entries, so every later phase checks and lowers that literal and no rule of
 * literals has a second home. Its entries alone decide, never the type it is built as.
 *
 * - The first entry deciding a form decides it: an item, an array, `[…]` of the items' values; a
 *   quoted key, a map, `["key": value, …]`; a name, a shorthand or a struct comprehension, a
 *   struct, `T{…}`, `new T{…}` or `struct{…}`. A value of spreads alone, and any below `T:`, is a
 *   struct.
 * - Entries the literal can't hold are left out of it: the parser reports them
 *   (parser/grammar/expressions/literals/indented-values.ts), and the checker checks their values
 *   alone. Each literal is made once per value and keeps the entries' own nodes, so what checking
 *   records of them, lowering and tools read.
 */

import { memo } from '../../../../foundation/structures/memo.ts';
import type {
  ArrayLiteral,
  IndentedEntry,
  IndentedValue,
  MapEntry,
  MapLiteral,
  NewStructLiteral,
  Spread,
  StructLiteral,
} from '../index.ts';

/** What an indented value builds. */
export type LiteralForm = 'struct' | 'map' | 'array';

/** The literal an indented value reads as, by its form. */
interface LiteralsByForm {
  readonly struct: StructLiteral | NewStructLiteral;
  readonly map: MapLiteral;
  readonly array: ArrayLiteral;
}

/** The literal an indented value reads as. */
export type BuiltLiteral = LiteralsByForm[LiteralForm];

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

const literals = new WeakMap<IndentedValue, BuiltLiteral>();

/** The literal `value` reads as, made once per value. */
export function literalOf(value: IndentedValue): BuiltLiteral {
  return memo(literals, value, () => builders[formOf(value)](value));
}

/** The entries `value` holds that its literal leaves out, for the parser to report. */
export function entriesLeftOut(value: IndentedValue): readonly IndentedEntry[] {
  const form = formOf(value);
  return value.entries.filter((entry) => entry.kind !== 'Invalid' && !holds[form](entry));
}

type StructItem = Extract<IndentedEntry, StructLiteral['items'][number]>;

/** Whether `entry` is one a struct literal holds as an item, as it was written. */
function isStructItem(entry: IndentedEntry): entry is StructItem {
  return (
    entry.kind === 'FieldInitializer' ||
    entry.kind === 'Spread' ||
    entry.kind === 'StructComprehension' ||
    entry.kind === 'Invalid'
  );
}

const holds: Record<LiteralForm, (entry: IndentedEntry) => boolean> = {
  struct: isStructItem,
  map: (entry) => entry.kind === 'QuotedEntry' || entry.kind === 'Spread',
  array: (entry) => entry.kind === 'IndentedItem',
};

const builders: { readonly [Form in LiteralForm]: (value: IndentedValue) => LiteralsByForm[Form] } =
  {
    struct: (value) => {
      const items = value.entries.filter(isStructItem);
      const { span } = value;
      if (value.type === undefined) {
        return { kind: 'StructLiteral', span, type: undefined, items };
      }
      return value.isNew
        ? { kind: 'NewStructLiteral', span, type: value.type, items }
        : { kind: 'StructLiteral', span, type: value.type, items };
    },
    map: (value) => ({
      kind: 'MapLiteral',
      span: value.span,
      entries: value.entries.flatMap((entry): readonly (MapEntry | Spread)[] => {
        switch (entry.kind) {
          case 'QuotedEntry':
            return [{ kind: 'MapEntry', span: entry.span, key: entry.key, value: entry.value }];
          case 'Spread':
            return [entry];
          default:
            return [];
        }
      }),
    }),
    array: (value) => ({
      kind: 'ArrayLiteral',
      span: value.span,
      elements: value.entries.flatMap((entry) =>
        entry.kind === 'IndentedItem' ? [entry.value] : [],
      ),
    }),
  };
