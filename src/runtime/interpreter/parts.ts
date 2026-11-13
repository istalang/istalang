/**
 * Parts of values along a path of field positions (docs/arch/definition.md, "Places"): what a
 * reference or a `store` reads and writes inside a variable's value.
 *
 * A field position is a position among a value's `childValues`, exactly as `field` reads it and
 * as a write puts a part back (lifetimes/in-place.ts), so reading and writing can't disagree.
 */

import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';

/** The part of `value` at `path`. */
export function partAt(value: Value, path: readonly number[]): Value {
  return path.reduce(childAt, value);
}

/** Field `index` of `value`. */
function childAt(value: Value, index: number): Value {
  const parts = childValues(compositeAt(value, index));
  if (index >= parts.length) {
    unreachable(`No field ${index}; loading and checking rule this out.`);
  }
  // `Unit` is `null`, so presence is the index, not the value.
  return parts[index] as Value;
}

function compositeAt(value: Value, index: number): CompositeValue {
  if (!isComposite(value)) {
    unreachable(`A ${typeof value} has no field ${index}.`);
  }
  return value;
}
