/**
 * Which field a struct literal's item gives (§3.1): a named item, and the shorthand `first` for
 * `first: first`, give the field of their name; a positional item gives the struct's one field.
 * A literal builds a value by this rule, and a struct target of an assignment takes one apart by
 * it, so the two can't read items differently.
 */

import type { FieldItem } from '../../syntax/expressions.ts';
import type { FieldMember } from '../types/type.ts';

/** The index among `fields` of the field `item` gives; -1 when it gives none of them. */
export function itemField(item: FieldItem, fields: readonly FieldMember[]): number {
  if (item.kind === 'PositionalInitializer') {
    return fields.length === 1 ? 0 : -1;
  }
  return fields.findIndex((field) => field.name === item.name.text);
}
