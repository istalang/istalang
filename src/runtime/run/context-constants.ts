/**
 * An instance's context constants (§7.1): one value each, by the constant's qualified name, made
 * the first time code in the instance reads it and kept from then on, in the order they were made,
 * which a snapshot keeps.
 *
 * An instance that ends lets go of them last, once all else it held is disposed, so every disposal
 * before still reads them: the last made first, each disposing what it held before the next goes,
 * since a later one may hold what reads an earlier one. A read of one let go of panics, its value
 * gone with its instance, rather than making it again. An initializer reading its own constant
 * calls itself, as any function calling itself does; one whose read inside made the value first
 * finds it made as it makes it, and panics.
 */

import type { Value } from '../../definition/values/values.ts';
import { Panic } from '../natives.ts';

export class ContextConstants {
  readonly #values = new Map<string, Value>();
  #released = false;

  /** The value of the constant `name`; none while it is still to be made. */
  read(name: string): Value | undefined {
    const made = this.#values.get(name);
    if (made === undefined && this.#released) {
      throw new Panic(`The context constant '${name}' is read after its instance ended.`);
    }
    return made;
  }

  /**
   * Keeps `value` as the value of the constant `name`, made now or read back from a snapshot; one a
   * read inside its own initializer made already panics, a constant having one value only.
   */
  made(name: string, value: Value): void {
    if (this.#values.has(name)) {
      throw new Panic(`The context constant '${name}' is read while it is being made.`);
    }
    this.#values.set(name, value);
  }

  /** Lets go of every constant (`letGo`) as the instance ends, the last made first. */
  release(letGo: (value: Value) => void): void {
    this.#released = true;
    for (const [name, value] of [...this.#values].toReversed()) {
      this.#values.delete(name);
      letGo(value);
    }
  }

  /** Each constant's name and value, in the order they were made. */
  entries(): readonly (readonly [string, Value])[] {
    return [...this.#values];
  }
}
