/**
 * What an indented value reads as (§2): the brace or bracket literal it builds, made from its own
 * entries, so every later phase checks and lowers that literal and no rule of literals has a second
 * home. Which literal it builds is the type's to decide (the checker's), never the syntax's.
 *
 * - As a struct: a `struct{…}`, `T{…}` or `new T{…}` of the entries a struct literal holds.
 * - As a map: `["key": value, …]`, a bare key read as the String it spells, so `LOG_LEVEL: 1` keys
 *   `"LOG_LEVEL"` and the shorthand `name` is `"name": name`.
 * - As an array: `[…]` of the items' values.
 *
 * Entries the literal can't hold are left out of it: the checker reports them
 * (expressions/literals/ indented-values.ts) and checks their values alone. Each literal is made
 * once per value and form and keeps the entries' own nodes, so what checking records of them,
 * lowering and tools read.
 */

import { memo } from '../../../../structures/memo.ts';
import type {
  ArrayLiteral,
  FieldInitializer,
  IndentedEntry,
  IndentedValue,
  MapEntry,
  MapLiteral,
  NewStructLiteral,
  Spread,
  StructLiteral,
} from '../index.ts';
import type { StringLiteral } from './literals.ts';

/** What an indented value is built as. */
export type LiteralForm = 'struct' | 'map' | 'array';

/** The literal an indented value reads as, by its form. */
interface LiteralsByForm {
  readonly struct: StructLiteral | NewStructLiteral;
  readonly map: MapLiteral;
  readonly array: ArrayLiteral;
}

/** The literal an indented value reads as, of its form. */
export type BuiltLiteral = LiteralsByForm[LiteralForm];

/** Whether `entry` is an item, `- value`, which only an array holds. */
export function isItem(entry: IndentedEntry): boolean {
  return entry.kind === 'IndentedItem';
}

/** Whether `entry` gives a key, which only a struct or a map holds: every entry but an item. */
export function isKeyed(entry: IndentedEntry): boolean {
  return entry.kind !== 'IndentedItem' && entry.kind !== 'Invalid';
}

/** The form a value whose type nothing decides builds (§2): items an array, a quoted key a map. */
export function untypedForm(value: IndentedValue): LiteralForm {
  if (value.entries.some(isItem) && !value.entries.some(isKeyed)) {
    return 'array';
  }
  return value.entries.some((entry) => entry.kind === 'QuotedEntry') ? 'map' : 'struct';
}

const literals = new WeakMap<IndentedValue, Map<LiteralForm, BuiltLiteral>>();

/** The literal `value` reads as when built as `form`, made once per value and form. */
export function literalOf<Form extends LiteralForm>(
  value: IndentedValue,
  form: Form,
): LiteralsByForm[Form] {
  const byForm = memo(literals, value, () => new Map<LiteralForm, BuiltLiteral>());
  return memo(byForm, form, () => builders[form](value)) as LiteralsByForm[Form];
}

const bareKeys = new WeakMap<FieldInitializer, StringLiteral>();

/**
 * The String a map's bare key reads as (`LOG_LEVEL:` keys `"LOG_LEVEL"`), made once per entry, so
 * what checking records of it as a key (§3.1 Key types), tools read through the entry.
 */
export function bareKeyOf(entry: FieldInitializer): StringLiteral {
  return memo(bareKeys, entry, () => ({
    kind: 'StringLiteral',
    span: entry.name.span,
    value: entry.name.text,
  }));
}

/** The entries `value` holds that the literal of `form` leaves out, for the checker to report. */
export function entriesLeftOut(value: IndentedValue, form: LiteralForm): readonly IndentedEntry[] {
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
  map: (entry) =>
    entry.kind === 'FieldInitializer' || entry.kind === 'QuotedEntry' || entry.kind === 'Spread',
  array: isItem,
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
          case 'FieldInitializer': {
            const { name, span } = entry;
            return [{ kind: 'MapEntry', span, key: bareKeyOf(entry), value: entry.value ?? name }];
          }
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
