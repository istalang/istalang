/**
 * What a type lacks to meet a constraint beyond its functions, in words a diagnostic finishes ("it
 * needs …"): the fields and associated types a trait requires (§3.10), and the entries of a struct
 * constraint (§3.5). Each judgment is pure; whether a type meets a trait is the caller's to say
 * (`Meets`, conformance.ts), so these rules sit beside conformance without a cycle.
 *
 * - A required field is met by a struct field of the same name and type, or through a constraint
 *   requiring it too. A required associated type is met by the type's own (§3.1), which meets the
 *   bound; a union or an `any` type has none, so it meets such a trait only for calls on its values
 *   (conformance.ts `callWitnessesFor`).
 * - Only a struct type meets a struct constraint: a struct declaration, not a shared or extern
 *   one, or a shape. Each named entry needs its field, of exactly its type or meeting its
 *   constraints; the others' entry holds for every field the constraint doesn't name. A type known
 *   only per instantiation meets one when its own struct constraints imply it (`entailed`).
 */

import type { TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import {
  constraintOn,
  constraintSubstitution,
  requiredAssociatedTypes,
  requiredFields,
  requiredFieldType,
} from '../traits/constraints.ts';
import { fieldOf, structConstraintsOn } from '../traits/known-constraints.ts';
import { sameType } from '../types/identity.ts';
import {
  constraintSetText,
  type EntryRule,
  type StructConstraintModel,
  structConstraintText,
  substituteStructConstraint,
} from '../types/struct-constraint.ts';
import { type Substitution, substituteConstraint } from '../types/substitution.ts';
import { type Constraint, isOpaque, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { literalType } from '../types/unions.ts';
import type { UseSite } from '../use-site.ts';

/** Whether `type` meets the trait `constraint` names, as the caller judges it. */
export type Meets = (type: Type, constraint: Constraint) => boolean;

/** The first field `constraint`'s trait requires that `type` lacks, said as it lacks it. */
export function fieldShortfall(
  checker: CheckerContext,
  type: Type,
  constraint: Constraint,
): string | undefined {
  for (const field of requiredFields(constraint.trait)) {
    const fieldType = requiredFieldType(checker, constraint, field, type);
    const found = fieldOf(checker, type, field.name.text);
    if (found === undefined || !sameType(found.member.type, fieldType)) {
      return `a field '${field.name.text}: ${typeText(fieldType)}'`;
    }
  }
  return undefined;
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
    if (associated.kind === 'error') {
      return `an associated type '${name}'`;
    }
    const bounds = checker.associatedBoundsOf(requirement);
    const rules = checker.typeRules;
    const unmet = bounds.traits.find(
      (bound) => !meets(associated, substituteConstraint(bound, substitution, rules)),
    );
    const structs = bounds.structs.map((each) =>
      substituteStructConstraint(each, substitution, rules),
    );
    if (
      unmet !== undefined ||
      structs.some((struct) => structShortfall(checker, associated, struct, meets) !== undefined)
    ) {
      return `its associated type '${name}' (${typeText(associated)}) to be ${constraintSetText(bounds)}`;
    }
  }
  return undefined;
}

/**
 * What `type` lacks to meet the struct constraint `model`; undefined when it meets it. Traits an
 * entry asks for are met as `meets` says.
 */
function structShortfall(
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
  if (!isStructType(type)) {
    return 'to be a struct type';
  }
  const fields = checker.fieldsOf(type) ?? [];
  for (const entry of model.named) {
    const field = fields.find((each) => each.name === entry.name);
    if (field === undefined) {
      return `a field '${entry.name}'`;
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

/** Whether `type` is a struct type (§3.5): a struct declaration's, not shared or extern, or a shape. */
function isStructType(type: Type): boolean {
  return (
    type.kind === 'anonymous' ||
    (type.kind === 'nominal' && type.entity.declaration.kind === 'StructDeclaration')
  );
}

/** What a field, by its name and type, lacks to meet an entry's `rule`. */
function ruleShortfall(
  checker: CheckerContext,
  { name, type: fieldType }: { readonly name: string; readonly type: Type },
  rule: EntryRule,
  meets: Meets,
): string | undefined {
  const field = `its field '${name}: ${typeText(fieldType)}'`;
  if (rule.kind === 'type') {
    return sameType(fieldType, rule.type) ? undefined : `${field} to be ${typeText(rule.type)}`;
  }
  const rules = checker.typeRules;
  const unmet = rule.traits.find(
    (trait) => !meets(fieldType, constraintOn(trait, fieldType, rules)),
  );
  if (unmet !== undefined) {
    return `${field} to meet ${unmet.trait.name.text}`;
  }
  for (const struct of rule.structs) {
    const shortfall = structShortfall(checker, fieldType, struct, meets);
    if (shortfall !== undefined) {
      return `${field} ${shortfall}`;
    }
  }
  return undefined;
}

/**
 * What a type known only per instantiation lacks to meet `model`, judged by what its own struct
 * constraints imply (`knownFields`): each field `model` names must be one they name, with rules
 * implying its entry's; and, when `model` constrains its other fields, every field they name beyond
 * `model`'s, and every field they leave to their own others' entries, must meet that rule.
 */
function opaqueShortfall(
  checker: CheckerContext,
  type: Type,
  model: StructConstraintModel,
  meets: Meets,
): string | undefined {
  const known = knownFields(structConstraintsOn(checker, type));
  if (known === undefined) {
    return 'to be a struct type';
  }
  const field = (name: string) =>
    `its field '${name}: ${typeText(checker.typeRules.fieldType(type, literalType(name)))}'`;
  for (const entry of model.named) {
    const rules = known.named.get(entry.name);
    if (rules === undefined) {
      return `a field '${entry.name}'`;
    }
    if (!entailed(checker, rules, entry.rule, meets)) {
      return `${field(entry.name)} to be ${ruleText(entry.rule)}`;
    }
  }
  const { others } = model;
  if (others === undefined) {
    return undefined;
  }
  const named = new Set(model.named.map((entry) => entry.name));
  for (const [name, rules] of known.named) {
    if (!(named.has(name) || entailed(checker, rules, others, meets))) {
      return `${field(name)} to be ${ruleText(others)}`;
    }
  }
  return entailed(checker, known.others, others, meets)
    ? undefined
    : `every other field to be ${ruleText(others)}`;
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

/** What `models` say of a struct's fields; undefined for none, which says it is no struct at all. */
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
 * asks is one they ask (traits have no supertraits), and each struct constraint it asks is implied
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
  const sets = given.flatMap((rule) => (rule.kind === 'meets' ? [rule] : []));
  const traits = sets.flatMap((set) => set.traits);
  const structs = sets.flatMap((set) => set.structs);
  return (
    needed.traits.every((trait) => traits.some((each) => sameConstraint(each, trait))) &&
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
  if (known === undefined) {
    return false;
  }
  const namedMet = needed.named.every((entry) => {
    const rules = known.named.get(entry.name);
    return rules !== undefined && entailed(checker, rules, entry.rule, meets);
  });
  const { others } = needed;
  if (!namedMet || others === undefined) {
    return namedMet;
  }
  const named = new Set(needed.named.map((entry) => entry.name));
  return (
    [...known.named].every(
      ([name, rules]) => named.has(name) || entailed(checker, rules, others, meets),
    ) && entailed(checker, known.others, others, meets)
  );
}

/** Whether two trait constraints are one: the same trait, with the same arguments. */
function sameConstraint(one: Constraint, other: Constraint): boolean {
  return (
    one.trait === other.trait &&
    one.arguments.length === other.arguments.length &&
    one.arguments.every((argument, index) => {
      const each = other.arguments[index];
      return each !== undefined && sameType(argument, each);
    })
  );
}

/**
 * Whether `argument`, given for `parameter` with the others in `substitution`, meets the struct
 * constraints on it, reporting at `site` what it lacks when it doesn't.
 */
export function meetsStructConstraints(
  site: UseSite,
  parameter: TypeParameter,
  { argument, substitution }: { readonly argument: Type; readonly substitution: Substitution },
  meets: Meets,
): boolean {
  const { checker } = site;
  for (const model of checker.structConstraintsOf(parameter)) {
    const mapped = substituteStructConstraint(model, substitution, checker.typeRules);
    const shortfall = structShortfall(checker, argument, mapped, meets);
    if (shortfall !== undefined) {
      const constraint = structConstraintText(mapped);
      site.report((at) =>
        checkerDiagnostics.notConforming(at, typeText(argument), constraint, shortfall),
      );
      return false;
    }
  }
  return true;
}
