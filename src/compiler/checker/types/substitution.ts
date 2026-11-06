/**
 * Substitution (§3.5): type parameters replaced by the types given for them, through every type
 * they appear in. A type parameter is keyed by its declaration, and a trait's `Self` by the trait's
 * (type.ts), so instantiating a generic declaration and applying a constraint are one operation.
 * An `any` type binds its traits' `Self`, so a substitution from outside never reaches it. A type
 * written through an alias stays written through it, its arguments substituted alike (type.ts). One
 * written as an associated type is that associated type of its owner substituted, built by the
 * rules as every one is (§3.1), never its body substituted apart: expanding one that reaches
 * itself then stops alike however it is reached.
 * The types substitution builds are built by the program's rules (type-rules.ts), so a union
 * reached through it is normalized as one written with its arguments in place: `T | any Stringable`
 * with `T = String` is `any Stringable`. A recursive type's graph closes again from its parts
 * substituted (recursive-types.ts).
 */

import { type TypeParameters, typeParametersOf } from '../../syntax/declarations.ts';
import type { ComputedType, MappedParts, RecursiveType } from './computed-types.ts';
import {
  type AnyType,
  aliasedAs,
  type Constraint,
  errorType,
  mapAliasUse,
  type ParameterKey,
  type Type,
  type TypeParameterType,
  type UnionType,
} from './type.ts';
import { mapChildren, mapParts } from './type-parts.ts';
import type { TypeRules } from './type-rules.ts';

/** Type parameters mapped to the types that replace them. */
export type Substitution = ReadonlyMap<ParameterKey, Type>;

/**
 * The substitution giving a declaration's type `parameters` its `typeArguments`, in order; a
 * parameter left without one stands for the error type.
 */
export function substitutionFor(
  parameters: TypeParameters,
  typeArguments: readonly Type[],
): Substitution {
  return new Map(
    typeParametersOf(parameters).map(
      (parameter, index) => [parameter, typeArguments[index] ?? errorType] as const,
    ),
  );
}

/** `type` with every type parameter in `substitution` replaced, built by the program's `rules`. */
export function substitute(type: Type, substitution: Substitution, rules: TypeRules): Type {
  if (substitution.size === 0) {
    return type;
  }
  if (type.alias?.kind === 'associated') {
    return rules.associatedType(substitute(type.alias.of, substitution, rules), type.alias.name);
  }
  if (type.kind === 'parameter') {
    const replaced =
      substitution.get(type.declaration) ??
      mapChildren(type, (child) => substitute(child, substitution, rules), rules);
    return asWritten(type, replaced, substitution, rules);
  }
  if (type.kind === 'any') {
    return substituteAny(type, substitution, rules);
  }
  if (type.kind === 'mapped') {
    return asWritten(type, substituteMapped(type, substitution, rules), substitution, rules);
  }
  return asWritten(
    type,
    mapChildren(type, (child) => substitute(child, substitution, rules), rules),
    substitution,
    rules,
  );
}

/**
 * A mapped struct type with `substitution` applied, never to the parameter it binds (§3.1): its
 * keys and named fields first, then its value together with each key, once its keys are known
 * (type-rules.ts `mappedType`).
 */
function substituteMapped(type: MappedParts, substitution: Substitution, rules: TypeRules): Type {
  const outer = new Map(substitution);
  outer.delete(type.parameter);
  const map = (child: Type) => substitute(child, outer, rules);
  return rules.mappedType(
    {
      ...type,
      named: type.named.map((field) => ({ ...field, type: map(field.type) })),
      keys: map(type.keys),
    },
    outer,
  );
}

/** An `any` type with `substitution` applied, but never to the `Self` it binds. */
export function substituteAny(
  type: AnyType,
  substitution: Substitution,
  rules: TypeRules,
): AnyType {
  const outer = new Map(substitution);
  for (const { trait } of type.constraints) {
    outer.delete(trait);
  }
  return asWritten(
    type,
    mapParts(type, (child) => substitute(child, outer, rules)),
    substitution,
    rules,
  );
}

/** A type that is no type parameter with `substitution` applied, still of its kind. */
export function substituteKept<
  Kept extends Exclude<Type, TypeParameterType | UnionType | RecursiveType | ComputedType>,
>(type: Kept, substitution: Substitution, rules: TypeRules): Kept {
  return asWritten(
    type,
    mapParts(type, (child) => substitute(child, substitution, rules)),
    substitution,
    rules,
  );
}

/**
 * `substituted`, written through the alias `type` was written through, if any, substituted; `type`
 * itself when substituting changed neither (type-parts.ts keeps a type alike).
 */
function asWritten<Substituted extends Type>(
  type: Type,
  substituted: Substituted,
  substitution: Substitution,
  rules: TypeRules,
): Substituted {
  const { alias } = type;
  if (alias === undefined) {
    return substituted;
  }
  const given = mapAliasUse(alias, (each) => substitute(each, substitution, rules));
  return substituted === type && given === alias ? substituted : aliasedAs(substituted, given);
}

/** `constraint` with `substitution` applied to its trait's arguments. */
export function substituteConstraint(
  constraint: Constraint,
  substitution: Substitution,
  rules: TypeRules,
): Constraint {
  return {
    trait: constraint.trait,
    arguments: constraint.arguments.map((argument) => substitute(argument, substitution, rules)),
  };
}
