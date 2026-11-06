/**
 * Parts of values along a path of field positions (docs/arch/definition.md, "Places"): what a
 * reference or a `store` reads and writes inside a variable's value.
 *
 * Values are immutable: a constant's value is shared by every instance a runtime runs, and a copy
 * of a struct is the same object until it changes (§3.1). So writing a part never changes a value
 * in place; it builds a new value along the path, sharing every part off it. A field position is
 * a position among a value's `childValues`, exactly as `field` reads it, and a part is written
 * back with `withChildValues`, so reading and writing can't disagree.
 */

import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
  withChildValues,
} from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';

/** The part of `value` at `path`. */
export function partAt(value: Value, path: readonly number[]): Value {
  return path.reduce(childAt, value);
}

/** `value` with its part at `path` replaced by `part`, rebuilt along the path. */
export function withPart(value: Value, path: readonly number[], part: Value): Value {
  const [index, ...rest] = path;
  if (index === undefined) {
    return part;
  }
  const composite = compositeAt(value, index);
  const child = withPart(childAt(composite, index), rest, part);
  return withChildValues(composite, childValues(composite).with(index, child));
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
