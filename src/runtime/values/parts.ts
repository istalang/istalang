/**
 * Parts of values along a path of steps (docs/arch/definition.md, "Places"): what a reference or
 * a `store` reads and writes inside a variable's value.
 *
 * Values are immutable: a constant's value is shared by every instance a runtime runs, and a copy
 * of a struct is the same object until it changes (§3.1). So writing a part never changes a value
 * in place; it builds a new value along the path, sharing every part off it.
 *
 * A field step is a position among a value's `childValues`, exactly as `field` reads it, and a
 * part is written back with `withChildValues`, so reading and writing can't disagree. An element
 * step goes through its container's `index` and `setIndex`, which the runtime calls from the
 * place; it doesn't run yet, and arrives with indexing.
 */

import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
  withChildValues,
} from '../../definition/values.ts';

/** One step into a value: a field by position, or an element through its container's functions. */
export type ValueStep =
  | { readonly kind: 'field'; readonly index: number }
  | {
      readonly kind: 'element';
      readonly key: Value;
      readonly read: number;
      readonly write: number;
    };

/** The part of `value` at `path`. */
export function partAt(value: Value, path: readonly ValueStep[]): Value {
  return path.reduce(
    (current, step) => childAt(childValues(compositeAt(current, step)), step),
    value,
  );
}

/** `value` with its part at `path` replaced by `part`, rebuilt along the path. */
export function withPart(value: Value, path: readonly ValueStep[], part: Value): Value {
  const [step, ...rest] = path;
  if (step === undefined) {
    return part;
  }
  const composite = compositeAt(value, step);
  const parts = childValues(composite);
  const rebuilt = parts.with(fieldIndex(step), withPart(childAt(parts, step), rest, part));
  return withChildValues(composite, rebuilt);
}

/** The part `step` names among `parts`; `unit` is `null`, so presence is the index, not the value. */
function childAt(parts: readonly Value[], step: ValueStep): Value {
  const index = fieldIndex(step);
  if (index >= parts.length) {
    throw new RangeError(`No field ${index}; loading and checking rule this out.`);
  }
  return parts[index] as Value;
}

function compositeAt(value: Value, step: ValueStep): CompositeValue {
  if (!isComposite(value)) {
    throw new TypeError(`A ${typeof value} has no field ${fieldIndex(step)}.`);
  }
  return value;
}

function fieldIndex(step: ValueStep): number {
  if (step.kind === 'element') {
    throw new Error("The runtime doesn't step into elements yet.");
  }
  return step.index;
}
