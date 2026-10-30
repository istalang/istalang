/**
 * Which field a struct item gives (§3.1): a named item, and the shorthand `first` for
 * `first: first`, give the field of their name; a positional item gives the struct's one field.
 * A literal builds a value by this rule, a struct target takes one apart by it (patterns/parts.ts),
 * and completion offers the fields a literal's items leave by it, so none reads items differently.
 */

import type { Identifier } from '../syntax/node.ts';
import type { FieldMember } from './types/type.ts';

/** The index among `fields` of the field an item `named` gives; -1 when it gives none of them. */
export function itemField(named: Identifier | undefined, fields: readonly FieldMember[]): number {
  if (named === undefined) {
    return fields.length === 1 ? 0 : -1;
  }
  return fields.findIndex((field) => field.name === named.text);
}
