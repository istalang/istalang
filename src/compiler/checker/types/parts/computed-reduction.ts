/**
 * Reducing a type computed from others (§3.5, §3.17) one level: the one place each computed kind is
 * handed to the program's rule building it, from its parts as the caller gives them. Rebuilding a
 * type (type-parts.ts) and closing a recursive type's graph (identity/recursive-types.ts) both
 * reduce through it, so a computed type reduces alike wherever its parts became known.
 */

import type { ComputedType, MappedParts } from '../computed-types.ts';
import type { Type } from '../type/index.ts';
import type { TypeRules } from '../type-rules.ts';

/** What `rules` build `type` to from its parts as `map` gives them, reduced as far as they allow. */
export function reducedComputed(
  type: ComputedType,
  map: (child: Type) => Type,
  rules: TypeRules,
): Type {
  switch (type.kind) {
    case 'associated':
      return rules.associatedType(map(type.of), type.name);
    case 'field':
      return rules.fieldType(map(type.of), map(type.key));
    case 'keys':
      return rules.keysOf(map(type.of), type.without);
    case 'mapped':
      return rules.mappedType(mappedParts(type, map));
    case 'match':
      // A type `match` use is reduced again, which finds it recursive or not.
      return rules.matchType(type.declaration, type.arguments.map(map));
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** A mapped struct type's parts, each type it is built from replaced by what `map` gives. */
export function mappedParts(type: MappedParts, map: (child: Type) => Type): MappedParts {
  return {
    origin: type.origin,
    named: type.named.map((field) => ({ ...field, type: map(field.type) })),
    parameter: type.parameter,
    keys: map(type.keys),
    value: map(type.value),
  };
}
