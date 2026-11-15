/**
 * Parts of values along a path of field positions (docs/arch/definition.md, "Places"): what a
 * reference or a `store` reads and writes inside a variable's value.
 *
 * A field position is a position among a value's `childValues`, exactly as `field` reads it and
 * as a write puts a part back (runtime/lifetimes/in-place.ts), so reading and writing can't disagree.
 */

import { unreachable } from '../../foundation/structures/unreachable.ts';
import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
  withChildValues,
} from './values.ts';

/** The part of `value` at `path`. */
export function partAt(value: Value, path: readonly number[]): Value {
  return path.reduce(fieldAt, value);
}

/**
 * `value` with its part at `path` replaced by `part`, copying every composite along the path and
 * sharing the rest: a write to a value nothing may change in place.
 */
export function withPartAt(value: Value, path: readonly number[], part: Value): Value {
  return withPartFrom(value, path, 0, part);
}

/** `withPartAt` of `path`'s steps from `from` on. */
function withPartFrom(value: Value, path: readonly number[], from: number, part: Value): Value {
  const index = path[from];
  if (index === undefined) {
    return part;
  }
  const composite = compositeAt(value, index);
  const children = [...childValues(composite)];
  children[index] = withPartFrom(fieldAt(composite, index), path, from + 1, part);
  return withChildValues(composite, children);
}

/** Field `index` of `value`: a tuple element, a struct field, or a field of an enum's variant. */
export function fieldAt(value: Value, index: number): Value {
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
