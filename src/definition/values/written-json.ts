/**
 * What an instance, or a run of compiled code, wrote each value as (proposal 15, stage 1):
 * `json.encode<T>` gives the same `Json` again for a value written before as a `T` and unchanged
 * since, so a host gets the same object for it (stage 2: json-values.ts `plainOfJson`).
 *
 * - **Keyed by the value object and the type it was written as:** one object may be written as
 *   two types whose codecs differ, as a conversion keeping the layout shares it between them.
 *   Only object values are kept: a primitive's JSON is its own identity anyway. A handle is the run
 *   object it names, read anew from a weak reference or given to a `dispose` as the same object.
 * - **One per instance or run:** a codec may read a `context` constant, whose value is the
 *   instance's (§3.4). A test world keeps none, so a mock sees every call of the codec it replaces
 *   (§10).
 * - **A holder:** a `Json` kept is held for good (`hold`), so no part of it is ever changed in
 *   place, which would change what it gives for another value. A value written as itself, a
 *   `Json`, is not kept, so what it holds stays its own to change.
 * - **A value changed in place is forgotten** (`forget`), as its other derived data is: it is
 *   another value now, so its JSON is built again.
 */

import { memo } from '../../foundation/structures/memo.ts';
import { encodeJson } from '../formats/codec.ts';
import type { TypeReference } from '../tables/types.ts';
import { type CompositeValue, isComposite, type Value } from './values.ts';

/** Each type reference's canonical text, which keys a value's JSON whichever entry refers. */
const typeTexts = new WeakMap<TypeReference, string>();

export class WrittenJson {
  readonly #byValue = new WeakMap<CompositeValue, Map<string, Value>>();
  readonly #hold: (json: Value) => void;

  /** Kept JSON, held for good by `hold`. */
  constructor(hold: (json: Value) => void) {
    this.#hold = hold;
  }

  /** The `Json` `value` was written as, a `type`, while unchanged; undefined if it wasn't. */
  of(value: Value, type: TypeReference): Value | undefined {
    return isComposite(value) ? this.#byValue.get(value)?.get(textOf(type)) : undefined;
  }

  /**
   * Keeps `json` as what `value` was written as, a `type`. A value written as itself (a `Json`)
   * is not kept: writing it again costs nothing, and holding it would pin what it holds, so an
   * array of `Json` given as `Json` would be copied at every change after.
   */
  remember(value: Value, type: TypeReference, json: Value): void {
    if (!isComposite(value) || value === json) {
      return;
    }
    this.#hold(json);
    memo(this.#byValue, value, () => new Map<string, Value>()).set(textOf(type), json);
  }

  /** Forgets what `node`, which changed in place, was written as. */
  forget(node: CompositeValue): void {
    this.#byValue.delete(node);
  }
}

function textOf(type: TypeReference): string {
  return memo(typeTexts, type, () => encodeJson(type));
}
