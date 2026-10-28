/**
 * What a type is built from (type.ts): the types one level down, a type with them replaced, and
 * what walking them finds, the type parameters and `any` types a type mentions and whether it holds
 * the error type.
 */

import { type AnyType, isSharedValueType, type ParameterKey, type Type, withPack } from './type.ts';

/** The types `type` is built from, one level down. */
export function typeChildren(type: Type): readonly Type[] {
  switch (type.kind) {
    case 'nominal':
      return type.arguments;
    case 'anonymous':
      return isSharedValueType(type)
        ? [...type.arguments, ...type.fields.map((field) => field.type)]
        : type.fields.map((field) => field.type);
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
    case 'anonymous': {
      const fields = type.fields.map((field) => ({ ...field, type: map(field.type) }));
      return isSharedValueType(type)
        ? { ...type, arguments: type.arguments.map(map), fields }
        : { ...type, fields };
    }
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
