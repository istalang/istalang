/**
 * Substitution (§3.5): type parameters replaced by the types given for them, through every type
 * they appear in. A type parameter is keyed by its declaration, and a trait's `Self` by the trait's
 * (type.ts), so instantiating a generic declaration and applying a constraint are one operation.
 * An `any` type binds its traits' `Self`, so a substitution from outside never reaches it. A type
 * written through an alias stays written through it, its arguments substituted alike (type.ts).
 * The types substitution builds are built by the program's rules (type-rules.ts), so a union
 * reached through it is normalized as one written with its arguments in place: `T | any Stringable`
 * with `T = String` is `any Stringable`. A recursive use's unfolding is what its substituted use
 * unfolds to, decided again by the rules, never a verdict carried over.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import { type TypeParameters, typeParametersOf } from '../../syntax/declarations.ts';
import type { ComputedType, MappedParts } from './computed-types.ts';
import {
  type AnyType,
  aliasedAs,
  type Constraint,
  errorType,
  type ParameterKey,
  recursionOf,
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
  if (type.kind === 'parameter') {
    const replaced =
      substitution.get(type.declaration) ??
      mapChildren(type, (child) => substitute(child, substitution, rules), rules);
    return asWritten(type, replaced, substitution, rules);
  }
  if (type.kind === 'any') {
    return substituteAny(type, substitution, rules);
  }
  if (type.kind === 'mapped' && type.recursion === undefined) {
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
  Kept extends Exclude<Type, TypeParameterType | UnionType | ComputedType>,
>(type: Kept, substitution: Substitution, rules: TypeRules): Kept {
  if (recursionOf(type) !== undefined) {
    return substitutedUnfolding(type, substitution, rules);
  }
  return asWritten(
    type,
    mapParts(type, (child) => substitute(child, substitution, rules)),
    substitution,
    rules,
  );
}

/**
 * What a recursive use unfolds to (§3.17), with `substitution` applied: what the substituted use
 * unfolds to, whether the rules find it recursive still or not, of the same kind.
 */
function substitutedUnfolding<Kept extends Type>(
  type: Kept,
  substitution: Substitution,
  rules: TypeRules,
): Kept {
  const substituted = substitute(type, substitution, rules);
  const unfolding = substituted.kind === 'recursive' ? rules.unfold(substituted) : substituted;
  return unfolding.kind === type.kind
    ? (unfolding as Kept)
    : unreachable('A recursive use unfolds to a type of one kind whatever its arguments.');
}

/** `substituted`, written through the alias `type` was written through, if any, substituted. */
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
  return aliasedAs(
    substituted,
    alias.kind === 'alias'
      ? {
          ...alias,
          arguments: alias.arguments.map((each) => substitute(each, substitution, rules)),
        }
      : { ...alias, of: substitute(alias.of, substitution, rules) },
  );
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
