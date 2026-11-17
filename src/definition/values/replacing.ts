/**
 * A value rebuilt with some of its parts replaced: the one walk every such map over a value's parts
 * takes. It keeps a stack of its own, since a value in memory may nest deeper than the host's stack
 * holds (values.ts, `maximumDepth`).
 */

import { pushAll } from '../../foundation/structures/stack.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
  withChildValues,
} from './values.ts';

/** A composite to rebuild from its parts, once the last `count` results are theirs. */
class Rebuilding {
  readonly composite: CompositeValue;
  readonly count: number;

  constructor(composite: CompositeValue, count: number) {
    this.composite = composite;
    this.count = count;
  }
}

/**
 * `value` with each composite part `replace` gives a value for replaced by it. `replace` is asked of
 * each part from the outside in, and never of one inside a part it replaced; every composite it
 * passes is rebuilt from its parts as they come out (`withChildValues`).
 */
export function replacingParts(
  value: Value,
  replace: (part: CompositeValue) => Value | undefined,
): Value {
  const pending: (Value | Rebuilding)[] = [value];
  const results: Value[] = [];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next instanceof Rebuilding) {
      results.push(withChildValues(next.composite, results.splice(results.length - next.count)));
    } else if (isComposite(next)) {
      const replaced = replace(next);
      if (replaced === undefined) {
        const parts = childValues(next);
        pending.push(new Rebuilding(next, parts.length));
        pushAll(pending, parts.toReversed());
      } else {
        results.push(replaced);
      }
    } else {
      results.push(next);
    }
  }
  const [result] = results;
  if (result === undefined || results.length !== 1) {
    unreachable('A rebuilt value left other than one result.');
  }
  return result;
}

/**
 * A copy of `value` sharing none of its composites: what a holder no count sees keeps, since the
 * runtime may change a value in place that only counted holders hold (runtime/run/lifetimes.ts).
 */
export function copied(value: Value): Value {
  return replacingParts(value, () => undefined);
}
