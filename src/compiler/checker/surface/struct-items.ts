/**
 * Which field a struct item gives (§3.1): a named item, and the shorthand `first` for `first:
 * first`, give the field of their name; a positional item gives a struct's one field, but none of a
 * variant's, whose fields braces name and only a call gives by position (§3.11). A literal builds
 * a value by this rule, a struct target takes one apart by it (constructs/patterns/walk/parts.ts),
 * and completion offers the fields a literal's items leave by it, so none reads items differently.
 *
 * Where a call pattern's argument reaches among its variant's fields, as a call's arguments bind
 * (resolution/choosing/binding.ts), is here too (`argumentsReach`): the checker binds a pattern's
 * arguments that can't all bind by it, and completion reads what an argument matches by it.
 */

import { isRestField } from '../../syntax/declarations/index.ts';
import type { PatternArgument } from '../../syntax/patterns.ts';
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

/** Where a call pattern's argument reaches among its variant's fields: a field, or its items. */
export interface ReachedField {
  readonly index: number;
  /** Whether it matches an item of the rest field at `index`, rather than the field whole. */
  readonly isItem: boolean;
}

/**
 * By argument, where each of a call pattern's `given` arguments, its last `...` aside, reaches
 * among `fields` though they may not all bind (§3.11): a fixed field its position gives, before
 * any spread, and past those an item of the rest field; the rest field whole for the first spread;
 * the field a name names, unless an earlier argument took it. Any other reaches none.
 */
export function argumentsReach(
  fields: readonly FieldMember[],
  given: readonly PatternArgument[],
): readonly (ReachedField | undefined)[] {
  const restAt = fields.findIndex(
    (field) => field.declared !== undefined && isRestField(field.declared.node),
  );
  const fixed = restAt === -1 ? fields.length : restAt;
  const spreadAt = given.findIndex((argument) => argument.kind === 'RestPattern');
  const positional = given.filter(
    (argument, index) =>
      argument.kind !== 'NamedPatternArgument' && (spreadAt === -1 || index < spreadAt),
  );
  const byPosition = Math.min(positional.length, fixed);
  const firstNamed = new Map<string, number>();
  for (const [index, argument] of given.entries()) {
    if (argument.kind === 'NamedPatternArgument' && !firstNamed.has(argument.name.text)) {
      firstNamed.set(argument.name.text, index);
    }
  }
  return given.map((argument, index) => {
    if (argument.kind === 'NamedPatternArgument') {
      const field = fields.findIndex(({ name }) => name === argument.name.text);
      const taken = field < byPosition || firstNamed.get(argument.name.text) !== index;
      return field === -1 || taken ? undefined : { index: field, isItem: false };
    }
    if (index === spreadAt) {
      return restAt === -1 ? undefined : { index: restAt, isItem: false };
    }
    return positionalReach(positional.indexOf(argument), fixed, restAt);
  });
}

/**
 * Where the argument `at` among those by position reaches: the fixed field there, else an item of
 * the rest field, at `restAt`; none for no position, or past the fields of a variant with no rest.
 */
function positionalReach(at: number, fixed: number, restAt: number): ReachedField | undefined {
  if (at !== -1 && at < fixed) {
    return { index: at, isItem: false };
  }
  return restAt === -1 || at === -1 ? undefined : { index: restAt, isItem: true };
}
