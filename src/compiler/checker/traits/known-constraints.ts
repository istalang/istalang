/**
 * What a type meets by what it is (§3.5, §3.10): the constraints of a type parameter, of an `any`
 * type, and of the types computed from types not known yet, and through them its requirements,
 * fields and associated types. One home for these, since each answer of a computed type is read
 * from what the type it is computed from meets.
 *
 * - `T.Data` (§3.1) is one type, meeting the bound of every requirement of `Data` among what `T`
 *   meets (`type Data is C`); on a known type it is that type's own associated type, an alias
 *   substituted for the type's arguments. Inside a trait, `Self` meets the trait itself. A union or
 *   an `any` type has none: only a type's own declaration declares one.
 * - `S["meta"]` (§3.5) meets what the entries of `S`'s struct constraints ask of that field; on a
 *   known struct it is the field's type, and an entry asking an exact type gives that type.
 * - A field of a type is a struct's, or, on a type known only per instantiation, one a constraint's
 *   trait requires or a struct constraint names (`fieldOf`): one rule for a field read, a field
 *   called and conformance.
 * - A requirement on a type parameter or an `any` type is numbered by constraint and function
 *   (`ConstraintRequirement`); on a computed type it is the trait as `any` takes it, its witness
 *   chosen once an instantiation makes the type known (`ComputedRequirement`).
 */

import type {
  AssociatedType,
  RequiredAssociatedType,
  TypeParameter,
} from '../../syntax/declarations.ts';
import {
  type FoundField,
  namedFieldRead,
  requiredFieldRead,
  structFieldOf,
} from '../checked-field.ts';
import type { CheckerContext } from '../context.ts';
import type { RequirementOrigin } from '../resolved-call.ts';
import { parameterType } from '../types/resolve-type.ts';
import {
  type EntryRule,
  type StructConstraintModel,
  substituteStructConstraint,
} from '../types/struct-constraint.ts';
import { substitute, substituteConstraint, substitutionFor } from '../types/substitution.ts';
import {
  type AnyType,
  aliasedAs,
  type ComputedType,
  type Constraint,
  errorType,
  isOpaque,
  type Type,
} from '../types/type.ts';
import { literalType } from '../types/unions.ts';
import {
  constraintOn,
  constraintSubstitution,
  type Requirement,
  requiredAssociatedTypes,
  requiredFields,
  requiredFieldType,
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
      return type.declaration.kind === 'TypeParameter'
        ? checker.structConstraintsOf(type.declaration)
        : [];
    case 'associated':
      return boundsOf(checker, type).structs;
    case 'field':
      return entryRules(checker, type).flatMap((rule) =>
        rule.kind === 'meets' ? rule.structs : [],
      );
    default:
      return [];
  }
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
 * The field `name` of `type`: a struct's, or, on a type known only per instantiation, one a trait
 * of its constraints requires or one its struct constraints name (§3.5, §3.10).
 */
export function fieldOf(checker: CheckerContext, type: Type, name: string): FoundField | undefined {
  if (type.kind === 'nominal' || type.kind === 'anonymous') {
    return structFieldOf(checker, type, name);
  }
  for (const constraint of knownConstraints(checker, type)) {
    const field = requiredFields(constraint.trait).find((each) => each.name.text === name);
    if (field !== undefined) {
      return {
        member: {
          name,
          type: requiredFieldType(checker, constraint, field, type),
          declared: {
            node: field,
            module: checker.moduleOf(constraint.trait),
            type: checker.resolveType(checker.moduleOf(constraint.trait), field.type),
          },
        },
        read: requiredFieldRead(checker, type, { trait: constraint.trait, field }),
      };
    }
  }
  const named = structConstraintsOn(checker, type).some((model) =>
    model.named.some((entry) => entry.name === name),
  );
  return named
    ? {
        member: { name, type: checker.typeRules.fieldType(type, literalType(name)) },
        read: namedFieldRead(checker, type, name),
      }
    : undefined;
}

/**
 * The associated type `name` of `of` (§3.1): a known nominal type's own, its declaration's alias
 * substituted for the type's arguments and written through it; on a type not known yet, the opaque
 * type naming it when one of its constraints requires it; else the error type.
 */
export function associatedTypeOf(checker: CheckerContext, of: Type, name: string): Type {
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
  const type = substitute(checker.aliasedType(declared), substitution, checker.typeRules);
  return aliasedAs(type, { kind: 'associated', of, name });
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
  return isOpaque(of)
    ? constraintsDeclaring(checker, of).flatMap(({ trait }) => requiredAssociatedTypes(trait))
    : [];
}

/** What declares the associated type `name` of `of` (§3.1); undefined when it has none. */
export function associatedDeclarationOf(
  checker: CheckerContext,
  of: Type,
  name: string,
): AssociatedType | RequiredAssociatedType | undefined {
  return associatedDeclarationsOn(checker, of).find((each) => each.name.text === name);
}

/**
 * The type of the field `key` names in `of` (§3.5): a known struct's field's; on a type not known
 * yet, the exact type its struct constraints give that field, or else the opaque type naming it,
 * when they name it; the error type when there is no such field.
 */
export function fieldTypeOf(checker: CheckerContext, of: Type, key: Type): Type {
  if (of.kind === 'error' || key.kind === 'error') {
    return errorType;
  }
  if (key.kind !== 'literal' || typeof key.value !== 'string') {
    return errorType;
  }
  const name = key.value;
  if (!isOpaque(of)) {
    return checker.fieldsOf(of)?.find((field) => field.name === name)?.type ?? errorType;
  }
  const opaque: Type = { kind: 'field', of, key };
  const rules = entryRules(checker, opaque);
  const exact = rules.find((rule) => rule.kind === 'type');
  if (exact !== undefined) {
    return exact.type;
  }
  return rules.length === 0 ? errorType : opaque;
}

/**
 * What the struct constraints of a field's struct ask of it, by the name its key is: the entries
 * naming it, since one only the others' entry covers may not be there at all.
 */
function entryRules(checker: CheckerContext, type: Type): readonly EntryRule[] {
  if (type.kind !== 'field' || type.key.kind !== 'literal' || typeof type.key.value !== 'string') {
    return [];
  }
  const name = type.key.value;
  return structConstraintsOn(checker, type.of).flatMap(
    (model) => model.named.find((entry) => entry.name === name)?.rule ?? [],
  );
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
