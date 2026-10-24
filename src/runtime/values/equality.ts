/**
 * The built-in `==` (§3.9): values compare by structure, handles by identity (§3.1). It can't be
 * overloaded, which keeps it consistent for map keys.
 *
 * Primitives compare as JavaScript does, so a float `NaN` equals nothing, IEEE 754's rule, and
 * `0.0 == -0.0`. A composite compares its head (kind, type, variant, function or object), then its
 * parts in order.
 */

import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
} from '../../definition/values.ts';

export function valuesEqual(left: Value, right: Value): boolean {
  if (!(isComposite(left) && isComposite(right))) {
    return left === right;
  }
  if (!sameHead(left, right)) {
    return false;
  }
  const leftParts = childValues(left);
  const rightParts = childValues(right);
  return (
    leftParts.length === rightParts.length &&
    leftParts.every((part, index) => {
      const other = rightParts[index];
      return other !== undefined && valuesEqual(part, other);
    })
  );
}

/** Whether two composites agree on everything but their parts. */
function sameHead(left: CompositeValue, right: CompositeValue): boolean {
  switch (left.kind) {
    case 'handle':
      return right.kind === 'handle' && left.object === right.object;
    case 'extern':
      return right.kind === 'extern' && left.type === right.type && left.payload === right.payload;
    case 'struct':
      return right.kind === 'struct' && left.type === right.type;
    case 'variant':
      return right.kind === 'variant' && left.type === right.type && left.variant === right.variant;
    case 'closure':
      return right.kind === 'closure' && left.function === right.function;
    default:
      return left.kind === right.kind;
  }
}
