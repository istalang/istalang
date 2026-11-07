/**
 * Which field a struct item gives (§3.1): a named item, and the shorthand `first` for `first:
 * first`, give the field of their name; a positional item gives a struct's one field, but none of a
 * variant's, whose fields braces name and only a call gives by position (§3.11). A literal builds
 * a value by this rule, a struct target takes one apart by it (constructs/patterns/walk/parts.ts),
 * and completion offers the fields a literal's items leave by it, so none reads items differently.
 *
 * Which of a call pattern's arguments bind (`callPatternArguments`), and where each reaches among
 * its variant's fields, as a call's arguments bind (resolution/choosing/binding.ts), are here too
 * (`argumentsReach`): the checker binds a pattern's arguments by the one and those that can't all
 * bind by the other, and completion reads what an argument matches by it.
 */

import { isRestField } from '../../syntax/declarations/index.ts';
import type { OtherFieldsPattern, PatternArgument } from '../../syntax/patterns.ts';
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

/** A call pattern's argument binding may take: anything but a last `...`. */
export type BoundPatternArgument = Exclude<PatternArgument, OtherFieldsPattern>;

/**
 * A call pattern's arguments as binding takes them (§3.11): those it binds, and those the parser
 * refused (one it recovered, one by position after one by name, a second spread), which bind
 * nothing, so nothing more is reported of them; a last `...` is neither.
 */
export function callPatternArguments(written: readonly PatternArgument[]): {
  readonly given: readonly BoundPatternArgument[];
  readonly refused: readonly BoundPatternArgument[];
} {
  const bound = written.filter(
    (argument): argument is BoundPatternArgument => argument.kind !== 'OtherFieldsPattern',
  );
  const named = bound.findIndex(({ kind }) => kind === 'NamedPatternArgument');
  const spread = bound.findIndex(({ kind }) => kind === 'RestPattern');
  const isRefused = (argument: BoundPatternArgument, index: number) =>
    argument.kind === 'Invalid' ||
    argument.kind === 'Missing' ||
    (argument.kind !== 'NamedPatternArgument' && named !== -1 && index > named) ||
    (argument.kind === 'RestPattern' && index !== spread);
  return {
    given: bound.filter((argument, index) => !isRefused(argument, index)),
    refused: bound.filter(isRefused),
  };
}

/**
 * By argument written, where each of a call pattern's arguments reaches among `fields` though they
 * may not all bind (§3.11), as a call's would (resolution/choosing/binding.ts): a fixed field its
 * position gives, before any spread, and past those, or past the spread, an item of the rest field;
 * the rest field whole for the spread; the field a name names, unless an earlier argument took it.
 * A last `...`, an argument the parser refused (`callPatternArguments`) and any other reach none.
 */
export function argumentsReach(
  fields: readonly FieldMember[],
  written: readonly PatternArgument[],
): readonly (ReachedField | undefined)[] {
  const { given } = callPatternArguments(written);
  const restAt = fields.findIndex(
    (field) => field.declared !== undefined && isRestField(field.declared.node),
  );
  const spreadAt = given.findIndex((argument) => argument.kind === 'RestPattern');
  const positional = given.filter(
    (argument, index) =>
      argument.kind !== 'NamedPatternArgument' &&
      argument.kind !== 'RestPattern' &&
      (spreadAt === -1 || index < spreadAt),
  );
  const fixed = restAt === -1 ? fields.length : restAt;
  const firstNamed = new Map<string, BoundPatternArgument>();
  for (const argument of given) {
    if (argument.kind === 'NamedPatternArgument' && !firstNamed.has(argument.name.text)) {
      firstNamed.set(argument.name.text, argument);
    }
  }
  const binding: Reaching = {
    fields,
    restAt,
    fixed,
    positional,
    byPosition: Math.min(positional.length, fixed),
    firstNamed,
  };
  const bound: readonly PatternArgument[] = given;
  return written.map((argument) =>
    bound.includes(argument) ? reachOf(binding, argument as BoundPatternArgument) : undefined,
  );
}

/** What deciding where a call pattern's bound arguments reach reads of them and its fields. */
interface Reaching {
  readonly fields: readonly FieldMember[];
  /** The rest field's index; -1 for none. */
  readonly restAt: number;
  /** How many fields come before the rest field. */
  readonly fixed: number;
  /** The arguments by position before any spread, in order. */
  readonly positional: readonly BoundPatternArgument[];
  /** How many fixed fields those give. */
  readonly byPosition: number;
  /** By field name, the first argument naming it. */
  readonly firstNamed: ReadonlyMap<string, BoundPatternArgument>;
}

/** Where the bound `argument` reaches (`argumentsReach`). */
function reachOf(binding: Reaching, argument: BoundPatternArgument): ReachedField | undefined {
  const { fields, restAt, fixed, positional, byPosition, firstNamed } = binding;
  if (argument.kind === 'NamedPatternArgument') {
    const field = fields.findIndex(({ name }) => name === argument.name.text);
    const taken = field < byPosition || firstNamed.get(argument.name.text) !== argument;
    return field === -1 || taken ? undefined : { index: field, isItem: false };
  }
  if (argument.kind === 'RestPattern') {
    return restAt === -1 ? undefined : { index: restAt, isItem: false };
  }
  const at = positional.indexOf(argument);
  if (at !== -1 && at < fixed) {
    return { index: at, isItem: false };
  }
  return restAt === -1 ? undefined : { index: restAt, isItem: true };
}
