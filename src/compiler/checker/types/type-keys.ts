/**
 * Keys for types, for the maps and sets that are keyed by type, and the one definition of type
 * identity: two types are the same type exactly when their keys are equal (identity.ts).
 *
 * - A nominal type or a type parameter is itself by an object's identity: an entity, or the
 *   parameter's declaration; an `any` type is its traits' with their arguments, sorted, since its
 *   constraints are a set. A string can carry that identity only as a number. The numbers are the
 *   module's, so an object keys alike in every checker and in every revision of a program; lowering
 *   keys its function-table entries through the same unit. No number ever reaches lowering's
 *   output: it only finds entries by these keys.
 * - A shape (§3.1) is its field names and their keys, in name order, as the type keeps its fields:
 *   `{x:Int,y:Int}` however it was written. The key is the canonical text itself, never a digest,
 *   since a collision would make two types one without any error.
 * - A literal type is its value, a string's quoted as JSON, so no text it holds can end it early.
 * - A union is its members' keys, sorted, since its members are a set.
 * - An alias names no type of its own (§3.17), so no key mentions one.
 * - A type's own key is memoized per type object, which is immutable. Comparing generic signatures
 *   up to the names of their type parameters (rules/clashes.ts) keys each of those parameters by
 *   its position, which is the same as substituting canonical parameters, without building them;
 *   such keys are computed afresh.
 */

import { memo } from '../../../structures/memo.ts';
import type { AnonymousStructType, ParameterKey, Type } from './type.ts';

/** Every identity numbered so far; an object no longer reachable lets its number go. */
const identities = new WeakMap<object, number>();
let numbered = 0;

/** Each type's own key, with no parameter keyed by position. */
const ownKeys = new WeakMap<Type, string>();

/** Keys for types, and the numbers for identities they are made of. */
export interface TypeKeys {
  /** A number for `object`'s identity, the same every time it is asked for. */
  readonly identityOf: (object: object) => number;
  /** The key of `type`. Type parameters in `positions` are keyed by their position there. */
  readonly typeKey: (type: Type, positions?: ReadonlyMap<ParameterKey, number>) => string;
  /** The key of a shape, `typeKey`'s, which starts with `{`, as no other type's does. */
  readonly shapeKey: (type: AnonymousStructType) => ShapeKey;
}

/** A shape's key (`TypeKeys.shapeKey`). */
export type ShapeKey = `{${string}`;

function identityOf(object: object): number {
  return memo(identities, object, () => {
    numbered += 1;
    return numbered;
  });
}

function typeKey(type: Type, positions?: ReadonlyMap<ParameterKey, number>): string {
  return positions === undefined || positions.size === 0
    ? memo(ownKeys, type, () => keyOf(type, undefined))
    : keyOf(type, positions);
}

function keyOf(type: Type, positions: ReadonlyMap<ParameterKey, number> | undefined): string {
  const key = (each: Type): string => typeKey(each, positions);
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'error':
      return '?';
    case 'parameter': {
      const position = positions?.get(type.declaration);
      return position === undefined ? `'${identityOf(type.declaration)}` : `$${position}`;
    }
    case 'nominal':
      return `#${identityOf(type.entity)}<${type.arguments.map(key).join(',')}>`;
    case 'anonymous':
      return shapeKeyOf(type, positions);
    case 'tuple':
      return `(${type.elements.map(key).join(',')})`;
    case 'function': {
      const parameters = type.parameters.map(
        (parameter) => `${parameter.reference ? '&' : ''}${key(parameter.type)}`,
      );
      if (type.pack !== undefined) {
        parameters.push(`...${key(type.pack)}`);
      }
      const prefix = `${type.isSendable ? 'sendable ' : ''}${type.isAsync ? 'async ' : ''}`;
      return `${prefix}fn(${parameters.join(',')})->${key(type.result)}`;
    }
    case 'any': {
      const constraints = type.constraints.map(
        ({ trait, arguments: typeArguments }) =>
          `${identityOf(trait)}<${typeArguments.map(key).join(',')}>`,
      );
      return `any{${constraints.sort().join('&')}}`;
    }
    case 'literal':
      return `=${typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)}`;
    case 'union':
      return `|<${type.members.map(key).sort().join(',')}>`;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function shapeKeyOf(
  type: AnonymousStructType,
  positions: ReadonlyMap<ParameterKey, number> | undefined,
): ShapeKey {
  return `{${type.fields.map((field) => `${field.name}:${typeKey(field.type, positions)}`).join(',')}}`;
}

/** The one numbering of identities every checker keys types by. */
export const typeKeys: TypeKeys = {
  identityOf,
  typeKey,
  shapeKey: (type) => memo(ownKeys, type, () => shapeKeyOf(type, undefined)) as ShapeKey,
};
