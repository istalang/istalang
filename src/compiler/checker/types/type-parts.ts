/**
 * What a type is built from (type.ts): the types one level down, a type with them replaced, and
 * what walking them finds, the type parameters, nominal and `any` types a type mentions and whether it holds
 * the error type.
 */

import { withPack } from './function-types.ts';
import { sameType } from './identity.ts';
import {
  type AnyType,
  aliasedAs,
  type ComputedType,
  isComputed,
  type MappedParts,
  type NominalType,
  type ParameterKey,
  type Type,
  type UnionType,
} from './type.ts';
import type { TypeRules } from './type-rules.ts';
import { unionOf, unionOfNormalized } from './unions.ts';

/** The types `type` is built from, one level down. */
export function typeChildren(type: Type): readonly Type[] {
  switch (type.kind) {
    case 'nominal':
      return type.arguments;
    case 'anonymous':
      return type.fields.map((field) => field.type);
    case 'tuple':
      return type.elements;
    case 'function':
      return [
        ...type.parameters.map((parameter) => parameter.type),
        ...(type.pack === undefined ? [] : [type.pack]),
        type.result,
      ];
    case 'any':
      return type.constraints.flatMap((constraint) => constraint.arguments);
    case 'union':
      return type.members;
    case 'associated':
      return [type.of];
    case 'field':
      return [type.of, type.key];
    case 'keys':
      return [type.of];
    case 'mapped':
      return [...type.named.map((field) => field.type), type.keys, type.value];
    case 'literal':
    case 'primitive':
    case 'parameter':
    case 'error':
      return [];
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * Whether two types are alike in every part: `sameType` at every level, alias arguments included,
 * with the same alias by its declaration, an `any`'s constraints in the same order and a shape
 * written at the same node, which `sameType` overlooks. A checker result computed again is the one before only if its types are alike so
 * (incremental-checking.md §1), since a taken-over result keeps every node its types name.
 */
export function sameTypeSpelled(first: Type, second: Type): boolean {
  const pending: [Type, Type][] = [[first, second]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [one, other] = pair;
    const parts = spelledParts(one);
    const others = spelledParts(other);
    const alike =
      one === other ||
      (sameType(one, other) &&
        sameAliasWritten(one, other) &&
        sameConstraintOrder(one, other) &&
        sameOrigin(one, other) &&
        parts.length === others.length);
    if (!alike) {
      return false;
    }
    if (one !== other) {
      pending.push(...parts.map((part, index) => [part, others[index] ?? part] as [Type, Type]));
    }
  }
  return true;
}

/** The types `type` is spelled with, one level down: its parts, then its alias's arguments. */
function spelledParts(type: Type): readonly Type[] {
  return [...typeChildren(type), ...aliasParts(type)];
}

/** The types the alias `type` is written through is spelled with: its arguments, or its owner. */
function aliasParts(type: Type): readonly Type[] {
  const { alias } = type;
  if (alias === undefined) {
    return [];
  }
  return alias.kind === 'alias' ? alias.arguments : [alias.of];
}

/** Whether two types are written through the same alias, or the same owner's associated type. */
function sameAliasWritten(one: Type, other: Type): boolean {
  const [first, second] = [one.alias, other.alias];
  if (first === undefined || second === undefined) {
    return first === second;
  }
  if (first.kind === 'alias') {
    return second.kind === 'alias' && first.declaration === second.declaration;
  }
  return second.kind === 'associated' && first.name === second.name;
}

/** Whether two types that are `any` types name their constraints' traits in one order. */
function sameConstraintOrder(one: Type, other: Type): boolean {
  return (
    one.kind !== 'any' ||
    (other.kind === 'any' &&
      one.constraints.every(
        (constraint, index) => constraint.trait === other.constraints[index]?.trait,
      ))
  );
}

/**
 * Whether two types that are shapes, or mapped struct types, were written at the same node, which
 * tools locate them by and a mapped type's parameter belongs to.
 */
function sameOrigin(one: Type, other: Type): boolean {
  if (one.kind === 'mapped') {
    return other.kind === 'mapped' && one.origin === other.origin;
  }
  return one.kind !== 'anonymous' || (other.kind === 'anonymous' && one.origin === other.origin);
}

/**
 * `type` written through no alias at any level: the type its key names (type-keys.ts). A result
 * kept by a type's key is computed from it, so it never depends on how the type was spelled where
 * it was first asked for.
 */
export function unaliased<Written extends Exclude<Type, UnionType>>(type: Written): Written;
export function unaliased(type: Type): Type;
export function unaliased(type: Type): Type {
  if (type.kind === 'union') {
    return unionOfNormalized(type.members.map(unaliased));
  }
  return mapParts(type.alias === undefined ? type : { ...type, alias: undefined }, unaliased);
}

/**
 * The type parameters `type` mentions, each once, in order of appearance; not those it binds: an
 * `any` type's `Self`, a mapped struct type's parameter.
 */
export function parametersIn(type: Type): readonly ParameterKey[] {
  if (type.kind === 'parameter') {
    return [type.declaration];
  }
  const mentioned = new Set(typeChildren(type).flatMap(parametersIn));
  if (type.kind === 'any') {
    for (const { trait } of type.constraints) {
      mentioned.delete(trait);
    }
  }
  if (type.kind === 'mapped') {
    mentioned.delete(type.parameter);
  }
  return [...mentioned];
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

/** Whether `type` is, or is built from, the error type. */
export function mentionsError(type: Type): boolean {
  return type.kind === 'error' || typeChildren(type).some(mentionsError);
}

/**
 * `type` with each type it is built from, one level down, replaced by what `map` gives. The alias
 * `type` was written through comes along: a caller changing what it wrote drops it (type.ts). A
 * union is built again by the program's `rules` (unions.ts), so its members may merge into fewer,
 * or into one.
 */
export function mapChildren(type: Type, map: (child: Type) => Type, rules: TypeRules): Type {
  const rebuilt = rebuiltBy(type, map, rules);
  return rebuilt === undefined ? mapParts(type as Exclude<Type, Rebuilt>, map) : rebuilt;
}

/** The types a program's rules build: a union, normalized, and the types computed from others. */
type Rebuilt = UnionType | ComputedType;

/**
 * `type` rebuilt by `rules` from its parts as `map` gives them, written through its alias, when
 * building it takes the rules: a union, whose members may merge, or a computed type, which may
 * reduce (type-rules.ts); undefined for any other type.
 */
function rebuiltBy(type: Type, map: (child: Type) => Type, rules: TypeRules): Type | undefined {
  const rebuilt = (): Type | undefined => {
    switch (type.kind) {
      case 'union':
        return unionOf(type.members.map(map), rules);
      case 'associated':
        return rules.associatedType(map(type.of), type.name);
      case 'field':
        return rules.fieldType(map(type.of), map(type.key));
      case 'keys':
        return rules.keysOf(map(type.of), type.without);
      case 'mapped':
        return rules.mappedType(mappedParts(type, map));
      default:
        return undefined;
    }
  };
  const built = rebuilt();
  return built === undefined || type.alias === undefined ? built : aliasedAs(built, type.alias);
}

/**
 * `type`, not a union, with each type it is built from, one level down, replaced by what `map`
 * gives, still of its kind; its alias comes along, as `mapChildren` says. Building one of these
 * takes no rule of the program: only a union normalizes its members, and only a computed type
 * reduces, which `mapChildren` does. A computed type kept as it is, its parts respelled
 * (`unaliased`), stays of its kind here.
 */
export function mapParts<Mapped extends Exclude<Type, UnionType>>(
  type: Mapped,
  map: (child: Type) => Type,
): Mapped;
export function mapParts(type: Exclude<Type, UnionType>, map: (child: Type) => Type): Type {
  switch (type.kind) {
    case 'associated':
      return { ...type, of: map(type.of) };
    case 'field':
      return { ...type, of: map(type.of), key: map(type.key) };
    case 'keys':
      return { ...type, of: map(type.of) };
    case 'mapped':
      return { ...type, ...mappedParts(type, map) };
    case 'literal':
    case 'primitive':
    case 'parameter':
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

/** A mapped struct type's parts, each type it is built from replaced by what `map` gives. */
function mappedParts(type: MappedParts, map: (child: Type) => Type): MappedParts {
  return {
    origin: type.origin,
    named: type.named.map((field) => ({ ...field, type: map(field.type) })),
    parameter: type.parameter,
    keys: map(type.keys),
    value: map(type.value),
  };
}
