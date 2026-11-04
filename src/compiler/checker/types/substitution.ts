/**
 * Substitution (§3.5): type parameters replaced by the types given for them, through every type
 * they appear in. A type parameter is keyed by its declaration, and a trait's `Self` by the trait's
 * (type.ts), so instantiating a generic declaration and applying a constraint are one operation.
 * An `any` type binds its traits' `Self`, so a substitution from outside never reaches it. A type
 * written through an alias stays written through it, its arguments substituted alike (type.ts).
 * The types substitution builds are built by the program's rules (type-rules.ts), so a union
 * reached through it is normalized as one written with its arguments in place: `T | any Stringable`
 * with `T = String` is `any Stringable`.
 */

import { type TypeParameters, typeParametersOf } from '../../syntax/declarations.ts';
import {
  type AnyType,
  aliasedAs,
  errorType,
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
  if (type.kind === 'parameter') {
    return asWritten(type, substitution.get(type.declaration) ?? type, substitution, rules);
  }
  if (type.kind === 'any') {
    return substituteAny(type, substitution, rules);
  }
  return asWritten(
    type,
    mapChildren(type, (child) => substitute(child, substitution, rules), rules),
    substitution,
    rules,
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
export function substituteKept<Kept extends Exclude<Type, TypeParameterType | UnionType>>(
  type: Kept,
  substitution: Substitution,
  rules: TypeRules,
): Kept {
  return asWritten(
    type,
    mapParts(type, (child) => substitute(child, substitution, rules)),
    substitution,
    rules,
  );
}

/** `substituted`, written through the alias `type` was written through, if any, substituted. */
function asWritten<Substituted extends Type>(
  type: Type,
  substituted: Substituted,
  substitution: Substitution,
  rules: TypeRules,
): Substituted {
  const { alias } = type;
  return alias === undefined
    ? substituted
    : aliasedAs(substituted, {
        declaration: alias.declaration,
        arguments: alias.arguments.map((each) => substitute(each, substitution, rules)),
      });
}
