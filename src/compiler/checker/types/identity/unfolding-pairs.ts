/**
 * Relating two types as they unfold (§4.6), one of them recursive: a recursive type is what it
 * unfolds to, on either side, and a pair met again while it is related holds, as two unfoldings
 * alike so far stay alike, so relating them ends. One home for the rule, which matching a type
 * `match` case's pattern (resolution/type-matches/type-match-patterns.ts) and inferring type
 * arguments (types/inference/infer.ts) both read recursive types by.
 */

import { unfolded } from '../type/computed-types.ts';
import type { Type } from '../type/index.ts';
import { sameType } from './identity.ts';
import { typeKeys } from './type-keys.ts';

/** The pairs of types being related as they unfold, by key; each holds when met again. */
export class UnfoldingPairs {
  readonly #active = new Set<string>();

  /**
   * How `first` and `second` relate as `relate` decides it of what they unfold to; `holds` for
   * the same type, or a pair met again while it is related.
   */
  relate<Result>(
    first: Type,
    second: Type,
    holds: Result,
    relate: (first: Type, second: Type) => Result,
  ): Result {
    if (sameType(first, second)) {
      return holds;
    }
    const pair = `${typeKeys.typeKey(first)} ~ ${typeKeys.typeKey(second)}`;
    if (this.#active.has(pair)) {
      return holds;
    }
    this.#active.add(pair);
    try {
      return relate(unfolded(first), unfolded(second));
    } finally {
      this.#active.delete(pair);
    }
  }
}
