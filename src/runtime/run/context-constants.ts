/**
 * An instance's context constants (§3.4): one value each, by the constant's qualified name, made
 * the first time code in the instance reads it and kept from then on, in the order they were made,
 * which a snapshot keeps.
 */

import type { Value } from '../../definition/values/values.ts';

export class ContextConstants {
  readonly #values = new Map<string, Value>();

  /** The value of the constant `name`; none while it is still to be made. */
  read(name: string): Value | undefined {
    return this.#values.get(name);
  }

  /** Keeps `value` as the value of the constant `name`, made now or read back from a snapshot. */
  made(name: string, value: Value): void {
    this.#values.set(name, value);
  }

  /** Forgets every constant, as its instance lets go of them. */
  clear(): void {
    this.#values.clear();
  }

  /** Each constant's name and value, in the order they were made. */
  entries(): readonly (readonly [string, Value])[] {
    return [...this.#values];
  }
}
