/**
 * Keys for types, for the maps and sets that are keyed by type: two types share a key exactly
 * when `sameType` holds (type.ts).
 *
 * - A nominal type, an anonymous struct or a type parameter is itself by an object's identity: an
 *   entity, or the node that introduced it; an `any` type is its traits' with their arguments,
 *   sorted, since its constraints are a set. A string can carry that identity only as a number.
 *   The numbers are the module's, so an object keys alike in every checker and in every revision
 *   of a program; lowering keys its function-table entries through the same unit. No number ever
 *   reaches lowering's output: it only finds entries by these keys.
 * - Comparing generic signatures up to the names of their type parameters (rules/clashes.ts)
 *   keys each of those parameters by its position, which is the same as substituting canonical
 *   parameters, without building them.
 */

import { memo } from '../../../structures/memo.ts';
import { isSharedValueType, type ParameterKey, type Type } from './type.ts';

/** Every identity numbered so far; an object no longer reachable lets its number go. */
const identities = new WeakMap<object, number>();
let numbered = 0;

/** Keys for types, and the numbers for identities they are made of. */
export interface TypeKeys {
  /** A number for `object`'s identity, the same every time it is asked for. */
  readonly identityOf: (object: object) => number;
  /** The key of `type`. Type parameters in `positions` are keyed by their position there. */
  readonly typeKey: (type: Type, positions?: ReadonlyMap<ParameterKey, number>) => string;
}

function identityOf(object: object): number {
  return memo(identities, object, () => {
    numbered += 1;
    return numbered;
  });
}

function typeKey(type: Type, positions: ReadonlyMap<ParameterKey, number> = new Map()): string {
  const key = (each: Type): string => typeKey(each, positions);
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'error':
      return '?';
    case 'parameter': {
      const position = positions.get(type.declaration);
      return position === undefined ? `'${identityOf(type.declaration)}` : `$${position}`;
    }
    case 'nominal':
      return `#${identityOf(type.entity)}<${type.arguments.map(key).join(',')}>`;
    case 'anonymous': {
      const typeArguments = isSharedValueType(type) ? `<${type.arguments.map(key).join(',')}>` : '';
      return `{${identityOf(type.origin)}${typeArguments}:${type.fields.map((field) => key(field.type)).join(',')}}`;
    }
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
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** The one numbering of identities every checker keys types by. */
export const typeKeys: TypeKeys = { identityOf, typeKey };
