/**
 * What a type lacks to meet a constraint beyond its functions and fields, in words a diagnostic
 * finishes ("it needs …"): the associated types a trait requires (§3.10), and the entries of a
 * struct constraint (§3.5). Each judgment is pure; whether a type meets a trait and which goals
 * are active on the search stack is the caller's to say (`Meets`, conformance.ts), so these rules
 * sit beside conformance without a cycle.
 *
 * - A required associated type is met by the type's own (§3.1), which meets the bound; a union or
 *   an `any` type has none, so it meets such a trait only for calls on its values (conformance.ts
 *   `callWitnessesFor`).
 * - Only a struct type meets a struct constraint: a struct declaration, not a shared or extern
 *   one, or a shape. Each named entry needs its field, of exactly its type or meeting its
 *   constraints; the others' entry holds for every field the constraint doesn't name. A concrete
 *   struct already active on the search stack for the same struct constraint counts as meeting it
 *   (coinductive, §3.5). A type known only per instantiation meets one when its own struct
 *   constraints imply it (`entailed`).
 */

import type { RequiredAssociatedType } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { isOneMember } from '../../types/fitting/member-arguments.ts';
import { sameType } from '../../types/identity/identity.ts';
import {
  constraintOn,
  type Substitution,
  substitute,
  substituteConstraint,
} from '../../types/parts/substitution.ts';
import { constraintSubstitution, requiredAssociatedTypes } from '../../types/traits/constraints.ts';
import { rulesImply, structConstraintsOn } from '../../types/traits/known-constraints.ts';
import { isStructType } from '../../types/traits/struct-keys.ts';
import { isOpaque, unfolded } from '../../types/type/computed-types.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { literalType } from '../../types/type/primitives.ts';
import {
  constraintSetText,
  type EntryRule,
  type StructConstraintModel,
  structConstraintText,
  substituteStructConstraint,
} from '../../types/type/struct-constraint.ts';
import { typeText } from '../../types/type/type-text.ts';

/**
 * Whether `type` meets the trait `constraint` names, as the caller judges it (`conformance.ts`),
 * with the goals active on the search stack (`enter`) and whether a search reached the depth bound
 * (`reportEndless`).
 */
export interface Meets {
  (type: Type, constraint: Constraint): boolean;
  /**
   * Runs `step` with `(type, goal)` marked active; returns `undefined` (no shortfall) when
   * `(type, goal)` is reached again while still active.
   */
  readonly enter: (
    type: Type,
    goal: Constraint | StructConstraintModel,
    step: () => string | undefined,
  ) => string | undefined;
  /**
   * Whether a trait search reached the depth bound (5114), reporting it at the root use site when
   * so.
   */
  readonly reportEndless: () => boolean;
}

/**
 * The first associated type `constraint`'s trait requires that `type` lacks, or whose bound it
 * doesn't meet, said as it lacks it. A union has none of its own (§3.1), so it never meets such a
 * trait as a type; a call on its values runs its members' functions (`callWitnessesFor`).
 */
export function associatedShortfall(
  checker: CheckerContext,
  type: Type,
  constraint: Constraint,
  meets: Meets,
): string | undefined {
  const substitution = constraintSubstitution(constraint, type);
  for (const requirement of requiredAssociatedTypes(constraint.trait)) {
    const name = requirement.name.text;
    if (type.kind === 'union') {
      return `an associated type '${name}', which a union never has, each member having its own`;
    }
    const associated = checker.typeRules.associatedType(type, name);
    if (associated.kind === 'error' && associated.unreduced === undefined) {
      return `an associated type '${name}'`;
    }
    // One naming no type is the type's own, reported where an instantiation reaching it is written.
    const unmet =
      associated.kind === 'error'
        ? undefined
        : boundShortfall(checker, { requirement, associated, substitution }, meets);
    if (unmet !== undefined) {
      return unmet;
    }
  }
  return undefined;
}

/** The bound of a requirement `associated`, a type's own associated type, doesn't meet, as said. */
function boundShortfall(
  checker: CheckerContext,
  {
    requirement,
    associated,
    substitution,
  }: {
    readonly requirement: RequiredAssociatedType;
    readonly associated: Type;
    readonly substitution: Substitution;
  },
  meets: Meets,
): string | undefined {
  const bounds = checker.associatedBoundsOf(requirement);
  const rules = checker.typeRules;
  const union =
    bounds.memberOf === undefined ? undefined : substitute(bounds.memberOf, substitution, rules);
  if (union !== undefined && !isOneMember(union, associated, checker.fitting.memberUnionOf)) {
    return `its associated type '${requirement.name.text}' (${typeText(associated)}) to be one member of ${typeText(union)}`;
  }
  const unmet = bounds.traits.find(
    (bound) => !meets(associated, substituteConstraint(bound, substitution, rules)),
  );
  const structs = bounds.structs.map((each) =>
    substituteStructConstraint(each, substitution, rules),
  );
  return unmet !== undefined ||
    structs.some((struct) => structShortfall(checker, associated, struct, meets) !== undefined)
    ? `its associated type '${requirement.name.text}' (${typeText(associated)}) to be ${constraintSetText(bounds)}`
    : undefined;
}

/**
 * Why `type` doesn't meet the struct constraint `model`, as a clause leading the diagnostic (the
 * field and what it doesn't meet, §3.5); undefined when it meets it. Traits an entry asks for are
 * met as `meets` says, with `(type, model)` active on the stack while its fields are checked.
 */
export function structShortfall(
  checker: CheckerContext,
  type: Type,
  model: StructConstraintModel,
  meets: Meets,
): string | undefined {
  if (type.kind === 'error') {
    return undefined;
  }
  if (isOpaque(type)) {
    return opaqueShortfall(checker, type, model, meets);
  }
  const target = unfolded(type);
  if (!isStructType(target)) {
    return `${typeText(type)} is no struct type`;
  }
  return meets.enter(target, model, () => fieldsShortfall(checker, { type, target }, model, meets));
}

function fieldsShortfall(
  checker: CheckerContext,
  { type, target }: { readonly type: Type; readonly target: Type },
  model: StructConstraintModel,
  meets: Meets,
): string | undefined {
  const fields = checker.fieldsOf(target) ?? [];
  for (const entry of model.named) {
    const field = fields.find((each) => each.name === entry.name);
    if (field === undefined) {
      return `${typeText(type)} has no field '${entry.name}'`;
    }
    const shortfall = ruleShortfall(checker, field, entry.rule, meets);
    if (shortfall !== undefined) {
      return shortfall;
    }
  }
  const { others } = model;
  if (others === undefined) {
    return undefined;
  }
  const named = new Set(model.named.map((entry) => entry.name));
  for (const field of fields.filter((each) => !named.has(each.name))) {
    const shortfall = ruleShortfall(checker, field, others, meets);
    if (shortfall !== undefined) {
      return shortfall;
    }
  }
  return undefined;
}

/** Why a field, by its name and type, doesn't meet an entry's `rule`, as `structShortfall` says. */
function ruleShortfall(
  checker: CheckerContext,
  { name, type: fieldType }: { readonly name: string; readonly type: Type },
  rule: EntryRule,
  meets: Meets,
): string | undefined {
  const field = () => `field '${name}: ${typeText(fieldType)}'`;
  if (rule.kind === 'type') {
    return sameType(fieldType, rule.type) ? undefined : `${field()} isn't ${typeText(rule.type)}`;
  }
  const rules = checker.typeRules;
  const unmet = rule.traits.find(
    (trait) => !meets(fieldType, constraintOn(trait, fieldType, rules)),
  );
  if (unmet !== undefined) {
    return `${field()} doesn't meet ${unmet.trait.name.text}`;
  }
  for (const struct of rule.structs) {
    const shortfall = structShortfall(checker, fieldType, struct, meets);
    if (shortfall !== undefined) {
      return `in ${field()}, ${shortfall}`;
    }
  }
  return undefined;
}

/**
 * What a type known only per instantiation lacks to meet `model`, judged by what its own struct
 * constraints imply (`knownShortfall`).
 */
function opaqueShortfall(
  checker: CheckerContext,
  type: Type,
  model: StructConstraintModel,
  meets: Meets,
): string | undefined {
  const known = knownFields(structConstraintsOn(checker, type));
  if (known === undefined) {
    return `${typeText(type)} is no struct type`;
  }
  const field = (name: string) =>
    `field '${name}: ${typeText(checker.typeRules.fieldType(type, literalType(name)))}'`;
  return knownShortfall(checker, model, meets, {
    known,
    absent: (name) => `${typeText(type)} has no field '${name}'`,
    field,
    others: `${typeText(type)}'s other fields`,
  });
}

/**
 * The fields a struct is known to have, for `knownShortfall`, and how it names what it finds: a
 * field `model` names that is absent, a field, the others.
 */
interface DescribedFields {
  readonly known: KnownFields;
  readonly absent: (name: string) => string;
  readonly field: (name: string) => string;
  readonly others: string;
}

/**
 * What a struct the fields `known` describe lacks to meet `model`: each field `model` names must be
 * one `known` names, with rules implying its entry's; and, when `model` constrains its other
 * fields, every field `known` names beyond `model`'s, and every field it leaves to its others'
 * entries, must meet that rule.
 */
function knownShortfall(
  checker: CheckerContext,
  model: StructConstraintModel,
  meets: Meets,
  { known, ...words }: DescribedFields,
): string | undefined {
  for (const entry of model.named) {
    const rules = known.named.get(entry.name);
    if (rules === undefined) {
      return words.absent(entry.name);
    }
    if (!entailed(checker, rules, entry.rule, meets)) {
      return `${words.field(entry.name)} isn't known to be ${ruleText(entry.rule)}`;
    }
  }
  const { others } = model;
  if (others === undefined) {
    return undefined;
  }
  const named = new Set(model.named.map((entry) => entry.name));
  for (const [name, rules] of known.named) {
    if (!(named.has(name) || entailed(checker, rules, others, meets))) {
      return `${words.field(name)} isn't known to be ${ruleText(others)}`;
    }
  }
  return entailed(checker, known.others, others, meets)
    ? undefined
    : `${words.others} aren't known to be ${ruleText(others)}`;
}

/**
 * What struct constraints, all met at once, say of a struct's fields: the rules each field one of
 * them names must meet, its entries' and the others' entries of those not naming it; and the rules
 * every field none of them names must meet, their others' entries, none for a field left open.
 */
interface KnownFields {
  readonly named: ReadonlyMap<string, readonly EntryRule[]>;
  readonly others: readonly EntryRule[];
}

/**
 * What `models` say of a struct's fields; undefined for none, which says it is no struct at all.
 */
function knownFields(models: readonly StructConstraintModel[]): KnownFields | undefined {
  if (models.length === 0) {
    return undefined;
  }
  const names = new Set(models.flatMap((model) => model.named.map((entry) => entry.name)));
  const named = new Map(
    [...names].map((name) => [
      name,
      models.flatMap((model) => {
        const rule = model.named.find((entry) => entry.name === name)?.rule ?? model.others;
        return rule === undefined ? [] : [rule];
      }),
    ]),
  );
  return { named, others: models.flatMap((model) => model.others ?? []) };
}

/** What an entry's rule asks, as a message says it. */
function ruleText(rule: EntryRule): string {
  return rule.kind === 'type' ? typeText(rule.type) : constraintSetText(rule);
}

/**
 * Whether every field meeting all of `given` meets `needed` too: an exact type among them decides
 * it, as that type meets `needed` or not; otherwise `needed` can't ask an exact type, each trait it
 * asks is one they imply (`rulesImply`), and each struct constraint it asks is implied
 * by theirs, all met at once.
 */
function entailed(
  checker: CheckerContext,
  given: readonly EntryRule[],
  needed: EntryRule,
  meets: Meets,
): boolean {
  const exact = given.find((rule) => rule.kind === 'type');
  if (exact !== undefined) {
    return ruleShortfall(checker, { name: '_', type: exact.type }, needed, meets) === undefined;
  }
  if (needed.kind === 'type') {
    return false;
  }
  const structs = given.flatMap((rule) => (rule.kind === 'meets' ? rule.structs : []));
  return (
    needed.traits.every((trait) => rulesImply(checker, given, trait, meets)) &&
    needed.structs.every((struct) => structEntailed(checker, structs, struct, meets))
  );
}

/** Whether every struct meeting all of `given` meets `needed`. */
function structEntailed(
  checker: CheckerContext,
  given: readonly StructConstraintModel[],
  needed: StructConstraintModel,
  meets: Meets,
): boolean {
  const known = knownFields(given);
  return (
    known !== undefined &&
    knownShortfall(checker, needed, meets, {
      known,
      absent: (name) => name,
      field: (name) => name,
      others: '',
    }) === undefined
  );
}

/** Whether `argument` meets the struct constraint `model`, reporting at `site` what it lacks. */
export function meetsStructModel(
  site: UseSite,
  argument: Type,
  model: StructConstraintModel,
  meets: Meets,
): boolean {
  const shortfall = structShortfall(site.checker, argument, model, meets);
  if (shortfall === undefined) {
    return true;
  }
  if (!meets.reportEndless()) {
    const constraint = structConstraintText(model);
    site.report((at) =>
      checkerDiagnostics.unmetStructConstraint(at, shortfall, typeText(argument), constraint),
    );
  }
  return false;
}
