/**
 * A running instance's context constants (spec §3.4): one value each, by the constant's qualified
 * name, made the first time code in the instance reads it and kept from then on as a
 * `contextConstant` heap object, a root (snapshot/holdings.ts `keptFrame`).
 *
 * - The value is made inside the reading segment, a heap object like any other, so a segment that
 *   is discarded made none, and a commit keeps it.
 * - An initializer reading its own constant calls itself, as any function calling itself does:
 *   without end, until the segment's frame limit panics (segment/limits.ts); else the read inside
 *   made the value first, so the initializer outside finds it made and panics, the constant having
 *   one value only. Either way nothing is kept of what is being made.
 * - An instance that ends lets go of them last, once all else it held is disposed, so every
 *   disposal before still reads them: the last made first, each disposing what it held before the
 *   next goes, since a later one may hold what reads an earlier one. A read of one let go of
 *   panics, its value gone with its instance, rather than making it again.
 */

import type { Value } from '../../../definition/values/values.ts';
import { Panic } from '../../natives.ts';
import type { Heap } from './heap.ts';

export class ContextConstants {
  readonly #heap: Heap;
  #ended = false;

  constructor(heap: Heap) {
    this.#heap = heap;
  }

  /** The value of the constant `name`; none while it is still to be made. */
  read(name: string): Value | undefined {
    const [made] = this.#heap.find('contextConstants', name);
    if (made === undefined && this.#ended) {
      throw new Panic(`The context constant '${name}' is read after its instance ended.`);
    }
    return made?.value;
  }

  /** Makes `value` the value of the constant `name`, which a read inside its initializer can't have. */
  make(name: string, value: Value): void {
    const [made] = this.#heap.find('contextConstants', name);
    if (made !== undefined) {
      throw new Panic(`The context constant '${name}' is read while it is being made.`);
    }
    this.#heap.add((id) => ({ kind: 'contextConstant', id, key: name, value }));
  }

  /**
   * Lets go of every constant's value as the instance ends, the last made first, `collect`
   * disposing what each held before the next goes.
   */
  release(collect: () => void): void {
    this.#ended = true;
    for (const constant of this.#heap.objectsOf('contextConstant').toReversed()) {
      this.#heap.remove(constant.id);
      collect();
    }
  }
}
