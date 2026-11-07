/**
 * Which field a struct item gives (§3.1): a named item, and the shorthand `first` for `first:
 * first`, give the field of their name; a positional item gives a struct's one field, but none of a
 * variant's, whose fields braces name and only a call gives by position (§3.11). A literal builds
 * a value by this rule, a struct target takes one apart by it (constructs/patterns/walk/parts.ts),
 * and completion offers the fields a literal's items leave by it, so none reads items differently.
 */

import type { Identifier } from '../../syntax/tree/node.ts';
import type { FieldMember } from '../types/type/index.ts';

/** The index among `fields` of the field an item `named` gives; -1 when it gives none of them. */
export function itemField(named: Identifier | undefined, fields: readonly FieldMember[]): number {
  if (named === undefined) {
    return fields.length === 1 ? 0 : -1;
  }
  return fields.findIndex((field) => field.name === named.text);
}

/** The index among a variant's `fields` of the field an item `named` gives in braces; else -1. */
export function variantItemField(
  named: Identifier | undefined,
  fields: readonly FieldMember[],
): number {
  return named === undefined ? -1 : itemField(named, fields);
}
