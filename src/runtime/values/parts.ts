/**
 * Parts of values along a path of steps (docs/arch/definition.md, "Places"): what a reference or
 * a `store` reads and writes inside a variable's value.
 *
 * Values are immutable: a constant's value is shared by every instance a runtime runs, and a copy
 * of a struct is the same object until it changes (§3.1). So writing a part never changes a value
 * in place; it builds a new value along the path, sharing every part off it.
 *
 * - A field step is a position among a value's `childValues`, exactly as `field` reads it, and a
 *   part is written back with `withChildValues`, so reading and writing can't disagree.
 * - An element step goes through its container's functions, which the checker resolved: `index`
 *   reads it, and `setIndex(&container, key, element)` writes it back. Writing passes the
 *   container in a box, the one thing a call made from inside a place can take by `&`, and the
 *   box then holds the container with the element replaced. Whoever runs code calls them
 *   (`ElementCalls`), since one may be a function of the program's own.
 */

import type { FunctionId } from '../../definition/operands.ts';
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
      readonly read: FunctionId;
      readonly write: FunctionId;
    };

/** A value passed by `&` to a call made from inside a place: the callee may replace it. */
export interface Box {
  value: Value;
}

/** Calls made from inside a place, run to completion before the place is read or written. */
export interface ElementCalls {
  /** Calls entry `callee` with `argumentList`, a box for a parameter taking `&`; its result. */
  readonly callNow: (callee: FunctionId, argumentList: readonly (Value | Box)[]) => Value;
}

export function isBox(argument: Value | Box): argument is Box {
  return typeof argument === 'object' && argument !== null && !('kind' in argument);
}

/** The part of `value` at `path`. */
export function partAt(value: Value, path: readonly ValueStep[], calls: ElementCalls): Value {
  return path.reduce((current, step) => childAt(current, step, calls), value);
}

/** `value` with its part at `path` replaced by `part`, rebuilt along the path. */
export function withPart(
  value: Value,
  path: readonly ValueStep[],
  part: Value,
  calls: ElementCalls,
): Value {
  const [step, ...rest] = path;
  if (step === undefined) {
    return part;
  }
  // A write ending at an element never reads it: a map may not hold the key yet.
  const child = rest.length === 0 ? part : withPart(childAt(value, step, calls), rest, part, calls);
  if (step.kind === 'element') {
    const container: Box = { value };
    calls.callNow(step.write, [container, step.key, child]);
    return container.value;
  }
  const composite = compositeAt(value, step.index);
  return withChildValues(composite, childValues(composite).with(step.index, child));
}

/** The part `step` names in `value`. */
function childAt(value: Value, step: ValueStep, calls: ElementCalls): Value {
  if (step.kind === 'element') {
    return calls.callNow(step.read, [value, step.key]);
  }
  const parts = childValues(compositeAt(value, step.index));
  if (step.index >= parts.length) {
    throw new RangeError(`No field ${step.index}; loading and checking rule this out.`);
  }
  // `unit` is `null`, so presence is the index, not the value.
  return parts[step.index] as Value;
}

function compositeAt(value: Value, index: number): CompositeValue {
  if (!isComposite(value)) {
    throw new TypeError(`A ${typeof value} has no field ${index}.`);
  }
  return value;
}
