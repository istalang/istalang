/**
 * What a type is built from (type.ts): the types one level down, a type with them replaced, and
 * what walking them finds, the type parameters, nominal and `any` types a type mentions and whether it holds
 * the error type.
 */

import { sameType } from './identity.ts';
import { type AnyType, type NominalType, type ParameterKey, type Type, withPack } from './type.ts';

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
        one.alias?.declaration === other.alias?.declaration &&
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
  return [...typeChildren(type), ...(type.alias?.arguments ?? [])];
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

/** Whether two types that are shapes were written at the same node, which tools locate them by. */
function sameOrigin(one: Type, other: Type): boolean {
  return one.kind !== 'anonymous' || (other.kind === 'anonymous' && one.origin === other.origin);
}

/**
 * `type` written through no alias at any level: the type its key names (type-keys.ts). A result
 * kept by a type's key is computed from it, so it never depends on how the type was spelled where
 * it was first asked for.
 */
export function unaliased<Written extends Type>(type: Written): Written {
  return mapChildren(type.alias === undefined ? type : { ...type, alias: undefined }, unaliased);
}

/** The type parameters `type` mentions, each once, in order of appearance. */
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

/** Whether `type` is, or is built from, the error type. */
export function mentionsError(type: Type): boolean {
  return type.kind === 'error' || typeChildren(type).some(mentionsError);
}

/**
 * `type` with each type it is built from, one level down, replaced by what `map` gives. The alias
 * `type` was written through comes along: a caller changing what it wrote drops it (type.ts).
 */
export function mapChildren<Mapped extends Type>(type: Mapped, map: (child: Type) => Type): Mapped;
export function mapChildren(type: Type, map: (child: Type) => Type): Type {
  switch (type.kind) {
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
