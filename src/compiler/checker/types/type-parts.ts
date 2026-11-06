/**
 * What a type is built from (type.ts): the types one level down, a type with them replaced, and
 * what walking them finds, the type parameters, nominal and `any` types a type mentions and whether it holds
 * the error type.
 *
 * A type rebuilt with every part it is built from unchanged is the very type, never a copy, so
 * what is memoized per type object (type-keys.ts, type-children.ts, here) stays found however often
 * a type is substituted or respelled. Only a type computed from others is built again whatever its
 * parts: a use left unreduced reduces once rebuilt (type-match.ts `rebuilt`).
 */

import { sameItems } from '../../../structures/equality.ts';
import { memo } from '../../../structures/memo.ts';
import { mappedParts, reducedComputed } from './computed-reduction.ts';
import { type ComputedType, isComputed, type RecursiveType } from './computed-types.ts';
import { withPack } from './function-types.ts';
import { mapRecursive } from './recursive-types.ts';
import {
  type AnyType,
  aliasedAs,
  type Constraint,
  type ErrorType,
  type NominalType,
  type ParameterKey,
  type Type,
  type UnionType,
} from './type.ts';
import { boundParameters, typeChildren } from './type-children.ts';
import { typeKeys } from './type-keys.ts';
import type { TypeRules } from './type-rules.ts';
import { unionOf, unionOfNormalized } from './unions.ts';

/** Each type written through no alias at any level (`unaliased`). */
const unaliasedTypes = new WeakMap<Type, Type>();

/** Each type's parameters (`parametersIn`). */
const mentionedParameters = new WeakMap<Type, readonly ParameterKey[]>();

/**
 * Whether two types are alike in every part: their spelled keys are equal (type-keys.ts), so they
 * are the same type, written alike at every level, at the same nodes. A checker result computed
 * again is the one before only if its types are alike so (incremental-checking.md §1), since a
 * taken-over result keeps every node its types name.
 */
export function sameTypeSpelled(first: Type, second: Type): boolean {
  return first === second || typeKeys.spelledKey(first) === typeKeys.spelledKey(second);
}

/** Whether two trait constraints are one trait with arguments alike in every part (`sameTypeSpelled`). */
export function sameConstraintSpelled(first: Constraint, second: Constraint): boolean {
  return (
    first.trait === second.trait && sameItems(sameTypeSpelled)(first.arguments, second.arguments)
  );
}

/**
 * `type` written through no alias at any level: the type its key names (type-keys.ts). A result
 * kept by a type's key is computed from it, so it never depends on how the type was spelled where
 * it was first asked for. A recursive type's graph is one spelling already, whatever aliases its
 * parts were written through (type-keys.ts `spelledKey`), so only the alias it is written through
 * goes.
 */
export function unaliased<Written extends Exclude<Type, UnionType>>(type: Written): Written;
export function unaliased(type: Type): Type;
export function unaliased(type: Type): Type {
  return memo(unaliasedTypes, type, () => {
    const bare = type.alias === undefined ? type : { ...type, alias: undefined };
    switch (bare.kind) {
      case 'union': {
        const members = bare.members.map(unaliased);
        return sameItems<Type>()(members, bare.members) ? bare : unionOfNormalized(members);
      }
      case 'recursive':
        return bare;
      default:
        return mapParts(bare, unaliased);
    }
  });
}

/**
 * The type parameters `type` mentions, each once, in order of appearance; not those it binds: an
 * `any` type's `Self`, a mapped struct type's parameter.
 */
export function parametersIn(type: Type): readonly ParameterKey[] {
  return memo(mentionedParameters, type, () => {
    if (type.kind === 'parameter') {
      return [type.declaration];
    }
    const mentioned = new Set(typeChildren(type).flatMap(parametersIn));
    for (const bound of boundParameters(type)) {
      mentioned.delete(bound);
    }
    return [...mentioned];
  });
}

/** The nominal types `type` is or is built from, outermost first. */
export function nominalsIn(type: Type): readonly NominalType[] {
  const inner = typeChildren(type).flatMap(nominalsIn);
  return type.kind === 'nominal' ? [type, ...inner] : inner;
}

/** The `any` types `type` is or is built from, outermost first. */
export function anyTypesIn(type: Type): readonly AnyType[] {
  const inner = typeChildren(type).flatMap(anyTypesIn);
  return type.kind === 'any' ? [type, ...inner] : inner;
}

/** The types computed from types not known yet that `type` is or is built from, outermost first. */
export function computedTypesIn(type: Type): readonly ComputedType[] {
  if (isComputed(type)) {
    return [type];
  }
  return typeChildren(type).flatMap(computedTypesIn);
}

/** Whether `type` holds no type that isn't known yet: no type parameter, nothing computed. */
export function isKnown(type: Type): boolean {
  return parametersIn(type).length === 0 && computedTypesIn(type).length === 0;
}

/** Whether `type` is, or is built from, the error type. */
export function mentionsError(type: Type): boolean {
  return errorIn(type) !== undefined;
}

/** The error type `type` is, or the first it is built from; undefined for none. */
export function errorIn(type: Type): ErrorType | undefined {
  if (type.kind === 'error') {
    return type;
  }
  for (const child of typeChildren(type)) {
    const found = errorIn(child);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * `type` with each type it is built from, one level down, replaced by what `map` gives; `type`
 * itself when `map` changes none and it is no computed type (the banner). The alias `type` was
 * written through comes along: a caller changing what it wrote drops it (type.ts). A union is built
 * again by the program's `rules` (unions.ts), so its members may merge into fewer, or into one.
 */
export function mapChildren(type: Type, map: (child: Type) => Type, rules: TypeRules): Type {
  const rebuilt = rebuiltBy(type, map, rules);
  return rebuilt === undefined ? mapParts(type as Exclude<Type, Rebuilt>, map) : rebuilt;
}

/**
 * The types a program's rules build: a union, normalized, a recursive type, whose graph closes
 * again normalizing its unions alike, and the types computed from others.
 */
type Rebuilt = UnionType | RecursiveType | ComputedType;

/**
 * `type` rebuilt by `rules` from its parts as `map` gives them, written through its alias, when
 * building it takes the rules: a union, whose members may merge, a recursive type, whose graph
 * closes again (recursive-types.ts), or a computed type, which may reduce (type-rules.ts);
 * undefined for any other type.
 */
function rebuiltBy(type: Type, map: (child: Type) => Type, rules: TypeRules): Type | undefined {
  const rebuilt = (): Type | undefined => {
    switch (type.kind) {
      case 'union': {
        const members = type.members.map(map);
        return sameItems<Type>()(members, type.members) ? type : unionOf(members, rules);
      }
      case 'recursive':
        return mapRecursive(type, map, rules);
      default:
        return isComputed(type) ? reducedComputed(type, map, rules) : undefined;
    }
  };
  const built = rebuilt();
  return built === undefined || built === type || type.alias === undefined
    ? built
    : aliasedAs(built, type.alias);
}

/**
 * `type`, neither a union nor a recursive type, with each type it is built from, one level down,
 * replaced by what `map` gives, still of its kind, `type` itself when `map` changes none; its alias
 * comes along, as `mapChildren` says. Building one of these takes no rule of the program: only a
 * union and a recursive type's graph normalize members, and only a computed type reduces, which
 * `mapChildren` does. A computed type kept as it is, its parts respelled (`unaliased`), stays of
 * its kind here.
 */
export function mapParts<Mapped extends Exclude<Type, UnionType | RecursiveType>>(
  type: Mapped,
  map: (child: Type) => Type,
): Mapped;
export function mapParts(
  type: Exclude<Type, UnionType | RecursiveType>,
  map: (child: Type) => Type,
): Type {
  let changed = false;
  const rebuilt = partsMapped(type, (child) => {
    const mapped = map(child);
    changed ||= mapped !== child;
    return mapped;
  });
  return changed ? rebuilt : type;
}

/** `type` rebuilt by `mapParts` from its parts as `map` gives them, a copy even when none changed. */
function partsMapped(
  type: Exclude<Type, UnionType | RecursiveType>,
  map: (child: Type) => Type,
): Type {
  switch (type.kind) {
    case 'associated':
      return { ...type, of: map(type.of) };
    case 'field':
      return { ...type, of: map(type.of), key: map(type.key) };
    case 'keys':
      return { ...type, of: map(type.of) };
    case 'mapped':
      return { ...type, ...mappedParts(type, map) };
    case 'match':
      return { ...type, arguments: type.arguments.map(map) };
    case 'parameter':
      return type.within === undefined ? type : { ...type, within: map(type.within) };
    case 'literal':
    case 'primitive':
    case 'error':
      return type;
    case 'nominal':
      return { ...type, arguments: type.arguments.map(map) };
    case 'anonymous':
      return { ...type, fields: type.fields.map((field) => ({ ...field, type: map(field.type) })) };
    case 'tuple':
      return { ...type, elements: type.elements.map(map) };
    case 'function':
      return withPack(
        {
          ...type,
          parameters: type.parameters.map((parameter) => ({
            ...parameter,
            type: map(parameter.type),
          })),
          result: map(type.result),
        },
        type.pack === undefined ? undefined : map(type.pack),
      );
    case 'any':
      return {
        ...type,
        constraints: type.constraints.map((constraint) => ({
          ...constraint,
          arguments: constraint.arguments.map(map),
        })),
      };
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
