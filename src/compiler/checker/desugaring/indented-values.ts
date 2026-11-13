/**
 * Indented values (§2), each the brace or bracket literal its entries say it builds
 * (syntax/expressions/literals/indented-values.ts), checked and typed as that literal is where it
 * stands, so every rule of literals keeps its one home: `T{…}`, `new T{…}` or `struct{…}` of a
 * struct's entries; `["key": value, …]` of a map's quoted keys and spreads; `[…]` of an array's
 * items.
 *
 * - The literal keeps the entries' own nodes, so what checking records of them, lowering and tools
 *   read.
 * - Entries it leaves out were reported by the parser; their values are checked alone, so tools
 *   still read them.
 */

import type {
  ArrayLiteral,
  IndentedEntry,
  IndentedValue,
  MapLiteral,
  NewStructLiteral,
  StructLiteral,
} from '../../syntax/expressions/index.ts';
import {
  entriesLeftOut,
  formOf,
  isArrayItem,
  isMapItem,
  isStructItem,
  type LiteralForm,
} from '../../syntax/expressions/literals/indented-values.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { synthesized } from '../contexts/synthesized.ts';
import type { Desugar } from './index.ts';

export const indentedValues: Desugar<IndentedValue> = {
  core: (context, node) => {
    checkValuesAlone(context, entriesLeftOut(node));
    return synthesized({ sugar: node, role: 'literal' }, builders[formOf(node)](node));
  },
  wording: {},
};

/** The literal of each form an indented value builds, of the entries that form holds. */
const builders: {
  readonly [Form in LiteralForm]: (
    value: IndentedValue,
  ) => StructLiteral | NewStructLiteral | MapLiteral | ArrayLiteral;
} = {
  struct: ({ span, type, isNew, entries }) => {
    const items = entries.filter(isStructItem);
    if (type === undefined) {
      return { kind: 'StructLiteral', span, type, items };
    }
    return isNew
      ? { kind: 'NewStructLiteral', span, type, items }
      : { kind: 'StructLiteral', span, type, items };
  },
  map: ({ span, entries }) => ({
    kind: 'MapLiteral',
    span,
    entries: entries
      .filter(isMapItem)
      .map((entry) =>
        entry.kind === 'Spread'
          ? entry
          : { kind: 'MapEntry', span: entry.span, key: entry.key, value: entry.value },
      ),
  }),
  array: ({ span, entries }) => ({
    kind: 'ArrayLiteral',
    span,
    elements: entries.filter(isArrayItem).map((entry) => entry.value),
  }),
};

/** Checks every value `entries` hold, which their value's literal leaves out. */
function checkValuesAlone(context: BodyContext, entries: readonly IndentedEntry[]): void {
  for (const entry of entries) {
    switch (entry.kind) {
      case 'FieldInitializer':
        context.expression(entry.value ?? entry.name);
        break;
      case 'QuotedEntry':
        context.expression(entry.value);
        break;
      case 'Spread':
        context.expression(entry.expression);
        break;
      case 'IndentedItem':
        context.expression(entry.value.kind === 'Spread' ? entry.value.expression : entry.value);
        break;
      default:
        break;
    }
  }
}
