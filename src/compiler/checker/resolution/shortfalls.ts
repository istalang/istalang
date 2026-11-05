/**
 * What a type lacks to meet a constraint beyond its functions, in words a diagnostic finishes ("it
 * needs …"): the fields and associated types a trait requires (§3.10), and the entries of a struct
 * constraint (§3.5). Each judgment is pure; whether a type meets a trait is the caller's to say
 * (`Meets`, conformance.ts), so these rules sit beside conformance without a cycle.
 *
 * - A required field is met by a struct field of the same name and type, or through a constraint
 *   requiring it too. A required associated type is met by the type's own (§3.1), which meets the
 *   bound; a union meets a trait through its members (union-traits.ts), each with its own.
 * - Only a struct type meets a struct constraint: a struct declaration, not a shared or extern
 *   one, or a shape. Each named entry needs its field, of exactly its type or meeting its
 *   constraints; the others' entry holds for every field the constraint doesn't name. A type known
 *   only per instantiation meets one through its own struct constraints, which must state as much.
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
 * doesn't meet, said as it lacks it; a union's members each have their own.
 */
export function associatedShortfall(
  checker: CheckerContext,
  type: Type,
  constraint: Constraint,
  meets: Meets,
): string | undefined {
  if (type.kind === 'union') {
    return undefined;
  }
  const substitution = constraintSubstitution(constraint, type);
  for (const requirement of requiredAssociatedTypes(constraint.trait)) {
    const name = requirement.name.text;
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
 * What a type known only per instantiation lacks to meet `model`, judged by its own struct
 * constraints: each field `model` names must be one they name, meeting its entry, and every field
 * they leave to its others' entry, or name beyond `model`'s, must meet `model`'s others' entry.
 */
function opaqueShortfall(
  checker: CheckerContext,
  type: Type,
  model: StructConstraintModel,
  meets: Meets,
): string | undefined {
  const own = structConstraintsOn(checker, type);
  if (own.length === 0) {
    return 'to be a struct type';
  }
  const ownNamed = new Set(own.flatMap((each) => each.named.map((entry) => entry.name)));
  const fieldNamed = (name: string) => ({
    name,
    type: checker.typeRules.fieldType(type, literalType(name)),
  });
  for (const entry of model.named) {
    if (!ownNamed.has(entry.name)) {
      return `a field '${entry.name}'`;
    }
    const shortfall = ruleShortfall(checker, fieldNamed(entry.name), entry.rule, meets);
    if (shortfall !== undefined) {
      return shortfall;
    }
  }
  const { others } = model;
  if (others === undefined) {
    return undefined;
  }
  const named = new Set(model.named.map((entry) => entry.name));
  for (const name of [...ownNamed].filter((each) => !named.has(each))) {
    const shortfall = ruleShortfall(checker, fieldNamed(name), others, meets);
    if (shortfall !== undefined) {
      return shortfall;
    }
  }
  const ownOthers = own.flatMap((each) => (each.others === undefined ? [] : [each.others]));
  const met = ownOthers.some((rule) => entails(checker, rule, others, meets));
  return met ? undefined : `every other field to be ${ruleText(others)}`;
}

/** What an entry's rule asks, as a message says it. */
function ruleText(rule: EntryRule): string {
  return rule.kind === 'type' ? typeText(rule.type) : constraintSetText(rule);
}

/**
 * Whether every field meeting `given` meets `needed` too: an exact type meeting it, or a
 * constraint set asking at least as much; a nested struct constraint is entailed only by an exact
 * type meeting it.
 */
function entails(
  checker: CheckerContext,
  given: EntryRule,
  needed: EntryRule,
  meets: Meets,
): boolean {
  if (given.kind === 'type') {
    return ruleShortfall(checker, { name: '_', type: given.type }, needed, meets) === undefined;
  }
  if (needed.kind === 'type' || needed.structs.length > 0) {
    return false;
  }
  return needed.traits.every((trait) =>
    given.traits.some(
      (each) =>
        each.trait === trait.trait &&
        each.arguments.length === trait.arguments.length &&
        each.arguments.every((argument, index) => {
          const other = trait.arguments[index];
          return other !== undefined && sameType(argument, other);
        }),
    ),
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
