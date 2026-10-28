/**
 * Coinductive cycle guard over types: while a type's parts are being decided for a property such
 * as `Encodable`, `Decodable` or `Sendable`, reaching the same type again along the active path
 * counts as meeting the property, and exiting the decision removes it so a later check starts
 * fresh.
 */

import type { Type } from './type.ts';
import type { TypeKeys } from './type-keys.ts';

export class TypeCycle {
  readonly #keys: TypeKeys;
  readonly #active = new Set<string>();

  constructor(keys: TypeKeys) {
    this.#keys = keys;
  }

  /**
   * Runs `step` with `type` marked active; returns `onCycle` when `type` is reached again while
   * still active.
   */
  enter<R>(type: Type, onCycle: R, step: () => R): R {
    const key = this.#keys.typeKey(type);
    if (this.#active.has(key)) {
      return onCycle;
    }
    this.#active.add(key);
    try {
      return step();
    } finally {
      this.#active.delete(key);
    }
  }
}
