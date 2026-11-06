/**
 * Field order (§3.1 "Field order", §9): every struct's fields, nominal or shape, are laid out by
 * name, as JSON orders keys, and values given field by field in another order take that layout
 * by name. One home, so layout, literals, conversions and the computed forms that visit a struct's
 * fields (keys, mapped types, field loops) agree on it.
 */

import { compareOrdered } from '../../../../foundation/language/order.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';

/**
 * `fields` in the one order every struct lays its fields out in, nominal or shape: by name, as JSON
 * orders keys (§3.1 "Field order", §9). Declaration order is what evaluation follows, and only it:
 * a default sees the fields declared before it, and a literal evaluates its fields as written.
 */
export function inFieldOrder<Named extends { readonly name: string }>(
  fields: readonly Named[],
): readonly Named[] {
  return fields.toSorted((first, second) => compareOrdered(first.name, second.name));
}

/**
 * The values of a struct's `fields`, in its layout, each taken by its field's name from `named`:
 * how a value given field by field in another order, a literal's in declaration order or another
 * struct type's, takes its own type's layout (§3.1).
 */
export function laidOut<Value>(
  fields: readonly { readonly name: string }[],
  named: ReadonlyMap<string, Value>,
): Value[] {
  return fields.map(
    ({ name }) => named.get(name) ?? unreachable(`No value is given for the field '${name}'.`),
  );
}

/** The values of a struct laid out as `fields`, each by its field's name: `laidOut`'s inverse. */
export function namedValues<Value>(
  fields: readonly { readonly name: string }[],
  values: readonly Value[],
): ReadonlyMap<string, Value> {
  return new Map(
    values.map((value, index) => [
      fields[index]?.name ?? unreachable(`No field is laid out at position ${index}.`),
      value,
    ]),
  );
}
