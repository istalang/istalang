/**
 * A struct constraint's model (§3.5), the part of the type model constraints after `is` share: the
 * fields its entries name, in name order as every struct's fields are (§3.1), each an exact type or
 * a constraint set, and what every other field must be. Resolving one from syntax is
 * traits/struct-constraints.ts's; here it is substituted, compared and spelled.
 */

import { sameItems } from '../../../structures/equality.ts';
import { sameConstraintSpelled, sameTypeSpelled } from './parts/type-parts.ts';
import { type Substitution, substitute, substituteConstraint } from './substitution.ts';
import type { Constraint, Type } from './type.ts';
import type { TypeRules } from './type-rules.ts';
import { constraintText, typeText } from './type-text.ts';

/** A struct constraint, resolved (§3.5): its named fields' rules, in name order, and the others'. */
export interface StructConstraintModel {
  readonly named: readonly NamedEntry[];
  readonly others: EntryRule | undefined;
}

/** An entry naming one field, and its rule. */
interface NamedEntry {
  readonly name: string;
  readonly rule: EntryRule;
}

/** What a constraint after `is` asks: traits, and struct constraints. */
export interface ConstraintSet {
  readonly traits: readonly Constraint[];
  readonly structs: readonly StructConstraintModel[];
}

/** What an entry asks of a field's type: to be exactly `type`, or to meet a constraint set. */
export type EntryRule =
  | { readonly kind: 'type'; readonly type: Type }
  | ({ readonly kind: 'meets' } & ConstraintSet);

/** `model` with `substitution` applied to every type it holds. */
export function substituteStructConstraint(
  model: StructConstraintModel,
  substitution: Substitution,
  rules: TypeRules,
): StructConstraintModel {
  const rule = (each: EntryRule): EntryRule =>
    each.kind === 'type'
      ? { kind: 'type', type: substitute(each.type, substitution, rules) }
      : {
          kind: 'meets',
          traits: each.traits.map((trait) => substituteConstraint(trait, substitution, rules)),
          structs: each.structs.map((struct) =>
            substituteStructConstraint(struct, substitution, rules),
          ),
        };
  return {
    named: model.named.map((entry) => ({ name: entry.name, rule: rule(entry.rule) })),
    others: model.others === undefined ? undefined : rule(model.others),
  };
}

/** Whether two struct constraints are alike in every part, as a taken-over result must be. */
export function sameStructConstraint(
  first: StructConstraintModel,
  second: StructConstraintModel,
): boolean {
  const sameRule = (one: EntryRule | undefined, other: EntryRule | undefined): boolean => {
    if (one === undefined || other === undefined) {
      return one === other;
    }
    if (one.kind === 'type') {
      return other.kind === 'type' && sameTypeSpelled(one.type, other.type);
    }
    return (
      other.kind === 'meets' &&
      sameItems(sameConstraintSpelled)(one.traits, other.traits) &&
      sameItems(sameStructConstraint)(one.structs, other.structs)
    );
  };
  return (
    sameItems(
      (one: NamedEntry, other: NamedEntry) =>
        one.name === other.name && sameRule(one.rule, other.rule),
    )(first.named, second.named) && sameRule(first.others, second.others)
  );
}

/** `model` as source would write it, for messages. */
export function structConstraintText(model: StructConstraintModel): string {
  const entries = [
    ...model.named.map((entry) => `${entry.name}${ruleText(entry.rule)}`),
    ...(model.others === undefined ? [] : [`[_]${ruleText(model.others)}`]),
  ];
  return entries.length === 0 ? 'struct' : `struct { ${entries.join(', ')} }`;
}

function ruleText(rule: EntryRule): string {
  if (rule.kind === 'type') {
    return `: ${typeText(rule.type)}`;
  }
  return ` is ${constraintSetText(rule)}`;
}

/** A constraint set as `A & struct { … }` writes it. */
export function constraintSetText({ traits, structs }: ConstraintSet): string {
  return [...traits.map(constraintText), ...structs.map(structConstraintText)].join(' & ');
}
