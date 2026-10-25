/**
 * Keys for types, for the maps and sets that are keyed by type: two types share a key exactly
 * when `sameType` holds (type.ts).
 *
 * - A nominal type, an anonymous struct or a type parameter is itself by an object's identity: an
 *   entity, or the node that introduced it. A string can carry that identity only as a number.
 *   The numbers belong to one `TypeKeys`, which belongs to one checker, so no counter outlives
 *   its program. Lowering numbers its own nodes through the same unit, so it keys
 *   function-table entries the same way it keys types.
 * - Comparing generic signatures up to the names of their type parameters (rules/clashes.ts)
 *   keys each of those parameters by its position, which is the same as substituting canonical
 *   parameters, without building them.
 */

import { memo } from '../../../structures/memo.ts';
import type { ParameterKey, Type } from './type.ts';

export class TypeKeys {
  readonly #identities = new Map<object, number>();

  /** A number for `object`'s identity, the same every time it is asked for. */
  identityOf(object: object): number {
    return memo(this.#identities, object, () => this.#identities.size);
  }

  /** The key of `type`. Type parameters in `positions` are keyed by their position there. */
  typeKey(type: Type, positions: ReadonlyMap<ParameterKey, number> = new Map()): string {
    const key = (each: Type): string => this.typeKey(each, positions);
    switch (type.kind) {
      case 'primitive':
        return type.name;
      case 'error':
        return '?';
      case 'parameter': {
        const position = positions.get(type.declaration);
        return position === undefined ? `'${this.identityOf(type.declaration)}` : `$${position}`;
      }
      case 'nominal':
        return `#${this.identityOf(type.entity)}<${type.arguments.map(key).join(',')}>`;
      case 'anonymous':
        return `{${this.identityOf(type.origin)}:${type.fields.map((field) => key(field.type)).join(',')}}`;
      case 'tuple':
        return `(${type.elements.map(key).join(',')})`;
      case 'function': {
        const parameters = type.parameters.map(
          (parameter) => `${parameter.reference ? '&' : ''}${key(parameter.type)}`,
        );
        return `${type.isAsync ? 'async ' : ''}fn(${parameters.join(',')})->${key(type.result)}`;
      }
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }
}
