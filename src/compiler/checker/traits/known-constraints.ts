/**
 * What a type meets by what it is (§3.5, §3.10): the constraints of a type parameter, of an `any`
 * type, and of the types computed from types not known yet, and through them its requirements and
 * associated types; its fields are read through them too (known-fields.ts). One home for these,
 * since each answer of a computed type is read from what the type it is computed from meets.
 *
 * - `T.Data` (§3.1) is one type, meeting the bound of every requirement of `Data` among what `T`
 *   meets (`type Data is C`); on a known type it is that type's own associated type, an alias
 *   substituted for the type's arguments. Inside a trait, `Self` meets the trait itself. A union or
 *   an `any` type has none: only a type's own declaration declares one. One whose body is no type
 *   `match` and reaches itself again while expanded can't be a type (§3.1): it and every one on
 *   the cycle back to it is the error type carrying it, where it would otherwise expand without
 *   end, however it is reached (types/substitution.ts), which each instantiation reaching it
 *   reports (resolution/type-matches/reduction-requirements.ts).
 * - `S["meta"]` (§3.5) meets what the entries of `S`'s struct constraints ask of that field; on a
 *   known struct it is the field's type, and an entry asking an exact type gives that type.
 * - A requirement on a type parameter or an `any` type is numbered by constraint and function
 *   (`ConstraintRequirement`); on a computed type it is the trait as `any` takes it, its witness
 *   chosen once an instantiation makes the type known (`ComputedRequirement`).
 */

import { withPushed } from '../../../structures/stack.ts';
import type {
  AssociatedType,
  RequiredAssociatedType,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import type { RequirementOrigin } from '../surface/resolved-call.ts';
import { type ComputedType, isMatchAlias, isOpaque } from '../types/computed-types.ts';
import { inFieldOrder } from '../types/field-order.ts';
import { sameConstraint, sameType } from '../types/identity/identity.ts';
import { typeKeys } from '../types/identity/type-keys.ts';
import { parametersIn } from '../types/parts/type-parts.ts';
import {
  type EntryRule,
  type StructConstraintModel,
  substituteStructConstraint,
} from '../types/struct-constraint.ts';
import { substitute, substituteConstraint, substitutionFor } from '../types/substitution.ts';
import { aliasedAs } from '../types/type/alias-uses.ts';
import type { AnyType, Constraint, Type } from '../types/type/index.ts';
import { errorType, isPrimitive } from '../types/type/primitives.ts';
import { literalType, membersOf, unionOf } from '../types/unions/unions.ts';
import { parameterType } from '../types/written/resolve-type.ts';
import { aliasInstance } from '../types/written/type-match.ts';
import {
  constraintOn,
  constraintSubstitution,
  type Requirement,
  requiredAssociatedTypes,
  requiredFunctions,
  traitAsAny,
} from './constraints.ts';

/**
 * The constraints `type` meets by what it is, each with `Self` the type itself: a type parameter's,
 * an `any` type's, a computed type's (the module's banner); none for any other type.
 */
export function knownConstraints(checker: CheckerContext, type: Type): readonly Constraint[] {
  switch (type.kind) {
    case 'any':
      return type.constraints.map((constraint) =>
        constraintOn(constraint, type, checker.typeRules),
      );
    case 'parameter':
      return type.declaration.kind === 'TypeParameter'
        ? checker.constraintsOf(type.declaration)
        : [];
    case 'associated':
      return boundsOf(checker, type).traits;
    case 'field':
      return entryRules(checker, type).flatMap((rule) =>
        rule.kind === 'meets'
          ? rule.traits.map((trait) => constraintOn(trait, type, checker.typeRules))
          : [],
      );
    default:
      return [];
  }
}

/** The struct constraints `type` meets by what it is: a type parameter's or a computed type's. */
export function structConstraintsOn(
  checker: CheckerContext,
  type: Type,
): readonly StructConstraintModel[] {
  switch (type.kind) {
    case 'parameter':
      return [
        ...(type.declaration.kind === 'TypeParameter'
          ? checker.structConstraintsOf(type.declaration)
          : []),
        ...(type.meeting === undefined ? [] : [type.meeting.constraint]),
      ];
    case 'associated':
      return boundsOf(checker, type).structs;
    case 'field':
      return entryRules(checker, type).flatMap((rule) =>
        rule.kind === 'meets' ? rule.structs : [],
      );
    case 'mapped':
      return [mappedStructConstraint(checker, type)];
    default:
      return [];
  }
}

/**
 * The struct constraint a mapped struct type whose keys aren't known yet meets by its shape
 * (§3.1): it is a struct type, each field its braces or a known key name has that field's type,
 * and each other field has its value for one of the keys not known yet: that type, or what it is
 * known to meet, unless the value differs from key to key in a way known only per instantiation.
 */
function mappedStructConstraint(
  checker: CheckerContext,
  type: Extract<Type, { readonly kind: 'mapped' }>,
): StructConstraintModel {
  const rules = checker.typeRules;
  const keys = membersOf(type.keys);
  const names = keys.flatMap((key) =>
    key.kind === 'literal' && typeof key.value === 'string' ? [key.value] : [],
  );
  const named = inFieldOrder([
    ...type.named.map((field) => ({ name: field.name, rule: fieldRule(checker, field.type) })),
    ...names.map((name) => ({
      name,
      rule: fieldRule(checker, rules.fieldType(type, literalType(name))),
    })),
  ]);
  const otherKeys = unionOf(
    keys.filter((key) => !(key.kind === 'literal' && typeof key.value === 'string')),
    rules,
  );
  if (isPrimitive(otherKeys, 'Never')) {
    return { named, others: undefined };
  }
  const { parameter } = type;
  const oneOther: Type = { kind: 'parameter', declaration: parameter, within: otherKeys };
  const value = substitute(type.value, new Map([[parameter, oneOther]]), rules);
  const varies = parametersIn(value).includes(parameter) && !isOpaque(value);
  return { named, others: varies ? undefined : fieldRule(checker, value) };
}

/** What a field of type `type` meets: that type, or, not known yet, what it is known to meet. */
function fieldRule(checker: CheckerContext, type: Type): EntryRule {
  return isOpaque(type)
    ? {
        kind: 'meets',
        traits: knownConstraints(checker, type),
        structs: structConstraintsOn(checker, type),
      }
    : { kind: 'type', type };
}

/**
 * Every function the constraints on `on` require, named `name`: on a type parameter, on an `any`
 * type, where each is the function its value's own type meets it with (§3.10), or on a type
 * computed from types not known yet.
 */
export function requirementsNamed(
  checker: CheckerContext,
  on: TypeParameter | AnyType | ComputedType,
  name: string,
): readonly Requirement[] {
  const type = on.kind === 'TypeParameter' ? parameterType(on) : on;
  return knownConstraints(checker, type).flatMap((constraint, constraintIndex) => {
    const substitution = constraintSubstitution(constraint, type);
    return requiredFunctions(constraint.trait).flatMap((declaration, member) => {
      if (declaration.name.text !== name) {
        return [];
      }
      const origin: RequirementOrigin =
        on.kind === 'TypeParameter' || on.kind === 'any'
          ? { kind: 'constraint', on, constraint: constraintIndex, member }
          : { kind: 'computed', on, through: traitAsAny(constraint, on), member };
      return [{ declaration, substitution, origin }];
    });
  });
}

/**
 * The associated type `name` of `of` (§3.1): a known nominal type's own, its declaration's alias
 * substituted for the type's arguments and written through it; on a type not known yet, the opaque
 * type naming it when one of its constraints requires it; else the error type.
 */
export function associatedTypeOf(
  checker: CheckerContext,
  of: Type,
  name: string,
  underWay: Expansion[],
): Type {
  if (of.kind === 'error') {
    return of;
  }
  const declared = associatedDeclarationOf(checker, of, name);
  if (declared === undefined) {
    return errorType;
  }
  if (of.kind !== 'nominal' || declared.kind !== 'AssociatedType') {
    return { kind: 'associated', of, name };
  }
  const substitution = substitutionFor(of.entity.declaration.typeParameters, of.arguments);
  const aliased = checker.aliasedType(declared);
  const instance = () => aliasInstance(declared, aliased, substitution, checker.typeRules);
  const use = { kind: 'associated', of, name } as const;
  if (isMatchAlias(declared)) {
    // A type `match` body finds its own recursion as it reduces
    // (resolution/type-matches/type-matches.ts).
    return aliasedAs(instance(), use);
  }
  const failure: Type = { kind: 'error', unreduced: { use, cause: 'expandsItself' } };
  const key = `${typeKeys.typeKey(of)}.${name}`;
  const again = underWay.findIndex((each) => each.key === key);
  if (again >= 0) {
    for (const each of underWay.slice(again)) {
      each.reachesItself = true;
    }
    return failure;
  }
  const expansion: Expansion = { key, reachesItself: false };
  const type = withPushed(underWay, expansion, instance);
  return expansion.reachesItself ? failure : aliasedAs(type, use);
}

/**
 * An associated type being expanded (§3.1), by owner and name, and whether expanding it reached it
 * again: each one expanded between its two uses is on that cycle, so none of them is a type, while
 * one that only holds them is, an error type in place of each.
 */
export interface Expansion {
  readonly key: string;
  reachesItself: boolean;
}

/**
 * What declares each associated type `of` has (§3.1): a known nominal type's own, or the
 * requirements of the traits `of` meets; none for any other type.
 */
export function associatedDeclarationsOn(
  checker: CheckerContext,
  of: Type,
): readonly (AssociatedType | RequiredAssociatedType)[] {
  if (of.kind === 'nominal') {
    const { declaration } = of.entity;
    return declaration.kind === 'ExternStructDeclaration' ? [] : declaration.associatedTypes;
  }
  const fields = of.kind === 'field' ? keyedFieldTypes(checker, of.of, of.key) : undefined;
  if (fields !== undefined) {
    const [first = [], ...others] = fields.map((type) => associatedDeclarationsOn(checker, type));
    return first.filter((declared) =>
      others.every((each) => each.some((other) => other.name.text === declared.name.text)),
    );
  }
  return isOpaque(of)
    ? constraintsDeclaring(checker, of).flatMap(({ trait }) => requiredAssociatedTypes(trait))
    : [];
}

/**
 * The types of the fields a key not known yet may name in `of`, a struct type known already, so
 * its field's type is one of these per instantiation; undefined for any other `of`, or a key known.
 */
function keyedFieldTypes(
  checker: CheckerContext,
  of: Type,
  key: Type,
): readonly Type[] | undefined {
  if (isOpaque(of) || !isOpaque(key)) {
    return undefined;
  }
  const fields = checker.fieldsOf(of);
  const types = keyMembers(checker, key).map(
    (member) =>
      fields?.find((field) => member.kind === 'literal' && field.name === member.value)?.type,
  );
  return types.every((type) => type !== undefined) ? types : undefined;
}

/**
 * The keys `key` may be, each one key: a union's members, a member parameter's union's, at any
 * depth (§3.5); anything else, itself.
 */
export function keyMembers(checker: CheckerContext, key: Type): readonly Type[] {
  return membersOf(key).flatMap((member) => {
    const union = member.kind === 'parameter' ? checker.fitting.memberUnionOf(member) : undefined;
    return union === undefined ? [member] : keyMembers(checker, union);
  });
}

/** What declares the associated type `name` of `of` (§3.1); undefined when it has none. */
function associatedDeclarationOf(
  checker: CheckerContext,
  of: Type,
  name: string,
): AssociatedType | RequiredAssociatedType | undefined {
  return associatedDeclarationsOn(checker, of).find((each) => each.name.text === name);
}

/**
 * What the struct constraints of a field's struct ask of it, by the key naming it: the entries
 * naming a literal key; for the other keys (a `KeysType`), the others' entries, since only a field
 * that is there has a type; for a key not known yet, what each of the keys it may be is asked
 * alike, by its traits (`commonRules`). None on a struct type known already, whose fields have
 * types of their own.
 */
export function entryRules(checker: CheckerContext, type: Type): readonly EntryRule[] {
  if (type.kind !== 'field') {
    return [];
  }
  const models = structConstraintsOn(checker, type.of);
  const rulesOf = (key: Type): readonly EntryRule[] => {
    if (key.kind === 'literal' && typeof key.value === 'string') {
      const name = key.value;
      return models.flatMap(
        (model) => model.named.find((entry) => entry.name === name)?.rule ?? [],
      );
    }
    if (key.kind === 'keys') {
      return models.flatMap((model) => model.others ?? []);
    }
    const members = keyMembers(checker, key);
    const [only] = members;
    if (members.length === 1 && only !== undefined) {
      return only === key ? [] : rulesOf(only);
    }
    return commonRules(members.map(rulesOf));
  };
  return rulesOf(type.key);
}

/**
 * What each of several fields' rules asks, as one rule: the exact type every one of them gives,
 * when they all give the same one, so a key naming any of them reads and writes that type (§3.1 Key
 * types); else the traits each asks, as a field any of them gives an exact type, or asks a struct
 * constraint of, meets nothing known here beside them.
 */
function commonRules(each: readonly (readonly EntryRule[])[]): readonly EntryRule[] {
  const exact = each.map((rules) => rules.find((rule) => rule.kind === 'type'));
  const [shared] = exact;
  if (
    shared !== undefined &&
    exact.every((rule) => rule !== undefined && sameType(rule.type, shared.type))
  ) {
    return [shared];
  }
  const sets = each.map((rules) =>
    rules.every((rule) => rule.kind === 'meets' && rule.structs.length === 0)
      ? rules.flatMap((rule) => (rule.kind === 'meets' ? rule.traits : []))
      : undefined,
  );
  const [first, ...others] = sets;
  if (first === undefined || sets.some((set) => set === undefined)) {
    return [];
  }
  const traits = first.filter((trait) =>
    others.every((set) => set?.some((other) => sameConstraint(other, trait))),
  );
  return traits.length === 0 ? [] : [{ kind: 'meets', traits, structs: [] }];
}

/** A trait's requirement of an associated type, as a constraint on the type requiring it states it. */
interface DeclaringConstraint {
  readonly constraint: Constraint;
  readonly requirement: RequiredAssociatedType;
}

/**
 * Every requirement of an associated type `name` among the constraints `of` meets: `of.name` is
 * one type, meeting each one's bound. Inside a trait, `Self` meets the trait itself, with its own
 * parameters.
 */
function requirementsDeclaring(
  checker: CheckerContext,
  of: Type,
  name: string,
): readonly DeclaringConstraint[] {
  return constraintsDeclaring(checker, of).flatMap((constraint) =>
    requiredAssociatedTypes(constraint.trait)
      .filter((each) => each.name.text === name)
      .map((requirement) => ({ constraint, requirement })),
  );
}

/** The constraints `of` meets, as its associated types are found: inside a trait, `Self` meets it. */
function constraintsDeclaring(checker: CheckerContext, of: Type): readonly Constraint[] {
  return of.kind === 'parameter' && of.declaration.kind === 'TraitDeclaration'
    ? [selfConstraint(of.declaration)]
    : knownConstraints(checker, of);
}

/** A trait as its own `Self` meets it: with its own type parameters as its arguments. */
function selfConstraint(trait: Constraint['trait']): Constraint {
  const parameters = trait.typeParameters.filter((each) => each.kind === 'TypeParameter');
  return { trait, arguments: parameters.map(parameterType) };
}

/** The bounds every requirement of `type` states, as `type` meets them all. */
function boundsOf(checker: CheckerContext, type: Extract<Type, { kind: 'associated' }>) {
  const rules = checker.typeRules;
  const bounds = requirementsDeclaring(checker, type.of, type.name).map(
    ({ constraint, requirement }) => {
      const substitution = constraintSubstitution(constraint, type.of);
      const { traits, structs } = checker.associatedBoundsOf(requirement);
      return {
        traits: traits.map((trait) => substituteConstraint(trait, substitution, rules)),
        structs: structs.map((struct) => substituteStructConstraint(struct, substitution, rules)),
      };
    },
  );
  return {
    traits: bounds.flatMap((bound) => bound.traits),
    structs: bounds.flatMap((bound) => bound.structs),
  };
}
